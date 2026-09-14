import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { unauthorized } from "@/lib/auth/http";
import { visibleLocationIds, canSee } from "@/lib/auth/access";

export const dynamic = "force-dynamic";

type Range = "1h" | "1d" | "1w" | "1m";

/**
 * The four spans the client asked for. An hour and a day are drawn from raw readings — at a
 * five-minute uplink that is 288 points for a day, which a line handles fine. A week and a
 * month are averaged into buckets in the query rather than shipped point by point.
 */
const RANGES: Record<Range, { hours: number; bucketMinutes: number | null }> = {
  "1h": { hours: 1, bucketMinutes: null },
  "1d": { hours: 24, bucketMinutes: null },
  "1w": { hours: 24 * 7, bucketMinutes: 30 },
  "1m": { hours: 24 * 30, bucketMinutes: 120 },
};

interface BucketRow {
  bucket: Date;
  avg: number;
  min: number;
  max: number;
  probeAvg: number | null;
  n: number;
}

/** GET /api/units/[id]/readings?range=1h|1d|1w|1m */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorized();
  const { id } = await ctx.params;
  const rangeParam = (req.nextUrl.searchParams.get("range") ?? "1d") as Range;
  const cfg = RANGES[rangeParam];
  if (!cfg) {
    return NextResponse.json({ error: "range must be 1h, 1d, 1w or 1m" }, { status: 400 });
  }

  const unit = await prisma.unit.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      type: true,
      locationId: true,
      rangeMinF: true,
      rangeMaxF: true,
      alertMinF: true,
      alertMaxF: true,
      probeMinF: true,
      probeMaxF: true,
    },
  });
  const visible = await visibleLocationIds(session);
  if (!unit || !canSee(visible, unit.locationId)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Everything the chart needs to draw its zones and threshold lines travels with the points,
  // so the component never has to guess at them or fetch the unit separately.
  const bands = {
    type: unit.type,
    rangeMinF: unit.rangeMinF,
    rangeMaxF: unit.rangeMaxF,
    alertMinF: unit.alertMinF,
    alertMaxF: unit.alertMaxF,
    probeMinF: unit.probeMinF,
    probeMaxF: unit.probeMaxF,
  };
  const since = new Date(Date.now() - cfg.hours * 3_600_000);

  if (cfg.bucketMinutes === null) {
    const rows = await prisma.reading.findMany({
      where: { unitId: id, measuredAt: { gte: since } },
      orderBy: { measuredAt: "asc" },
      select: { tempF: true, probeTempF: true, measuredAt: true },
    });
    return NextResponse.json({
      unitId: id,
      range: rangeParam,
      bucketMinutes: null,
      ...bands,
      points: rows.map((r) => ({
        t: r.measuredAt.toISOString(),
        tempF: r.tempF,
        ...(r.probeTempF !== null ? { probeTempF: r.probeTempF } : {}),
      })),
    });
  }

  const rows = await prisma.$queryRaw<BucketRow[]>`
    SELECT
      date_bin(${`${cfg.bucketMinutes} minutes`}::interval, "measuredAt", TIMESTAMPTZ '2000-01-01') AS bucket,
      AVG("tempF")::float8 AS avg,
      MIN("tempF")::float8 AS min,
      MAX("tempF")::float8 AS max,
      AVG("probeTempF")::float8 AS "probeAvg",
      COUNT(*)::int AS n
    FROM "Reading"
    WHERE "unitId" = ${id} AND "measuredAt" >= ${since}
    GROUP BY bucket
    ORDER BY bucket ASC
  `;

  const round = (n: number) => Math.round(n * 100) / 100;
  return NextResponse.json({
    unitId: id,
    range: rangeParam,
    bucketMinutes: cfg.bucketMinutes,
    ...bands,
    points: rows.map((r) => ({
      t: r.bucket.toISOString(),
      tempF: round(r.avg),
      min: r.min,
      max: r.max,
      n: r.n,
      ...(r.probeAvg !== null ? { probeTempF: round(r.probeAvg) } : {}),
    })),
  });
}
