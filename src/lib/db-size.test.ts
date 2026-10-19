import { describe, it, expect, beforeEach } from "vitest";
import { dbSize, resetDbSizeCache, DB_LIMIT_MB, DB_WARN_PERCENT, MEASURE_EVERY_MS } from "./db-size";
import type { PrismaClient } from "@/generated/prisma/client";

/** A client that answers the size query with a fixed number of bytes, and counts the asking. */
const serving = (...answers: (number | Error)[]) => {
  let n = 0;
  const db = {
    $queryRawUnsafe: async () => {
      const a = answers[Math.min(n++, answers.length - 1)];
      if (a instanceof Error) throw a;
      return [{ size: BigInt(Math.round(a)) }];
    },
  } as unknown as PrismaClient;
  return { db, calls: () => n };
};

const MB = 1024 * 1024;

describe("how much room is left in the database", () => {
  beforeEach(() => resetDbSizeCache());

  it("reports the size against the plan's limit", async () => {
    // 52.7 MB of 500 — what production held on 19 Oct 2026
    const { db } = serving(52.7 * MB);
    expect(await dbSize(db, 1_000)).toEqual({
      usedMb: 52.7,
      limitMb: DB_LIMIT_MB,
      percent: 10.5,
      low: false,
      measuredAt: new Date(1_000).toISOString(),
    });
  });

  it("says nothing is wrong right up to the threshold, and says so past it", async () => {
    const at = async (mb: number) => {
      resetDbSizeCache();
      return (await dbSize(serving(mb * MB).db, 0))!.low;
    };
    const warnMb = (DB_LIMIT_MB * DB_WARN_PERCENT) / 100;
    expect(await at(warnMb - 1)).toBe(false);
    expect(await at(warnMb)).toBe(true);
    expect(await at(DB_LIMIT_MB)).toBe(true);
  });

  it("measures once an hour, not once a request", async () => {
    // /api/health is Render's health check: polled constantly, and the size does not move fast
    const s = serving(52.7 * MB);
    await dbSize(s.db, 0);
    await dbSize(s.db, 60_000);
    await dbSize(s.db, MEASURE_EVERY_MS - 1);
    expect(s.calls()).toBe(1);
    await dbSize(s.db, MEASURE_EVERY_MS);
    expect(s.calls()).toBe(2);
  });

  it("keeps the last real number when the database will not answer", async () => {
    const s = serving(52.7 * MB, new Error("permission denied for function pg_database_size"));
    await dbSize(s.db, 0);
    const after = await dbSize(s.db, MEASURE_EVERY_MS);
    expect(after?.usedMb).toBe(52.7);
    expect(s.calls()).toBe(2);
  });

  it("returns null rather than throwing when it has never managed to measure", async () => {
    const { db } = serving(new Error("connection terminated"));
    expect(await dbSize(db, 0)).toBeNull();
  });
});
