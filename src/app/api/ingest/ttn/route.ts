import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseTtnUplink, ParsedUplink } from "@/lib/ttn/parse";
import { processNewReading, resolveOfflineForSensor } from "@/lib/alerts/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ingest/ttn — The Things Network webhook (Uplink message only).
 *
 * 1. X-Webhook-Secret must match TTN_WEBHOOK_SECRET → otherwise 401
 * 2. Parse tolerantly; the branch (LTC2 / LHT65N) is chosen by Node_type
 * 3. Unknown dev_eui or unknown Node_type → UnknownUplink (with a reason), 200
 * 4. One Reading per connected + mapped channel (duplicates ignored);
 *    sensor heartbeat, battery, ambient (LHT65N) and gateway heartbeat are updated
 * 5. Alerts are evaluated after the writes; notifications never block the response
 */
export async function POST(req: NextRequest) {
  const secret = process.env.TTN_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "TTN_WEBHOOK_SECRET is not configured" }, { status: 500 });
  }
  if (req.headers.get("x-webhook-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const now = new Date();
  const parsed = parseTtnUplink(body, now);
  if (!parsed.ok) {
    // Can't attribute it to a device, but don't lose it either
    await prisma.unknownUplink.create({
      data: { devEui: "UNPARSEABLE", reason: `unparseable: ${parsed.error}`, payload: body as object, receivedAt: now },
    });
    return NextResponse.json({ status: "unparseable", error: parsed.error }, { status: 200 });
  }
  const u = parsed.uplink;

  const sensor = await prisma.sensor.findUnique({
    where: { devEui: u.devEui },
    include: { channels: { include: { unit: { select: { type: true } } } } },
  });

  if (!sensor) {
    await prisma.unknownUplink.create({
      data: { devEui: u.devEui, reason: "unknown_device", payload: body as object, receivedAt: u.receivedAt },
    });
    return NextResponse.json({ status: "unknown_device", devEui: u.devEui, nodeType: u.nodeType ?? null }, { status: 200 });
  }

  // Heartbeat first — the device is alive even if we can't read its temperatures.
  // Only overwrite fields the uplink actually carried.
  const seenAt = sensor.lastSeenAt && sensor.lastSeenAt > u.receivedAt ? sensor.lastSeenAt : u.receivedAt;
  await prisma.sensor.update({
    where: { id: sensor.id },
    data: {
      lastSeenAt: seenAt,
      ...(u.nodeType !== undefined ? { nodeType: u.nodeType } : {}),
      ...(u.deviceId !== undefined ? { ttnDeviceId: u.deviceId } : {}),
      ...(u.batteryV !== undefined ? { batteryV: u.batteryV } : {}),
      ...(u.batteryPct !== undefined ? { batteryPct: u.batteryPct } : {}),
      ...(u.batStatus !== undefined ? { batStatus: u.batStatus } : {}),
      ...(u.ambientTempF !== undefined ? { ambientTempF: u.ambientTempF } : {}),
      ...(u.ambientHum !== undefined ? { ambientHum: u.ambientHum } : {}),
      ...(u.channels[0] ? { probeTempF: u.channels[0].tempF } : {}),
      ...(u.gateway?.rssi !== undefined ? { lastRssi: Math.round(u.gateway.rssi) } : {}),
      ...(u.gateway?.snr !== undefined ? { lastSnr: u.gateway.snr } : {}),
    },
  });
  if (u.gateway?.gatewayId) {
    await prisma.gateway.updateMany({
      where: { ttnGatewayId: u.gateway.gatewayId },
      data: { lastSeenAt: seenAt },
    });
  }

  if (u.unsupportedNodeType) {
    // A decoder we don't know: keep the payload for inspection, don't invent readings
    await prisma.unknownUplink.create({
      data: {
        devEui: u.devEui,
        reason: `unsupported_node_type:${u.nodeType ?? "missing"}`,
        payload: body as object,
        receivedAt: u.receivedAt,
      },
    });
    await safeAlerts(() => resolveOfflineForSensor(sensor.id, now));
    return NextResponse.json(
      { status: "unsupported_node_type", devEui: u.devEui, nodeType: u.nodeType ?? null },
      { status: 200 },
    );
  }

  // Readings — one per channel that is both reporting and wired to a unit.
  //
  // An AC is the exception: its probe hangs in the supply duct, and the client judges an air
  // conditioner by the room it is meant to be cooling ("АС с дактов нерелевантное
  // измерение"). Where that room reading comes from depends on the hardware:
  //
  //   LHT65N/S — a built-in air sensor reports it, and the single probe is the duct.
  //   LTC2     — no built-in sensor, two external probes instead. Whichever probe was wired
  //              to the unit is the room one; the other is the duct.
  //
  // Either way the unit stores the room as its reading and the duct beside it.
  const inserted: { unitId: string; channel: number; tempF: number }[] = [];
  const unmapped: number[] = [];
  const noRoomTemp: number[] = [];
  for (const ch of u.channels) {
    const mapping = sensor.channels.find((c) => c.channel === ch.channel);
    if (!mapping?.unitId) {
      unmapped.push(ch.channel);
      continue;
    }
    const isAC = mapping.unit?.type === "ac";
    const hasBuiltInAir = u.ambientTempF !== undefined;
    const tempF = isAC && hasBuiltInAir ? u.ambientTempF : ch.tempF;
    const ductTempF = !isAC
      ? null
      : hasBuiltInAir
        ? ch.tempF
        : (u.channels.find((c) => c.channel !== ch.channel)?.tempF ?? null);
    if (tempF === undefined) {
      // An AC whose uplink carried no room temperature at all: recording the duct value
      // instead would quietly compare the wrong number against the unit's range.
      noRoomTemp.push(ch.channel);
      continue;
    }
    const res = await prisma.reading.createMany({
      data: [
        {
          unitId: mapping.unitId,
          sensorId: sensor.id,
          channel: ch.channel,
          tempF,
          // Kept beside it so the AC chart can draw the duct line over time, not just now
          probeTempF: ductTempF,
          measuredAt: u.receivedAt,
        },
      ],
      skipDuplicates: true,
    });
    if (res.count > 0) inserted.push({ unitId: mapping.unitId, channel: ch.channel, tempF });
  }

  // Alerts — after the writes. Cheap queries; notifications inside are fire-and-forget.
  await safeAlerts(async () => {
    await resolveOfflineForSensor(sensor.id, now);
    for (const r of inserted) {
      await processNewReading(
        { unitId: r.unitId, sensorId: sensor.id, channel: r.channel, tempF: r.tempF, measuredAt: u.receivedAt },
        now,
      );
    }
  });

  return NextResponse.json(summary(u, inserted.length, unmapped, noRoomTemp), { status: 200 });
}

/** The readings are already stored; alert evaluation must not turn a stored uplink into an error. */
async function safeAlerts(fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    console.error("[ingest] alert evaluation failed:", err instanceof Error ? err.message : err);
  }
}

function summary(u: ParsedUplink, readings: number, unmapped: number[], noRoomTemp: number[] = []) {
  return {
    status: "ok",
    devEui: u.devEui,
    nodeType: u.nodeType ?? null,
    measuredAt: u.receivedAt.toISOString(),
    readings,
    duplicates: u.channels.length - unmapped.length - noRoomTemp.length - readings,
    skippedChannels: u.skippedChannels,
    unmappedChannels: unmapped,
    ...(noRoomTemp.length ? { noRoomTemperature: noRoomTemp } : {}),
    ...(u.ambientTempF !== undefined || u.ambientHum !== undefined
      ? { ambient: { tempF: u.ambientTempF ?? null, hum: u.ambientHum ?? null } }
      : {}),
    ...(u.receivedAtFallback ? { warning: "received_at missing — used server time" } : {}),
  };
}
