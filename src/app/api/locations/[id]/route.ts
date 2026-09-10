import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { unauthorized } from "@/lib/auth/http";
import { deriveUnitStatus, deriveLocationStatus } from "@/lib/status";

export const dynamic = "force-dynamic";

interface LatestRow {
  unitId: string;
  tempF: number;
  measuredAt: Date;
}

/** GET /api/locations/[id] — location + units with last reading, status and active alert. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await getSession())) return unauthorized();
  const { id } = await ctx.params;

  const loc = await prisma.location.findUnique({
    where: { id },
    include: {
      gateways: true,
      units: {
        orderBy: { name: "asc" },
        include: {
          alerts: { where: { resolvedAt: null }, orderBy: { openedAt: "asc" } },
          channels: { include: { sensor: true } },
        },
      },
    },
  });
  if (!loc) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Latest reading per unit in one query (DISTINCT ON keeps the newest row per unit)
  const unitIds = loc.units.map((u) => u.id);
  const latest = new Map<string, LatestRow>();
  if (unitIds.length) {
    const placeholders = unitIds.map((_, i) => `$${i + 1}`).join(", ");
    const rows = await prisma.$queryRawUnsafe<LatestRow[]>(
      `SELECT DISTINCT ON ("unitId") "unitId", "tempF", "measuredAt"
       FROM "Reading"
       WHERE "unitId" IN (${placeholders})
       ORDER BY "unitId", "measuredAt" DESC`,
      ...unitIds,
    );
    for (const r of rows) latest.set(r.unitId, r);
  }

  const units = loc.units.map((u) => {
    const last = latest.get(u.id);
    const status = deriveUnitStatus(u.alerts, Boolean(last));
    const temp = u.alerts.find((a) => a.type === "temp_out_of_range");
    const offline = u.alerts.find((a) => a.type === "offline");
    const active = temp ?? offline ?? null;
    const channel = u.channels[0];
    return {
      id: u.id,
      type: u.type,
      name: u.name,
      model: u.model,
      serial: u.serial,
      year: u.year,
      rangeMinF: u.rangeMinF,
      rangeMaxF: u.rangeMaxF,
      status,
      lastReading: last ? { tempF: last.tempF, measuredAt: last.measuredAt.toISOString() } : null,
      activeAlert: active
        ? {
            id: active.id,
            type: active.type,
            openedAt: active.openedAt.toISOString(),
            peakTempF: active.peakTempF,
          }
        : null,
      sensor: channel
        ? {
            id: channel.sensor.id,
            devEui: channel.sensor.devEui,
            nodeType: channel.sensor.nodeType,
            channel: channel.channel,
            expectedIntervalSec: channel.sensor.expectedIntervalSec,
            batteryV: channel.sensor.batteryV,
            batteryPct: channel.sensor.batteryPct,
            batStatus: channel.sensor.batStatus,
            ambientTempF: channel.sensor.ambientTempF,
            ambientHum: channel.sensor.ambientHum,
            lastRssi: channel.sensor.lastRssi,
            lastSnr: channel.sensor.lastSnr,
            lastSeenAt: channel.sensor.lastSeenAt?.toISOString() ?? null,
          }
        : null,
    };
  });

  return NextResponse.json({
    id: loc.id,
    name: loc.name,
    address: loc.address,
    city: loc.city,
    state: loc.state,
    zip: loc.zip,
    lat: loc.lat,
    lng: loc.lng,
    timezone: loc.timezone,
    status: deriveLocationStatus(units.map((u) => u.status)),
    gateways: loc.gateways.map((g) => ({
      id: g.id,
      ttnGatewayId: g.ttnGatewayId,
      eui: g.eui,
      lastSeenAt: g.lastSeenAt?.toISOString() ?? null,
    })),
    units,
  });
}
