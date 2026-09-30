import "./load-env";
import { prisma } from "../src/lib/db";

/**
 * Checks that every auto-numbered table's counter is ahead of the rows it holds, and moves it
 * there with --fix.
 *
 *   npm run db:sequences            # report only
 *   npm run db:sequences -- --fix   # move each counter past its highest id
 *
 * Why this exists: a restore writes rows with the ids they had, but Postgres's counter for
 * new rows does not follow. It starts at 1, hands out numbers that are free until they are
 * not — and then every insert collides with a restored row. Our inserts say "skip duplicates",
 * which Postgres takes to mean any conflict, so the collision is silent: the sensor is marked
 * as heard, the reading is dropped, nothing is logged. On 29 Sep 2026 that cost two days of
 * readings before anyone noticed an empty chart.
 */

const fix = process.argv.includes("--fix");
const TABLES = ["Reading", "UnknownUplink"] as const;

let broken = 0;
for (const table of TABLES) {
  const seq = `${table}_id_seq`;
  const [{ max }] = await prisma.$queryRawUnsafe<{ max: number | null }[]>(`SELECT max(id)::int AS max FROM "${table}"`);
  const [{ last_value, is_called }] = await prisma.$queryRawUnsafe<{ last_value: bigint; is_called: boolean }[]>(
    `SELECT last_value, is_called FROM "${seq}"`,
  );
  // Before the first nextval, last_value is the start and is_called is false: the next id is
  // last_value itself, not last_value + 1.
  const next = Number(last_value) + (is_called ? 1 : 0);
  const highest = max ?? 0;
  const ok = next > highest;
  console.log(`${table.padEnd(14)} строк до id ${String(highest).padStart(7)}   следующий номер ${String(next).padStart(7)}   ${ok ? "✓" : "✗ СТОЛКНОВЕНИЕ: новые строки молча теряются"}`);
  if (!ok) {
    broken++;
    if (fix) {
      await prisma.$executeRawUnsafe(`SELECT setval('"${seq}"', ${highest}, true)`);
      console.log(`${"".padEnd(14)} → счётчик переставлен на ${highest}, следующий номер ${highest + 1}`);
    }
  }
}
if (broken && !fix) console.log(`\nПовтори с --fix, чтобы переставить счётчики.`);
await prisma.$disconnect();
process.exit(broken && !fix ? 1 : 0);
