import "./load-env";
import { prisma } from "../src/lib/db";
import { parseTtnUplink } from "../src/lib/ttn/parse";

/**
 * Who has been talking to us without being mapped: every dev_eui in UnknownUplink, with what
 * its last packet said. Read-only. For wiring up a new restaurant: it tells the device type
 * (LTC2 or LHT65N) and shows the per-channel temperatures, so "which channel is the freezer"
 * is answered by the numbers rather than guessed.
 *
 *   npm run sensors:unknown
 */

const rows = await prisma.unknownUplink.groupBy({
  by: ["devEui"],
  _count: { _all: true },
  _min: { receivedAt: true },
  _max: { receivedAt: true },
  orderBy: { _max: { receivedAt: "desc" } },
});
if (!rows.length) {
  console.log("Неизвестных устройств нет: все пакеты от известных датчиков.");
} else {
  console.log(`Неизвестных устройств: ${rows.length}\n`);
}
for (const r of rows) {
  const last = await prisma.unknownUplink.findFirst({ where: { devEui: r.devEui }, orderBy: { receivedAt: "desc" } });
  const p = last ? parseTtnUplink(last.payload, last.receivedAt) : null;
  const id = (last?.payload as { end_device_ids?: { device_id?: string } } | null)?.end_device_ids?.device_id ?? "";
  let what = "не разобрано";
  if (p?.ok) {
    const u = p.uplink;
    const ch = u.channels.map((c) => `ch${c.channel} ${c.tempF.toFixed(1)}°F`).join(", ");
    const air = u.ambientTempF !== undefined ? `, воздух ${u.ambientTempF.toFixed(1)}°F` : "";
    what = `${u.nodeType ?? "?"}: ${ch || "каналы пусты"}${air}`;
  } else if (last) {
    what = `не разобрано: ${last.reason ?? "?"}`;
  }
  const span = `${r._min.receivedAt?.toISOString().slice(5, 16)} → ${r._max.receivedAt?.toISOString().slice(5, 16)}`;
  console.log(`${r.devEui}  ${id.padEnd(32)} ${String(r._count._all).padStart(5)} пакетов  ${span}\n${"".padEnd(18)}${what}`);
}
await prisma.$disconnect();
