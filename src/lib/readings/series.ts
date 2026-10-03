import type { PrismaClient } from "@/generated/prisma/client";
import type { Window } from "./window";

/**
 * The points for a chart window: raw readings for a short one, averages per bucket for a long
 * one. Buckets are cut on the restaurant's own clock, so a day's average is that restaurant's
 * day, midnight to midnight, and the first bucket of a week starts where the week's first day
 * does — not at some hour of UTC that happens to fall mid-morning in California.
 */

export interface SeriesPoint {
  t: string;
  tempF: number;
  probeTempF?: number;
  min?: number;
  max?: number;
  n?: number;
}

interface BucketRow {
  bucket: Date;
  avg: number;
  min: number;
  max: number;
  probeAvg: number | null;
  n: number;
}

const round = (n: number) => Math.round(n * 100) / 100;

export async function readingSeries(
  db: PrismaClient,
  unitId: string,
  w: Window,
  timeZone: string,
): Promise<SeriesPoint[]> {
  const from = new Date(w.from);
  const to = new Date(w.to);

  if (w.bucketMinutes === null) {
    const rows = await db.reading.findMany({
      where: { unitId, measuredAt: { gte: from, lte: to } },
      orderBy: { measuredAt: "asc" },
      select: { tempF: true, probeTempF: true, measuredAt: true },
    });
    return rows.map((r) => ({
      t: r.measuredAt.toISOString(),
      tempF: r.tempF,
      ...(r.probeTempF !== null ? { probeTempF: r.probeTempF } : {}),
    }));
  }

  // "measuredAt AT TIME ZONE tz" is the restaurant's wall clock as a plain timestamp; binning
  // that and converting back gives bucket edges on local midnight and local whole hours, on
  // both sides of a clocks change. The hour that happens twice in autumn lands in one bucket.
  const rows = await db.$queryRaw<BucketRow[]>`
    SELECT
      (date_bin(${`${w.bucketMinutes} minutes`}::interval, "measuredAt" AT TIME ZONE ${timeZone}, TIMESTAMP '2000-01-01') AT TIME ZONE ${timeZone}) AS bucket,
      AVG("tempF")::float8 AS avg,
      MIN("tempF")::float8 AS min,
      MAX("tempF")::float8 AS max,
      AVG("probeTempF")::float8 AS "probeAvg",
      COUNT(*)::int AS n
    FROM "Reading"
    WHERE "unitId" = ${unitId} AND "measuredAt" >= ${from} AND "measuredAt" <= ${to}
    GROUP BY bucket
    ORDER BY bucket ASC
  `;
  return rows.map((r) => ({
    t: r.bucket.toISOString(),
    tempF: round(r.avg),
    min: r.min,
    max: r.max,
    n: r.n,
    ...(r.probeAvg !== null ? { probeTempF: round(r.probeAvg) } : {}),
  }));
}
