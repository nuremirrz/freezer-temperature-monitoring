import "./load-env";
import { prisma } from "../src/lib/db";

/**
 * What the unit chart would find, unit by unit: how many readings the last day and the last
 * week hold, and when the newest one landed. Read-only. For "the chart is empty" reports —
 * it separates "nothing was recorded" from "something was recorded and is not drawn".
 *
 *   npm run chart:check
 */

const units = await prisma.unit.findMany({
  where: { location: { deactivatedAt: null } },
  select: { id: true, name: true, type: true, location: { select: { name: true } } },
  orderBy: [{ location: { name: "asc" } }, { name: "asc" }],
});
const now = Date.now();
const day = new Date(now - 24 * 3600_000);
const week = new Date(now - 7 * 24 * 3600_000);

console.log(`${"ресторан · юнит".padEnd(44)} ${"24ч".padStart(5)} ${"7д".padStart(6)}   последнее показание`);
for (const u of units) {
  const [d, w, last] = await Promise.all([
    prisma.reading.count({ where: { unitId: u.id, measuredAt: { gte: day } } }),
    prisma.reading.count({ where: { unitId: u.id, measuredAt: { gte: week } } }),
    prisma.reading.findFirst({ where: { unitId: u.id }, orderBy: { measuredAt: "desc" }, select: { measuredAt: true, tempF: true } }),
  ]);
  const age = last ? `${Math.round((now - last.measuredAt.getTime()) / 60_000)} мин назад, ${Math.round(last.tempF)}°F` : "никогда";
  console.log(`${`${u.location.name} · ${u.name}`.padEnd(44)} ${String(d).padStart(5)} ${String(w).padStart(6)}   ${age}`);
}
await prisma.$disconnect();
