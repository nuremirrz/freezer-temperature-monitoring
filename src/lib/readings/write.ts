import { Prisma, type PrismaClient } from "@/generated/prisma/client";

/**
 * The one way a reading enters the database.
 *
 * TTN can deliver the same uplink twice, and replaying from its storage overlaps what the
 * live path already wrote, so a duplicate reading is normal and is skipped. "Duplicate" means
 * exactly one thing: the same probe at the same instant — the unique key on
 * (sensorId, channel, measuredAt). It names that key in the ON CONFLICT clause.
 *
 * It used to say `skipDuplicates`, which Postgres takes as ON CONFLICT DO NOTHING on *any*
 * conflict — including the primary key. When a restore left the id counter behind, every new
 * reading collided on its id and was dropped without a word, for two days (29–30 Sep 2026).
 * Now any other conflict is an error: it is logged, counted for /api/health, and thrown.
 */

export interface ReadingRow {
  unitId: string;
  sensorId: string;
  channel: number;
  tempF: number;
  probeTempF: number | null;
  measuredAt: Date;
}

export interface WriteErrorStatus {
  failures: number;
  lastFailedAt: string | null;
  lastError: string | null;
}

const g = globalThis as unknown as { __qimbyWriteErrors?: WriteErrorStatus };
const status = (g.__qimbyWriteErrors ??= { failures: 0, lastFailedAt: null, lastError: null });

/** For /api/health: zero failures is the only healthy number. */
export function writeErrorStatus(): WriteErrorStatus {
  return { ...status };
}

const CHUNK = 500;

/** Inserts the rows, skipping true duplicates only. Returns the rows that were actually written. */
export async function insertReadings(
  db: Pick<PrismaClient, "$queryRaw">,
  rows: ReadingRow[],
): Promise<{ unitId: string; channel: number; sensorId: string; measuredAt: Date }[]> {
  const written: { unitId: string; channel: number; sensorId: string; measuredAt: Date }[] = [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = Prisma.join(
      chunk.map((r) => Prisma.sql`(${r.unitId}, ${r.sensorId}, ${r.channel}, ${r.tempF}, ${r.probeTempF}, ${r.measuredAt})`),
    );
    try {
      const res = await db.$queryRaw<{ unitId: string; channel: number; sensorId: string; measuredAt: Date }[]>`
        INSERT INTO "Reading" ("unitId", "sensorId", "channel", "tempF", "probeTempF", "measuredAt")
        VALUES ${values}
        ON CONFLICT ("sensorId", "channel", "measuredAt") DO NOTHING
        RETURNING "unitId", "channel", "sensorId", "measuredAt"`;
      written.push(...res);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      status.failures++;
      status.lastFailedAt = new Date().toISOString();
      status.lastError = message.slice(0, 300);
      console.error(`[readings] write failed for ${chunk.length} row(s): ${message}`);
      throw err;
    }
  }
  return written;
}
