import { prisma } from "@/lib/db";
import { publish } from "@/lib/events";
import { notify, locationUrl, chatFor, type AlertNotification } from "@/lib/notify";

/** A location with what notifications need from it: the organization's own chat. */
const locationWithChat = { include: { organization: { select: { telegramChatId: true } } } } as const;
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
  NOTIFY_COOLDOWN_MIN,
} from "./rules";
import { evaluateCooling, RUN_LOOKBACK_MIN, type CoolingReading } from "./cooling";

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

/**
 * Evaluate a reading that was just inserted.
 *
 * Which rule applies depends on the equipment, and the two are not variations of one idea.
 * Cold storage is judged by its own temperature: a freezer that cannot hold 10 °F is broken,
 * whatever the kitchen is doing. An air conditioner is judged by the drop across it, because
 * the room it is asked to cool is not under its control — see cooling.ts. So an AC no longer
 * raises temp_out_of_range at all, and a walk-in never raises not_cooling.
 */
export async function processNewReading(reading: NewReading, now: Date = new Date()): Promise<void> {
  const unit = await loadUnit(reading.unitId);
  if (!unit) return;
  // A deactivated restaurant keeps its readings and raises nothing: nobody is there to act.
  if (unit.location.deactivatedAt) return;

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

  if (unit.type === "ac") return processCoolingReading(unit, reading, now);
  return processTempReading(unit, reading, now);
}

function loadUnit(id: string) {
  return prisma.unit.findUnique({ where: { id }, include: { location: locationWithChat } });
}

type UnitWithLocation = NonNullable<Awaited<ReturnType<typeof loadUnit>>>;

/** The temp-out-of-range rule, for cold storage. Unchanged by the AC spec. */
async function processTempReading(unit: UnitWithLocation, reading: NewReading, now: Date): Promise<void> {
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
        chatId: chatFor(unit.location.organization),
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
          chatId: chatFor(unit.location.organization),
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
 * The cooling rule, for air conditioners.
 *
 * The run is read from the stored readings rather than carried in memory: the reading that
 * triggered this call is already written, so one query over the last few hours is the whole
 * history the rule needs, and a restart or a missed uplink cannot leave a half-counted run
 * behind. At a five-minute pace that window is about thirty-six rows.
 *
 * One thing here is an assumption rather than an instruction, and it is deliberate. Sanjar
 * said closed hours leave a unit Normal, and the rule follows that: a reading taken while the
 * restaurant is shut ends a run, and an open alert closes at midnight. Taken literally that
 * also means a unit still broken at closing time is announced as recovered — which is why the
 * closing message says "ресторан закрылся" instead of "снова холодит", and why this is written
 * down to be confirmed rather than quietly reinterpreted.
 */
async function processCoolingReading(unit: UnitWithLocation, reading: NewReading, now: Date): Promise<void> {
  const openAlert = await prisma.alert.findFirst({
    where: { unitId: unit.id, type: "not_cooling", resolvedAt: null },
  });

  const rows = await prisma.reading.findMany({
    where: {
      unitId: unit.id,
      measuredAt: { gte: new Date(reading.measuredAt.getTime() - RUN_LOOKBACK_MIN * 60_000), lte: reading.measuredAt },
    },
    orderBy: { measuredAt: "asc" },
    select: { tempF: true, probeTempF: true, measuredAt: true },
  });
  const readings: CoolingReading[] = rows.map((r) => ({
    tempF: r.tempF,
    probeTempF: r.probeTempF,
    measuredAt: r.measuredAt.getTime(),
  }));

  const decision = evaluateCooling({
    readings,
    // The room temperature it is expected to be holding is the top of its own normal band:
    // 80 °F in a kitchen, 77 °F in a dining room.
    ctx: { loadAboveF: unit.rangeMaxF, timeZone: unit.location.timezone },
    openAlert: openAlert ? { openedAt: openAlert.openedAt.getTime() } : null,
  });

  const newest = rows[rows.length - 1];
  const ductF = newest?.probeTempF ?? null;

  if (decision.action === "open") {
    const openedAt = new Date(decision.openedAt);
    const alert = await prisma.alert.create({
      data: {
        unitId: unit.id,
        type: "not_cooling",
        openedAt,
        // The room at the moment it was called: what the card and the history show for this alert.
        peakTempF: reading.tempF,
      },
    });
    publish({
      type: "alert",
      data: {
        id: alert.id,
        unitId: unit.id,
        locationId: unit.locationId,
        alertType: "not_cooling",
        state: "opened",
        peakTempF: alert.peakTempF,
        openedAt: alert.openedAt.toISOString(),
        resolvedAt: null,
      },
    });
    notifyAndStamp([alert.id], {
      kind: "opened",
      alertType: "not_cooling",
      locationName: unit.location.name,
      unitName: unit.name,
      roomF: reading.tempF,
      ductF,
      substatus: decision.substatus,
      durationMin: minutesBetween(openedAt, now),
      url: locationUrl(unit.locationId),
      chatId: chatFor(unit.location.organization),
    });
    return;
  }

  if (decision.action === "close" && openAlert) {
    // Say it is back only if we said it was broken. The offline path learned this the hard
    // way: a recovery for an alert nobody was told about is noise with a green circle.
    const shouldNotify = openAlert.lastNotifiedAt !== null;
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
        alertType: "not_cooling",
        state: "resolved",
        peakTempF: resolved.peakTempF,
        openedAt: resolved.openedAt.toISOString(),
        resolvedAt: resolved.resolvedAt?.toISOString() ?? null,
      },
    });
    if (shouldNotify) {
      notifyAndStamp([resolved.id], {
        kind: "resolved",
        alertType: "not_cooling",
        locationName: unit.location.name,
        unitName: unit.name,
        roomF: reading.tempF,
        ductF,
        substatus: decision.substatus,
        durationMin: minutesBetween(resolved.openedAt, reading.measuredAt),
        url: locationUrl(unit.locationId),
        chatId: chatFor(unit.location.organization),
      });
    }
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
      location: locationWithChat,
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
  // Say a sensor is back only if we said it was gone. A flapping sensor opens alerts that are
  // never announced (see runOfflineCheck), and announcing their recoveries would be the same
  // flood in green.
  const shouldNotify = open.some((a) => a.lastNotifiedAt !== null);

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
        chatId: chatFor(sensor.location.organization),
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
    // A deactivated restaurant's sensors are expected to fall silent; that is not an outage.
    where: { location: { deactivatedAt: null } },
    include: {
      location: locationWithChat,
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
  // Down, up, down again is one episode, not a message every cycle. San Bernardino's walk-in
  // sensor lost three packets in a row sixteen times in a day; the group got sixteen messages
  // about a sensor that was working. The alert is still recorded — only the message is held.
  const justResolved = await prisma.alert.findMany({
    where: { type: "offline", resolvedAt: { gte: new Date(now.getTime() - NOTIFY_COOLDOWN_MIN * 60_000) } },
    select: { unitId: true },
  });
  const flapping = new Set(justResolved.map((a) => a.unitId));

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
      const settled = missing.every((u) => !flapping.has(u.id));
      // Location-wide: one message per location per check; per-sensor otherwise
      const willNotify = settled && (locationWide ? !locationNotified.has(sensor.locationId) : true);
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
            chatId: chatFor(sensor.location.organization),
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
