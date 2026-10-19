import type { PrismaClient } from "@/generated/prisma/client";

/**
 * How much of the database's allowance is used, for /api/health.
 *
 * Supabase's free plan gives 500 MB and, above it, switches the database to read-only. Nothing
 * raises an error at that point from our side: the ingest simply stops writing readings, which
 * is the same silent failure that cost two days in September 2026 and that every check in this
 * codebase exists to prevent. Measured 19 Oct 2026 the database was at 10.5% and growing
 * 1.61 MB a day — but the slope is roughly 0.32 MB a day per restaurant, so the date it runs
 * out moves closer with every one onboarded. A number nobody watches is not a plan.
 *
 * `npm run db:usage -- --prod` is still the detailed view — per table, per day, days left. This
 * is only the one number, cheap enough to sit on an endpoint that is polled.
 */

/** Supabase free plan. Change this with the plan, not with the usage. */
export const DB_LIMIT_MB = 500;

/** Where "plenty of room" turns into something worth acting on. */
export const DB_WARN_PERCENT = 80;

/**
 * The size is asked for at most this often. `pg_database_size` is cheap but not free, and
 * /api/health is polled by Render's health check — a megabyte does not move in a minute.
 */
export const MEASURE_EVERY_MS = 60 * 60_000;

export interface DbSize {
  usedMb: number;
  limitMb: number;
  percent: number;
  /** True once the warning threshold is crossed; /api/health turns degraded on it. */
  low: boolean;
  measuredAt: string;
}

const g = globalThis as unknown as { __qimbyDbSize?: { at: number; value: DbSize | null } };
const cache = (g.__qimbyDbSize ??= { at: 0, value: null });

/**
 * The cached size, measuring again when the cache is stale.
 *
 * Returns null when the size cannot be read — an older Postgres, a role without permission, a
 * database that is simply busy. Health reports the null rather than failing: not knowing the
 * size is not a reason to stop answering whether the readings are arriving.
 */
export async function dbSize(db: PrismaClient, now = Date.now()): Promise<DbSize | null> {
  if (cache.value && now - cache.at < MEASURE_EVERY_MS) return cache.value;
  try {
    const [{ size }] = await db.$queryRawUnsafe<{ size: bigint }[]>(
      `SELECT pg_database_size(current_database()) AS size`,
    );
    const usedMb = Number(size) / 1024 / 1024;
    const percent = (usedMb / DB_LIMIT_MB) * 100;
    cache.at = now;
    cache.value = {
      usedMb: Math.round(usedMb * 10) / 10,
      limitMb: DB_LIMIT_MB,
      percent: Math.round(percent * 10) / 10,
      low: percent >= DB_WARN_PERCENT,
      measuredAt: new Date(now).toISOString(),
    };
    return cache.value;
  } catch {
    // Keep whatever was measured before rather than replacing a real number with nothing.
    return cache.value;
  }
}

/** Only for tests: forget the measurement so the next call takes a fresh one. */
export function resetDbSizeCache(): void {
  cache.at = 0;
  cache.value = null;
}
