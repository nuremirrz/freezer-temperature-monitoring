import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { json, unauthorized, parseBody } from "@/lib/auth/http";
import { passportPatchSchema } from "@/lib/auth/validation";
import { updatePassport } from "@/lib/units/passport";
import { publish } from "@/lib/events";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/units/[id]/passport — the nameplate and the parts. Every role, the technician
 * included; that is a different door from the ranges, which a technician may not touch.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorized();
  const parsed = await parseBody(req, passportPatchSchema);
  if (!parsed.ok) return parsed.response;
  const { id } = await ctx.params;
  const r = await updatePassport(session, id, parsed.data);
  if (!r.ok) return json({ error: r.code, message: r.message }, r.status);
  if (r.data.changed.length) {
    const unit = await prisma.unit.findUnique({ where: { id }, select: { locationId: true } });
    if (unit) publish({ type: "unit", data: { unitId: id, locationId: unit.locationId, state: "updated" } });
  }
  return json(r.data);
}
