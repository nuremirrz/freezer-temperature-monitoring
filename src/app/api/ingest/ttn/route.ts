import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseTtnUplink } from "@/lib/ttn/parse";
import { processNewReading, resolveOfflineForSensor } from "@/lib/alerts/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ingest/ttn — The Things Network webhook (Uplink message only).
 *
 * 1. X-Webhook-Secret must match TTN_WEBHOOK_SECRET → otherwise 401
 * 2. Parse tolerantly; unknown dev_eui → UnknownUplink, 200
 * 3. One Reading per connected channel (duplicates ignored), sensor + gateway heartbeat
 * 4. Alerts are evaluated after the writes; notifications never block the response
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
      data: { devEui: "UNPARSEABLE", payload: body as object, receivedAt: now },
    });
    return NextResponse.json({ status: "unparseable", error: parsed.error }, { status: 200 });
  }
  const u = parsed.uplink;

  const sensor = await prisma.sensor.findUnique({
    where: { devEui: u.devEui },
    include: { channels: true },
  });

  if (!sensor) {
    await prisma.unknownUplink.create({
      data: { devEui: u.devEui, payload: body as object, receivedAt: u.receivedAt },
    });
    return NextResponse.json({ status: "unknown_device", devEui: u.devEui }, { status: 200 });
  }

  // Readings — one per channel that is both reporting and wired to a unit
  const inserted: { unitId: string; channel: number; tempF: number }[] = [];
  const unmapped: number[] = [];
  for (const ch of u.channels) {
    const mapping = sensor.channels.find((c) => c.channel === ch.channel);
    if (!mapping?.unitId) {
      unmapped.push(ch.channel);
      continue;
    }
    const res = await prisma.reading.createMany({
      data: [
        {
          unitId: mapping.unitId,
          sensorId: sensor.id,
          channel: ch.channel,
          tempF: ch.tempF,
          measuredAt: u.receivedAt,
        },
      ],
      skipDuplicates: true,
    });
    if (res.count > 0) inserted.push({ unitId: mapping.unitId, channel: ch.channel, tempF: ch.tempF });
  }

  // Heartbeats: only overwrite fields the uplink actually carried
  const seenAt = sensor.lastSeenAt && sensor.lastSeenAt > u.receivedAt ? sensor.lastSeenAt : u.receivedAt;
  await prisma.sensor.update({
    where: { id: sensor.id },
    data: {
      lastSeenAt: seenAt,
      ...(u.deviceId !== undefined ? { ttnDeviceId: u.deviceId } : {}),
      ...(u.batteryV !== undefined ? { batteryV: u.batteryV } : {}),
      ...(u.batteryPct !== undefined ? { batteryPct: u.batteryPct } : {}),
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

  // Alerts — after the writes. Cheap queries; notifications inside are fire-and-forget.
  try {
    await resolveOfflineForSensor(sensor.id, now);
    for (const r of inserted) {
      await processNewReading(
        { unitId: r.unitId, sensorId: sensor.id, channel: r.channel, tempF: r.tempF, measuredAt: u.receivedAt },
        now,
      );
    }
  } catch (err) {
    // The readings are already stored; alert evaluation must not turn a stored uplink into an error
    console.error("[ingest] alert evaluation failed:", err instanceof Error ? err.message : err);
  }

  return NextResponse.json(
    {
      status: "ok",
      devEui: u.devEui,
      measuredAt: u.receivedAt.toISOString(),
      readings: inserted.length,
      duplicates: u.channels.length - unmapped.length - inserted.length,
      skippedChannels: u.skippedChannels,
      unmappedChannels: unmapped,
      ...(u.receivedAtFallback ? { warning: "received_at missing — used server time" } : {}),
    },
    { status: 200 },
  );
}
