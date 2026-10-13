import "./load-env";
import { prodIfAsked } from "./prod-url";
import { parseTtnUplink } from "../src/lib/ttn/parse";
import { readingsFromUplink } from "../src/lib/ttn/readings";
import { insertReadings } from "../src/lib/readings/write";

/**
 * Turns stored raw uplinks into readings, for devices that were unknown when they arrived.
 *
 *   npm run backfill:unknown                               # dry run — says what it would recover
 *   npm run backfill:unknown -- --yes
 *   npm run backfill:unknown -- --since 2026-10-12T22:30Z   # and forget whatever came before
 *   npm run backfill:unknown -- --prod                      # production; asks for the URL, typed blind
 *   npm run backfill:unknown -- --prod --trace A8404178…    # every packet of one device, to pick the cutoff
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

/**
 * `--since` is for a device that lived somewhere else before it was installed. San Diego's
 * walk-in sensor spent weeks on our bench as `draginotst2`, reporting room temperature into
 * UnknownUplink; replaying all of that would write bench readings into a freezer's history and
 * raise alerts on them. Packets older than the cutoff are forgotten rather than left behind,
 * so a later run without the flag cannot resurrect them.
 */
const confirmed = process.argv.includes("--yes");
const sinceArg = (() => {
  const i = process.argv.indexOf("--since");
  return i > -1 ? process.argv[i + 1] : undefined;
})();
const since = sinceArg ? Date.parse(sinceArg) : null;
/** Read-only: print one device's packets so the cutoff is chosen by looking, not by guessing. */
const traceArg = (() => {
  const i = process.argv.indexOf("--trace");
  return i > -1 ? process.argv[i + 1]?.toUpperCase() : undefined;
})();
if (sinceArg && !Number.isFinite(since)) {
  console.error(`--since не похоже на время: ${sinceArg}`);
  process.exit(2);
}

await prodIfAsked();
const { prisma } = await import("../src/lib/db");

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
/** Known device, but from before the cutoff: not history, and not worth keeping. */
const stale = new Map<string, { n: number; first: Date; last: Date }>();
const toForget = new Set<number>();

for (const row of rows) {
  const sensor = byEui.get(row.devEui);
  if (!sensor) {
    skipped.set(row.devEui, (skipped.get(row.devEui) ?? 0) + 1);
    continue;
  }
  if (since !== null && row.receivedAt.getTime() < since) {
    const seen = stale.get(row.devEui);
    stale.set(row.devEui, {
      n: (seen?.n ?? 0) + 1,
      first: seen?.first ?? row.receivedAt,
      last: row.receivedAt,
    });
    toForget.add(row.id);
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

  const mappings = sensor.channels.flatMap((c) => (c.unitId && c.unit ? [{ channel: c.channel, unitId: c.unitId, unitType: c.unit.type }] : []));
  for (const r of readingsFromUplink(u, mappings).readings) {
    pending.push({
      id: row.id,
      sensorId: sensor.id,
      unitId: r.unitId,
      unitName: sensor.channels.find((c) => c.unitId === r.unitId)?.unit?.name ?? r.unitId,
      location: sensor.location.name,
      channel: r.channel,
      tempF: r.tempF,
      probeTempF: r.probeTempF,
      measuredAt: u.receivedAt,
    });
  }
}

const byUnit = new Map<string, Pending[]>();
for (const p of pending) {
  const key = `${p.location} · ${p.unitName}`;
  byUnit.set(key, [...(byUnit.get(key) ?? []), p]);
}

if (traceArg) {
  const rows = await prisma.unknownUplink.findMany({
    where: { devEui: traceArg },
    orderBy: { receivedAt: "asc" },
    select: { receivedAt: true, payload: true },
  });
  console.log(`\nпакеты ${traceArg}: ${rows.length}`);
  for (const row of rows) {
    const p = parseTtnUplink(row.payload, row.receivedAt);
    const what = p.ok
      ? p.uplink.channels.map((c) => `ch${c.channel} ${c.tempF.toFixed(1)}°F`).join("  ") +
        (p.uplink.ambientTempF !== undefined ? `  воздух ${p.uplink.ambientTempF.toFixed(1)}°F` : "")
      : "не разобрано";
    console.log(`  ${row.receivedAt.toISOString().slice(5, 16).replace("T", " ")}  ${what}`);
  }
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

if (stale.size) {
  const when = new Date(since!).toISOString().slice(0, 16).replace("T", " ");
  console.log(`\nбудет забыто как снятое до ${when} UTC:`);
  for (const [eui, s] of [...stale].sort((a, b) => b[1].n - a[1].n)) {
    const span = `${s.first.toISOString().slice(5, 16)} → ${s.last.toISOString().slice(5, 16)}`;
    console.log(`  ${eui} ×${s.n}  ${span}`);
  }
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

const res = {
  count: (
    await insertReadings(
      prisma,
      pending.map(({ unitId, sensorId, channel, tempF, probeTempF, measuredAt }) => ({ unitId, sensorId, channel, tempF, probeTempF, measuredAt })),
    )
  ).length,
};
const removed = await prisma.unknownUplink.deleteMany({ where: { id: { in: [...consumed] } } });
const forgotten = toForget.size
  ? (await prisma.unknownUplink.deleteMany({ where: { id: { in: [...toForget] } } })).count
  : 0;

console.log(`\nЗаписано показаний: ${res.count} (дубликатов пропущено ${pending.length - res.count})`);
console.log(`Сырых пакетов разобрано и убрано: ${removed.count}`);
if (forgotten) console.log(`Забыто как снятое до отсечки: ${forgotten}`);

// A sensor that was unknown has never been "seen" as far as the offline check knows, and a
// freshly wired restaurant would open an offline alert per unit until each device's next
// live packet — six Telegram messages for nothing. The packets just replayed prove the device
// was talking all along, so its lastSeenAt moves to the newest of them.
let bumped = 0;
const latestBySensor = new Map<string, Date>();
for (const p of pending) {
  const cur = latestBySensor.get(p.sensorId);
  if (!cur || p.measuredAt > cur) latestBySensor.set(p.sensorId, p.measuredAt);
}
for (const [sensorId, latest] of latestBySensor) {
  const s = await prisma.sensor.findUnique({ where: { id: sensorId }, select: { lastSeenAt: true } });
  if (s && (!s.lastSeenAt || latest > s.lastSeenAt)) {
    await prisma.sensor.update({ where: { id: sensorId }, data: { lastSeenAt: latest } });
    bumped++;
  }
}
console.log(`lastSeenAt сдвинут вперёд у ${bumped} датчиков`);
console.log(`Осталось неизвестных: ${await prisma.unknownUplink.count()}`);
await prisma.$disconnect();
