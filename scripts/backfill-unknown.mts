import "./load-env";
import { prisma } from "../src/lib/db";
import { parseTtnUplink } from "../src/lib/ttn/parse";

/**
 * Turns stored raw uplinks into readings, for devices that were unknown when they arrived.
 *
 *   npm run backfill:unknown              # dry run — says what it would recover
 *   npm run backfill:unknown -- --yes
 *
 * A sensor that reports before anyone has mapped it is not lost: the whole payload goes to
 * UnknownUplink and the ingest answers 200 so TTN does not retry. This reads those rows back
 * through the same parser the live path uses, so a restaurant wired up at noon still has its
 * morning.
 *
 * Rows whose device is still unknown are left alone. Consumed rows are deleted, so running it
 * twice is safe — and readings carry a uniqueness constraint per sensor, channel and instant
 * anyway.
 */

const confirmed = process.argv.includes("--yes");

const known = await prisma.sensor.findMany({
  include: { channels: { include: { unit: { select: { id: true, name: true, type: true } } } }, location: true },
});
const byEui = new Map(known.map((s) => [s.devEui, s]));

const rows = await prisma.unknownUplink.findMany({ orderBy: { receivedAt: "asc" } });
console.log(`сырых пакетов в базе: ${rows.length}`);

interface Pending {
  id: number;
  sensorId: string;
  unitId: string;
  unitName: string;
  location: string;
  channel: number;
  tempF: number;
  probeTempF: number | null;
  measuredAt: Date;
}

const pending: Pending[] = [];
const skipped = new Map<string, number>();
const consumed = new Set<number>();

for (const row of rows) {
  const sensor = byEui.get(row.devEui);
  if (!sensor) {
    skipped.set(row.devEui, (skipped.get(row.devEui) ?? 0) + 1);
    continue;
  }
  const parsed = parseTtnUplink(row.payload, row.receivedAt);
  if (!parsed.ok) {
    skipped.set(`${row.devEui} (не разобрался)`, (skipped.get(`${row.devEui} (не разобрался)`) ?? 0) + 1);
    continue;
  }
  const u = parsed.uplink;
  // Even a packet that yields no reading is now accounted for — the device is known, and the
  // row has nothing left to tell us.
  consumed.add(row.id);

  for (const ch of u.channels) {
    const mapping = sensor.channels.find((c) => c.channel === ch.channel);
    if (!mapping?.unitId || !mapping.unit) continue;

    // Same rule as the live ingest: an AC is judged by the room, which is the built-in air
    // sensor where there is one and the mapped probe where there is not.
    const isAC = mapping.unit.type === "ac";
    const hasBuiltInAir = u.ambientTempF !== undefined;
    const tempF = isAC && hasBuiltInAir ? u.ambientTempF : ch.tempF;
    const probeTempF = !isAC
      ? null
      : hasBuiltInAir
        ? ch.tempF
        : (u.channels.find((c) => c.channel !== ch.channel)?.tempF ?? null);
    if (tempF === undefined) continue;

    pending.push({
      id: row.id,
      sensorId: sensor.id,
      unitId: mapping.unitId,
      unitName: mapping.unit.name,
      location: sensor.location.name,
      channel: ch.channel,
      tempF,
      probeTempF,
      measuredAt: u.receivedAt,
    });
  }
}

const byUnit = new Map<string, Pending[]>();
for (const p of pending) {
  const key = `${p.location} · ${p.unitName}`;
  byUnit.set(key, [...(byUnit.get(key) ?? []), p]);
}

console.log(`\nвосстановится показаний: ${pending.length}`);
for (const [key, ps] of [...byUnit].sort()) {
  const t = ps.map((p) => p.tempF);
  console.log(
    `  ${key.padEnd(38)} ${String(ps.length).padStart(3)} шт · ` +
      `${Math.min(...t).toFixed(1)}…${Math.max(...t).toFixed(1)} °F · ` +
      `с ${ps[0].measuredAt.toISOString().slice(11, 16)} по ${ps[ps.length - 1].measuredAt.toISOString().slice(11, 16)}`,
  );
}

if (skipped.size) {
  console.log(`\nоставлено как есть (устройство всё ещё неизвестно):`);
  for (const [eui, n] of [...skipped].sort((a, b) => b[1] - a[1])) console.log(`  ${eui} ×${n}`);
}

if (!confirmed) {
  console.log(`\nПробный прогон. Повтори с --yes, чтобы записать. Ничего не изменено.`);
  await prisma.$disconnect();
  process.exit(0);
}

const res = await prisma.reading.createMany({
  data: pending.map(({ unitId, sensorId, channel, tempF, probeTempF, measuredAt }) => ({
    unitId,
    sensorId,
    channel,
    tempF,
    probeTempF,
    measuredAt,
  })),
  skipDuplicates: true,
});
const removed = await prisma.unknownUplink.deleteMany({ where: { id: { in: [...consumed] } } });

console.log(`\nЗаписано показаний: ${res.count} (дубликатов пропущено ${pending.length - res.count})`);
console.log(`Сырых пакетов разобрано и убрано: ${removed.count}`);
console.log(`Осталось неизвестных: ${await prisma.unknownUplink.count()}`);
await prisma.$disconnect();
