import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { unauthorized, sameOrigin, parseBody } from "@/lib/auth/http";
import { publish } from "@/lib/events";

export const dynamic = "force-dynamic";

/**
 * The normal range is set per unit by hand (ТЗ BK6816), because the right numbers depend on
 * what the equipment actually holds — a walk-in cooler and an AC supply duct have nothing
 * in common. Changing it re-derives every status on the next read; open alerts are left
 * alone and the next reading resolves or keeps them under the new range.
 */
const patchSchema = z
  .object({
    rangeMinF: z.number().finite().min(-80).max(150),
    rangeMaxF: z.number().finite().min(-80).max(150),
    alertMinF: z.number().finite().min(-80).max(150).nullable().optional(),
    alertMaxF: z.number().finite().min(-80).max(150).nullable().optional(),
    probeMinF: z.number().finite().min(-80).max(150).nullable().optional(),
    probeMaxF: z.number().finite().min(-80).max(150).nullable().optional(),
    refrigerant: z.string().trim().max(40).nullable().optional(),
    year: z.number().int().min(1950).max(2100).nullable().optional(),
  })
  .refine((v) => v.rangeMinF < v.rangeMaxF, {
    message: "The low end of the range must be below the high end",
    path: ["rangeMinF"],
  });

/** PATCH /api/units/[id] — edit the unit's normal range and installation details. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!sameOrigin(req)) return NextResponse.json({ message: "Bad origin" }, { status: 403 });
  // Ranges are an engineering judgement about the equipment, not the restaurant's to set.
  if (session.user.role !== "admin") {
    return NextResponse.json({ message: "Only Qimby staff can change a unit's settings" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const parsed = await parseBody(req, patchSchema);
  if (!parsed.ok) return parsed.response;

  const unit = await prisma.unit.findUnique({ where: { id }, select: { id: true, locationId: true } });
  if (!unit) return NextResponse.json({ message: "Unit not found" }, { status: 404 });

  const { rangeMinF, rangeMaxF, alertMinF, alertMaxF, probeMinF, probeMaxF, refrigerant, year } = parsed.data;
  const updated = await prisma.unit.update({
    where: { id },
    data: {
      rangeMinF,
      rangeMaxF,
      ...(alertMinF !== undefined ? { alertMinF } : {}),
      ...(alertMaxF !== undefined ? { alertMaxF } : {}),
      ...(probeMinF !== undefined ? { probeMinF } : {}),
      ...(probeMaxF !== undefined ? { probeMaxF } : {}),
      ...(refrigerant !== undefined ? { refrigerant: refrigerant || null } : {}),
      ...(year !== undefined ? { year } : {}),
    },
    select: {
      id: true, rangeMinF: true, rangeMaxF: true,
      alertMinF: true, alertMaxF: true, probeMinF: true, probeMaxF: true,
      refrigerant: true, year: true,
    },
  });

  // Statuses everywhere depend on the range, so wake the open screens up
  publish({ type: "unit", data: { unitId: unit.id, locationId: unit.locationId, state: "updated" } });

  return NextResponse.json(updated);
}
