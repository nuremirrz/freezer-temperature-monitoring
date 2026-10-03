import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { unauthorized } from "@/lib/auth/http";
import { visibleLocationIds, canSee } from "@/lib/auth/access";
import { resolveWindow } from "@/lib/readings/window";
import { readingSeries, weatherSeries } from "@/lib/readings/series";

export const dynamic = "force-dynamic";

/**
 * GET /api/units/[id]/readings?range=12h|1d|1w|1m
 * GET /api/units/[id]/readings?from=<ISO>&to=<ISO>   (a year at most)
 *
 * Short windows come back as raw readings, long ones as averages per bucket, cut on the
 * restaurant's own clock. Everything the chart needs to draw its zones travels with the points.
 * An AC also gets the air outside over the same window (`weather`), for its third line.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorized();
  const { id } = await ctx.params;
  const q = req.nextUrl.searchParams;
  const resolved = resolveWindow({ range: q.get("range"), from: q.get("from"), to: q.get("to") });
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 400 });
  const w = resolved.window;

  const unit = await prisma.unit.findUnique({
    where: { id },
    select: {
      id: true,
      type: true,
      locationId: true,
      rangeMinF: true,
      rangeMaxF: true,
      alertMinF: true,
      alertMaxF: true,
      probeMinF: true,
      probeMaxF: true,
      location: { select: { timezone: true } },
      channels: { select: { sensor: { select: { expectedIntervalSec: true } } }, take: 1 },
    },
  });
  const visible = await visibleLocationIds(session);
  if (!unit || !canSee(visible, unit.locationId)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const tz = unit.location.timezone;
  const [points, weather] = await Promise.all([
    readingSeries(prisma, id, w, tz),
    unit.type === "ac" ? weatherSeries(prisma, unit.locationId, w, tz) : Promise.resolve([]),
  ]);
  return NextResponse.json({
    unitId: id,
    range: w.range,
    from: new Date(w.from).toISOString(),
    to: new Date(w.to).toISOString(),
    live: w.live,
    bucketMinutes: w.bucketMinutes,
    timeZone: unit.location.timezone,
    intervalSec: unit.channels[0]?.sensor.expectedIntervalSec ?? 300,
    type: unit.type,
    rangeMinF: unit.rangeMinF,
    rangeMaxF: unit.rangeMaxF,
    alertMinF: unit.alertMinF,
    alertMaxF: unit.alertMaxF,
    probeMinF: unit.probeMinF,
    probeMaxF: unit.probeMaxF,
    points,
    ...(unit.type === "ac" ? { weather } : {}),
  });
}
