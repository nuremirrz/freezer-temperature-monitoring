import "./load-env";
import { prodIfAsked } from "./prod-url";

/**
 * Read-only. Counts the quarter-hour weather samples that never landed, per day.
 *
 * Zero is the normal answer. Between 10 and 20 Oct 2026 it was 2.1% to 4.5% every single day,
 * and the reason turned out to be ours rather than Open-Meteo's: the minute loop asked whether
 * fifteen minutes had passed, its own tick costs a little over a minute, and so every so often
 * a quarter-hour slot was stepped over entirely. Sampling by slot (e705846) ended it — 574
 * slots on 21 Oct without a single gap.
 *
 * This exists because the failure counter on /api/health could not have found that. It lives
 * in memory and resets with every deploy, so on a day with four of them it reads zero and
 * looks like success. A missing sample leaves a hole in WeatherReading, and that survives
 * restarts: it measures the outcome instead of our opinion of it. Reach for this whenever a
 * claim about the weather series has to be true rather than plausible.
 *
 *   npm run weather:gaps                     # the local database
 *   npm run weather:gaps -- --prod --days 10  # production; asks for the URL, typed blind
 */
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : undefined; };
const days = Number(arg("days") ?? 10);

await prodIfAsked();
const { prisma } = await import("../src/lib/db");

const since = new Date(Date.now() - days * 86_400_000);
const locs = await prisma.location.findMany({ where: { deactivatedAt: null }, select: { id: true, name: true } });

// One row per location per quarter hour is what the loop aims for.
const rows = await prisma.weatherReading.findMany({
  where: { measuredAt: { gte: since } },
  select: { locationId: true, measuredAt: true },
});

const byDay = new Map<string, Map<string, Set<number>>>();
for (const r of rows) {
  const day = r.measuredAt.toISOString().slice(0, 10);
  const slot = Math.floor(r.measuredAt.getTime() / (15 * 60_000));
  if (!byDay.has(day)) byDay.set(day, new Map());
  const d = byDay.get(day)!;
  if (!d.has(r.locationId)) d.set(r.locationId, new Set());
  d.get(r.locationId)!.add(slot);
}

console.log("Пропущенные четвертьчасовые замеры погоды, по дням.");
console.log("Ноль — это норма. До 20 окт 2026 было 2–4% каждый день (см. комментарий выше).\n");
console.log(`${"день".padEnd(12)} ${"ресторанов".padStart(10)} ${"ждали".padStart(7)} ${"есть".padStart(6)} ${"дыр".padStart(5)} ${"доля".padStart(6)}`);

for (const day of [...byDay.keys()].sort()) {
  const d = byDay.get(day)!;
  // Only count a location for a day it was actually live: it has at least one sample that day
  let want = 0, have = 0;
  for (const [, slots] of d) {
    const lo = Math.min(...slots), hi = Math.max(...slots);
    want += hi - lo + 1;
    have += slots.size;
  }
  const holes = want - have;
  console.log(
    `${day.padEnd(12)} ${String(d.size).padStart(10)} ${String(want).padStart(7)} ${String(have).padStart(6)} ${String(holes).padStart(5)} ${(want ? ((holes / want) * 100).toFixed(1) + "%" : "—").padStart(6)}`,
  );
}
console.log(`\nвсего ресторанов сейчас: ${locs.length}`);
await prisma.$disconnect();
