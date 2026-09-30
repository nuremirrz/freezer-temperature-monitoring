import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { json, unauthorized, parseBody } from "@/lib/auth/http";
import { visibleLocationIds, locationWhere } from "@/lib/auth/access";
import { locationCreateSchema } from "@/lib/auth/validation";
import { createLocation } from "@/lib/auth/locations";
import { deriveUnitStatus, deriveLocationStatus, countStatuses, UnitStatus } from "@/lib/status";

export const dynamic = "force-dynamic";

/** GET /api/locations — every location with a status summary derived from its units. */
export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();
  const visible = await visibleLocationIds(session);
  const [locations, latest] = await Promise.all([
    prisma.location.findMany({
      // Staff reach "all", which must still leave out closed restaurants; everyone else's ids
      // already do, and the extra clause costs nothing.
      where: { ...locationWhere(visible), deactivatedAt: null },
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

/** POST /api/locations — a new restaurant, placed on the map from its street address. */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();
  const parsed = await parseBody(req, locationCreateSchema);
  if (!parsed.ok) return parsed.response;
  const r = await createLocation(session, parsed.data);
  if (!r.ok) return json({ error: r.code, message: r.message }, r.status);
  return json(r.data, 201);
}
