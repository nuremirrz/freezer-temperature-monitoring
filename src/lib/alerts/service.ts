import { prisma } from "@/lib/db";
import { publish } from "@/lib/events";
import { notify, locationUrl, type AlertNotification } from "@/lib/notify";
import {
  evaluateTempReading,
  alertRange,
  isOutOfRange,
  peakOf,
  type TempRange,
  isSensorOffline,
  canNotify,
  fullyOfflineLocations,
  offlineAfterSec,
} from "./rules";

/**
 * Database-backed alert workflow. Rules live in rules.ts (pure); this file loads
 * state, applies a decision, persists it, and fans out notifications + SSE events.
 * Notifications are fire-and-forget: an ingest response never waits on Telegram.
 */

const minutesBetween = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / 60_000));

function fireAndForget(p: Promise<unknown>) {
  p.catch((err) => console.error("[alerts] background task failed:", err));
}

/**
 * Sends a notification in the background and records it against the alerts only once it has
 * actually gone out.
 *
 * Stamping `lastNotifiedAt` up front — which this used to do — arms the cooldown with
 * messages nobody received. That is how a broken Telegram chat id went unnoticed for two
 * days in September, and why the "back to normal" messages that followed were then
 * suppressed as duplicates of alerts that had never arrived.
 */
function notifyAndStamp(alertIds: string[], n: AlertNotification): void {
  fireAndForget(
    notify(n).then(async (delivered) => {
      if (!delivered || !alertIds.length) return;
      await prisma.alert.updateMany({
        where: { id: { in: alertIds } },
        data: { lastNotifiedAt: new Date() },
      });
    }),
  );
}

/**
 * The current unbroken run of out-of-range readings for a unit: when it started, and the
 * reading that strayed furthest. The run is everything recorded after the last reading that
 * was inside the range — so a single good reading in the middle resets the clock, which is
 * what "temperature held for an hour" has to mean.
 */
async function outOfRangeRun(
  unitId: string,
  bounds: TempRange,
  reading: NewReading,
): Promise<{ startedAt: Date; peakTempF: number } | null> {
  const lastGood = await prisma.reading.findFirst({
    where: {
      unitId,
      measuredAt: { lt: reading.measuredAt },
      tempF: { gte: bounds.rangeMinF, lte: bounds.rangeMaxF },
    },
    orderBy: { measuredAt: "desc" },
    select: { measuredAt: true },
  });

  const agg = await prisma.reading.aggregate({
    where: {
      unitId,
      measuredAt: { lte: reading.measuredAt, ...(lastGood ? { gt: lastGood.measuredAt } : {}) },
    },
    _min: { measuredAt: true, tempF: true },
    _max: { tempF: true },
  });

  const startedAt = agg._min.measuredAt;
  if (!startedAt) return null;
  const lo = agg._min.tempF ?? reading.tempF;
  const hi = agg._max.tempF ?? reading.tempF;
  return { startedAt, peakTempF: peakOf(lo, hi, bounds) };
}

export interface NewReading {
  unitId: string;
  sensorId: string;
  channel: number;
  tempF: number;
  measuredAt: Date;
}

/** Evaluate the temp-out-of-range rule for a reading that was just inserted. */
export async function processNewReading(reading: NewReading, now: Date = new Date()): Promise<void> {
  const unit = await prisma.unit.findUnique({
    where: { id: reading.unitId },
    include: { location: true },
  });
  if (!unit) return;

  const openAlert = await prisma.alert.findFirst({
    where: { unitId: unit.id, type: "temp_out_of_range", resolvedAt: null },
  });

  // Judged against the alert band, not the normal one: leaving "normal" colours the reading,
  // crossing the alert threshold for an hour is what raises anything.
  const bounds = alertRange(unit);
  const run = openAlert || !isOutOfRange(reading.tempF, bounds) ? null : await outOfRangeRun(unit.id, bounds, reading);

  const decision = evaluateTempReading({
    rangeMinF: bounds.rangeMinF,
    rangeMaxF: bounds.rangeMaxF,
    current: reading.tempF,
    outOfRangeForMin: run ? (reading.measuredAt.getTime() - run.startedAt.getTime()) / 60_000 : 0,
    runPeakTempF: run?.peakTempF ?? null,
    openAlert: openAlert ? { peakTempF: openAlert.peakTempF } : null,
  });

  publish({
    type: "reading",
    data: {
      unitId: unit.id,
      locationId: unit.locationId,
      sensorId: reading.sensorId,
      channel: reading.channel,
      tempF: reading.tempF,
      measuredAt: reading.measuredAt.toISOString(),
    },
  });

  switch (decision.action) {
    case "open": {
      // Dated from the first bad reading, so Duration shows the whole spell, not the last hour of it
      const openedAt = run?.startedAt ?? reading.measuredAt;
      const alert = await prisma.alert.create({
        data: {
          unitId: unit.id,
          type: "temp_out_of_range",
          openedAt,
          peakTempF: decision.peakTempF,
        },
      });
      publish({
        type: "alert",
        data: {
          id: alert.id,
          unitId: unit.id,
          locationId: unit.locationId,
          alertType: "temp_out_of_range",
          state: "opened",
          peakTempF: alert.peakTempF,
          openedAt: alert.openedAt.toISOString(),
          resolvedAt: null,
        },
      });
      notifyAndStamp([alert.id], {
        kind: "opened",
        alertType: "temp_out_of_range",
        locationName: unit.location.name,
        unitName: unit.name,
        tempF: reading.tempF,
        rangeMinF: unit.rangeMinF,
        rangeMaxF: unit.rangeMaxF,
        durationMin: minutesBetween(openedAt, now),
        url: locationUrl(unit.locationId),
      });
      return;
    }

    case "update": {
      if (!openAlert || openAlert.peakTempF === decision.peakTempF) return;
      await prisma.alert.update({
        where: { id: openAlert.id },
        data: { peakTempF: decision.peakTempF },
      });
      publish({
        type: "alert",
        data: {
          id: openAlert.id,
          unitId: unit.id,
          locationId: unit.locationId,
          alertType: "temp_out_of_range",
          state: "updated",
          peakTempF: decision.peakTempF,
          openedAt: openAlert.openedAt.toISOString(),
          resolvedAt: null,
        },
      });
      return;
    }

    case "close": {
      if (!openAlert) return;
      const shouldNotify = canNotify(openAlert.lastNotifiedAt, now);
      const resolved = await prisma.alert.update({
        where: { id: openAlert.id },
        data: { resolvedAt: reading.measuredAt },
      });
      publish({
        type: "alert",
        data: {
          id: resolved.id,
          unitId: unit.id,
          locationId: unit.locationId,
          alertType: "temp_out_of_range",
          state: "resolved",
          peakTempF: resolved.peakTempF,
          openedAt: resolved.openedAt.toISOString(),
          resolvedAt: resolved.resolvedAt?.toISOString() ?? null,
        },
      });
      if (shouldNotify) {
        notifyAndStamp([resolved.id], {
          kind: "resolved",
          alertType: "temp_out_of_range",
          locationName: unit.location.name,
          unitName: unit.name,
          tempF: reading.tempF,
          rangeMinF: unit.rangeMinF,
          rangeMaxF: unit.rangeMaxF,
          durationMin: minutesBetween(resolved.openedAt, reading.measuredAt),
          url: locationUrl(unit.locationId),
        });
      } else {
        console.log(`[alerts] resolved ${unit.name} @ ${unit.location.name} (notification suppressed by cooldown)`);
      }
      return;
    }

    case "none":
      return;
  }
}

/**
 * A sensor just reported: any open offline alerts on its units are resolved immediately
 * (no need to wait for the minute-based check).
 */
export async function resolveOfflineForSensor(sensorId: string, now: Date = new Date()): Promise<void> {
  const sensor = await prisma.sensor.findUnique({
    where: { id: sensorId },
    include: {
      location: true,
      channels: { where: { unitId: { not: null } }, include: { unit: true } },
    },
  });
  if (!sensor) return;

  const unitIds = sensor.channels.map((c) => c.unitId as string);
  if (!unitIds.length) return;

  const open = await prisma.alert.findMany({
    where: { unitId: { in: unitIds }, type: "offline", resolvedAt: null },
  });
  if (!open.length) return;

  const silentSince = open.reduce((min, a) => (a.openedAt < min ? a.openedAt : min), open[0].openedAt);
  const shouldNotify = open.some((a) => canNotify(a.lastNotifiedAt, now));

  await prisma.alert.updateMany({
    where: { id: { in: open.map((a) => a.id) } },
    data: { resolvedAt: now },
  });

  for (const a of open) {
    publish({
      type: "alert",
      data: {
        id: a.id,
        unitId: a.unitId,
        locationId: sensor.locationId,
        alertType: "offline",
        state: "resolved",
        peakTempF: null,
        openedAt: a.openedAt.toISOString(),
        resolvedAt: now.toISOString(),
      },
    });
  }

  if (shouldNotify) {
    // Was the whole location down? Then announce the location coming back rather than one sensor.
    const siblings = await prisma.sensor.findMany({
      where: { locationId: sensor.locationId, id: { not: sensor.id } },
      select: { lastSeenAt: true, expectedIntervalSec: true },
    });
    const wholeLocationWasDown = siblings.every((s) =>
      isSensorOffline(s.lastSeenAt, now, offlineAfterSec(s.expectedIntervalSec)),
    );
    notifyAndStamp(
      open.map((a) => a.id),
      {
        kind: "resolved",
        alertType: "offline",
        locationName: sensor.location.name,
        unitNames: sensor.channels.map((c) => c.unit?.name ?? "").filter(Boolean),
        locationWide: wholeLocationWasDown && siblings.length > 0,
        silentMin: minutesBetween(silentSince, now),
        url: locationUrl(sensor.locationId),
      },
    );
  }
}

export interface OfflineCheckResult {
  checkedSensors: number;
  opened: number;
  resolved: number;
  fullyOfflineLocations: string[];
}

/**
 * Minute-based background check: silent sensors get an offline alert per mapped unit,
 * sensors that are back get theirs resolved. When every sensor at a location is silent,
 * one location-wide notification is sent instead of five.
 */
export async function runOfflineCheck(now: Date = new Date()): Promise<OfflineCheckResult> {
  const sensors = await prisma.sensor.findMany({
    include: {
      location: true,
      channels: { where: { unitId: { not: null } }, include: { unit: true } },
    },
  });

  // Each device has its own uplink interval, so each gets its own silence threshold
  const states = sensors.map((s) => ({
    sensorId: s.id,
    locationId: s.locationId,
    offline: isSensorOffline(s.lastSeenAt, now, offlineAfterSec(s.expectedIntervalSec)),
  }));
  const offlineById = new Map(states.map((s) => [s.sensorId, s.offline]));
  const downLocations = fullyOfflineLocations(states);
  const openOffline = await prisma.alert.findMany({ where: { type: "offline", resolvedAt: null } });
  const openByUnit = new Map(openOffline.map((a) => [a.unitId, a]));

  const result: OfflineCheckResult = {
    checkedSensors: sensors.length,
    opened: 0,
    resolved: 0,
    fullyOfflineLocations: [...downLocations],
  };
  const locationNotified = new Set<string>();

  for (const sensor of sensors) {
    const offline = offlineById.get(sensor.id) ?? true;
    const units = sensor.channels.map((c) => c.unit!).filter(Boolean);
    if (!units.length) continue;

    if (offline) {
      const missing = units.filter((u) => !openByUnit.has(u.id));
      if (!missing.length) continue;

      const locationWide = downLocations.has(sensor.locationId);
      // Location-wide: one message per location per check; per-sensor otherwise
      const willNotify = locationWide ? !locationNotified.has(sensor.locationId) : true;
      if (locationWide && willNotify) locationNotified.add(sensor.locationId);

      const created = await Promise.all(
        missing.map((u) =>
          prisma.alert.create({
            data: {
              unitId: u.id,
              type: "offline",
              openedAt: sensor.lastSeenAt ?? now,
            },
          }),
        ),
      );
      result.opened += created.length;

      for (const a of created) {
        publish({
          type: "alert",
          data: {
            id: a.id,
            unitId: a.unitId,
            locationId: sensor.locationId,
            alertType: "offline",
            state: "opened",
            peakTempF: null,
            openedAt: a.openedAt.toISOString(),
            resolvedAt: null,
          },
        });
      }

      if (willNotify) {
        notifyAndStamp(
          created.map((a) => a.id),
          {
            kind: "opened",
            alertType: "offline",
            locationName: sensor.location.name,
            unitNames: units.map((u) => u.name),
            locationWide,
            silentMin: sensor.lastSeenAt
              ? minutesBetween(sensor.lastSeenAt, now)
              : Math.round(offlineAfterSec(sensor.expectedIntervalSec) / 60),
            url: locationUrl(sensor.locationId),
          },
        );
      }
    } else {
      // Back online but the ingest path didn't resolve it (e.g. server was down) — resolve here
      const stale = units.map((u) => openByUnit.get(u.id)).filter(Boolean);
      if (!stale.length) continue;
      await resolveOfflineForSensor(sensor.id, now);
      result.resolved += stale.length;
    }
  }

  return result;
}
