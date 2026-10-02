import "./load-env";
import { prisma } from "../src/lib/db";

/**
 * How much of the database we are using and how fast it grows. Read-only.
 *
 *   npm run db:usage
 *
 * Supabase's free plan allows 500 MB and switches the database to read-only above that, which
 * for us would mean no readings written at all — the same silence as the sequence collision,
 * from a different cause. This says how long the current rate leaves us.
 */

const LIMIT_MB = 500;
const mb = (bytes: bigint | number) => Number(bytes) / 1024 / 1024;

const [{ size }] = await prisma.$queryRawUnsafe<{ size: bigint }[]>(`SELECT pg_database_size(current_database()) AS size`);
const tables = await prisma.$queryRawUnsafe<{ name: string; total: bigint; rows: bigint }[]>(`
  SELECT c.relname AS name, pg_total_relation_size(c.oid) AS total, c.reltuples::bigint AS rows
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
  ORDER BY pg_total_relation_size(c.oid) DESC
`);
const now = Date.now();
const [readings, lastWeek, lastDay] = await Promise.all([
  prisma.reading.count(),
  prisma.reading.count({ where: { measuredAt: { gte: new Date(now - 7 * 24 * 3600_000) } } }),
  prisma.reading.count({ where: { measuredAt: { gte: new Date(now - 24 * 3600_000) } } }),
]);
const readingTable = tables.find((t) => t.name === "Reading");
const bytesPerReading = readingTable && readings ? Number(readingTable.total) / readings : 0;
const perDay = Math.max(lastDay, Math.round(lastWeek / 7));
const growthMbPerDay = (perDay * bytesPerReading) / 1024 / 1024;
const left = LIMIT_MB - mb(size);

console.log(`База: ${mb(size).toFixed(1)} МБ из ${LIMIT_MB} МБ (${((mb(size) / LIMIT_MB) * 100).toFixed(1)}%)\n`);
console.log(`${"таблица".padEnd(16)} ${"МБ".padStart(7)}   строк`);
for (const t of tables.slice(0, 8)) console.log(`${t.name.padEnd(16)} ${mb(t.total).toFixed(2).padStart(7)}   ${Number(t.rows).toLocaleString("ru")}`);
console.log(`\nПоказаний всего: ${readings.toLocaleString("ru")}, за сутки: ${lastDay.toLocaleString("ru")}, за неделю: ${lastWeek.toLocaleString("ru")}`);
console.log(`Одно показание с индексами: ~${Math.round(bytesPerReading)} байт → рост ~${growthMbPerDay.toFixed(2)} МБ/день, ~${(growthMbPerDay * 30).toFixed(0)} МБ/месяц`);
if (growthMbPerDay > 0) {
  const days = left / growthMbPerDay;
  console.log(`При нынешнем потоке лимит кончится примерно через ${Math.round(days)} дней (${(days / 365).toFixed(1)} года)`);
}
await prisma.$disconnect();
