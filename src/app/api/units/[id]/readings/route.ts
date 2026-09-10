import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { unauthorized } from "@/lib/auth/http";

export const dynamic = "force-dynamic";

type Range = "24h" | "7d" | "30d";

/** Raw points for 24h; 7d/30d are averaged into buckets right in the query. */
const RANGES: Record<Range, { hours: number; bucketMinutes: number | null }> = {
  "24h": { hours: 24, bucketMinutes: null },
  "7d": { hours: 24 * 7, bucketMinutes: 30 },
  "30d": { hours: 24 * 30, bucketMinutes: 120 },
};

interface BucketRow {
  bucket: Date;
  avg: number;
  min: number;
  max: number;
  n: number;
}

/** GET /api/units/[id]/readings?range=24h|7d|30d */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await getSession())) return unauthorized();
  const { id } = await ctx.params;
  const rangeParam = (req.nextUrl.searchParams.get("range") ?? "24h") as Range;
  const cfg = RANGES[rangeParam];
  if (!cfg) {
    return NextResponse.json({ error: "range must be 24h, 7d or 30d" }, { status: 400 });
  }

  const unit = await prisma.unit.findUnique({
    where: { id },
    select: { id: true, name: true, rangeMinF: true, rangeMaxF: true },
  });
  if (!unit) return NextResponse.json({ error: "not found" }, { status: 404 });

  const since = new Date(Date.now() - cfg.hours * 3_600_000);

  if (cfg.bucketMinutes === null) {
    const rows = await prisma.reading.findMany({
      where: { unitId: id, measuredAt: { gte: since } },
      orderBy: { measuredAt: "asc" },
      select: { tempF: true, measuredAt: true },
    });
    return NextResponse.json({
      unitId: id,
      range: rangeParam,
      bucketMinutes: null,
      rangeMinF: unit.rangeMinF,
      rangeMaxF: unit.rangeMaxF,
      points: rows.map((r) => ({ t: r.measuredAt.toISOString(), tempF: r.tempF })),
    });
  }

  const rows = await prisma.$queryRaw<BucketRow[]>`
    SELECT
      date_bin(${`${cfg.bucketMinutes} minutes`}::interval, "measuredAt", TIMESTAMPTZ '2000-01-01') AS bucket,
      AVG("tempF")::float8 AS avg,
      MIN("tempF")::float8 AS min,
      MAX("tempF")::float8 AS max,
      COUNT(*)::int AS n
    FROM "Reading"
    WHERE "unitId" = ${id} AND "measuredAt" >= ${since}
    GROUP BY bucket
    ORDER BY bucket ASC
  `;

  return NextResponse.json({
    unitId: id,
    range: rangeParam,
    bucketMinutes: cfg.bucketMinutes,
    rangeMinF: unit.rangeMinF,
    rangeMaxF: unit.rangeMaxF,
    points: rows.map((r) => ({
      t: r.bucket.toISOString(),
      tempF: Math.round(r.avg * 100) / 100,
      min: r.min,
      max: r.max,
      n: r.n,
    })),
  });
}
