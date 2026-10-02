import "./load-env";
import { prisma } from "../src/lib/db";

/**
 * One unit's last days, hour by hour, in the restaurant's local time. Read-only.
 *
 *   npm run unit:history -- --location "Burger King #4808" --unit "AC4 - Kitchen"
 *   npm run unit:history -- --location "Burger King #4808" --unit "AC4 - Kitchen" --hours 48
 *
 * For looking at a unit without signing in: min / avg / max of what it is judged by and,
 * for an AC, of the duct beside it, with the normal band so an excursion stands out.
 */

const arg = (n: string) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : undefined; };
const locationName = arg("--location");
const unitName = arg("--unit");
const hours = Number(arg("--hours") ?? 72);
if (!locationName || !unitName) {
  console.error('Нужны оба:  npm run unit:history -- --location "Burger King #4808" --unit "AC4 - Kitchen" [--hours 72]');
  process.exit(1);
}

const unit = await prisma.unit.findFirst({
  where: { name: unitName, location: { name: locationName } },
  include: { location: { select: { name: true, timezone: true } } },
});
if (!unit) {
  console.error(`Нет юнита "${unitName}" в "${locationName}"`);
  process.exit(1);
}
const since = new Date(Date.now() - hours * 3600_000);
const rows = await prisma.reading.findMany({
  where: { unitId: unit.id, measuredAt: { gte: since } },
  orderBy: { measuredAt: "asc" },
  select: { measuredAt: true, tempF: true, probeTempF: true },
});

const isAC = unit.type === "ac";
console.log(`${unit.location.name} · ${unit.name} (${unit.type}) — последние ${hours} ч, время местное (${unit.location.timezone})`);
console.log(`норма ${unit.rangeMinF}…${unit.rangeMaxF}°F, тревога ${unit.alertMinF ?? unit.rangeMinF}…${unit.alertMaxF ?? unit.rangeMaxF}°F${isAC ? `, дакт норма ${unit.probeMinF ?? "—"}…${unit.probeMaxF ?? "—"}°F` : ""}`);
console.log(`показаний: ${rows.length}\n`);

const fmt = new Intl.DateTimeFormat("ru-RU", { timeZone: unit.location.timezone, month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false });
interface Bucket { n: number; min: number; max: number; sum: number; dn: number; dmin: number; dmax: number; dsum: number }
const buckets = new Map<string, Bucket>();
for (const r of rows) {
  const key = fmt.format(r.measuredAt);
  const b = buckets.get(key) ?? { n: 0, min: Infinity, max: -Infinity, sum: 0, dn: 0, dmin: Infinity, dmax: -Infinity, dsum: 0 };
  b.n++; b.sum += r.tempF; b.min = Math.min(b.min, r.tempF); b.max = Math.max(b.max, r.tempF);
  if (r.probeTempF !== null) { b.dn++; b.dsum += r.probeTempF; b.dmin = Math.min(b.dmin, r.probeTempF); b.dmax = Math.max(b.dmax, r.probeTempF); }
  buckets.set(key, b);
}
const hi = unit.alertMaxF ?? unit.rangeMaxF;
const lo = unit.alertMinF ?? unit.rangeMinF;
console.log(`${"час".padEnd(14)} ${"n".padStart(3)}   ${"комната min/avg/max".padEnd(26)}${isAC ? "   дакт min/avg/max" : ""}`);
for (const [key, b] of buckets) {
  const room = `${b.min.toFixed(0)} / ${(b.sum / b.n).toFixed(0)} / ${b.max.toFixed(0)}`;
  const flag = b.max > hi ? " ▲ выше тревоги" : b.max > unit.rangeMaxF ? " ↑ выше нормы" : b.min < lo ? " ▼ ниже тревоги" : "";
  const duct = isAC ? (b.dn ? `   ${b.dmin.toFixed(0)} / ${(b.dsum / b.dn).toFixed(0)} / ${b.dmax.toFixed(0)}` : "   —") : "";
  console.log(`${key.padEnd(14)} ${String(b.n).padStart(3)}   ${room.padEnd(26)}${duct}${flag}`);
}
await prisma.$disconnect();
