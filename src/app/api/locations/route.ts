import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { unauthorized } from "@/lib/auth/http";
import { visibleLocationIds, locationWhere } from "@/lib/auth/access";
import { deriveUnitStatus, deriveLocationStatus, countStatuses, UnitStatus } from "@/lib/status";

export const dynamic = "force-dynamic";

/** GET /api/locations — every location with a status summary derived from its units. */
export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();
  const visible = await visibleLocationIds(session);
  const [locations, latest] = await Promise.all([
    prisma.location.findMany({
      where: locationWhere(visible),
      orderBy: { name: "asc" },
      include: {
        units: {
          select: {
            id: true,
            alerts: { where: { resolvedAt: null }, select: { type: true } },
          },
        },
      },
    }),
    prisma.reading.groupBy({ by: ["unitId"], _max: { measuredAt: true } }),
  ]);

  const hasReading = new Set(latest.map((r) => r.unitId));
  const overall: UnitStatus[] = [];

  const payload = locations.map((loc) => {
    const statuses = loc.units.map((u) => deriveUnitStatus(u.alerts, hasReading.has(u.id)));
    const status = deriveLocationStatus(statuses);
    overall.push(status);
    return {
      id: loc.id,
      name: loc.name,
      address: loc.address,
      city: loc.city,
      state: loc.state,
      zip: loc.zip,
      lat: loc.lat,
      lng: loc.lng,
      timezone: loc.timezone,
      status,
      unitsTotal: loc.units.length,
      unitCounts: countStatuses(statuses),
    };
  });

  return NextResponse.json({ locations: payload, summary: countStatuses(overall) });
}
