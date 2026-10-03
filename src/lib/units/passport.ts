import { prisma } from "@/lib/db";
import type { CurrentSession } from "@/lib/auth/session";
import { fail, type AuthResult } from "@/lib/auth/service";
import { canEditPassport } from "@/lib/auth/permissions";
import { visibleLocationIds, canSee } from "@/lib/auth/access";
import { passportDiff, type PassportField, type PassportPatch, type Passport } from "./passport-rules";

export { PASSPORT_FIELDS, passportDiff, type PassportField, type PassportPatch, type PassportChange, type Passport } from "./passport-rules";

/**
 * The unit's passport: the nameplate and the parts a technician would need to buy.
 *
 * Every role may write it, the technician first of all — they are the one standing at the
 * unit. Reach is still the location's: a unit nobody granted you is "not found". Each field
 * that actually changes leaves a UnitChange row, so a replaced unit's old serial and a swapped
 * capacitor's old rating are history rather than gone. Last write wins; the spec says so.
 */

const passportSelect = {
  model: true, serial: true, year: true, refrigerant: true, belts: true, capacitor: true, filter: true,
  passportUpdatedAt: true,
  passportUpdatedBy: { select: { id: true, name: true, email: true } },
} as const;

type Row = { [K in PassportField]: string | number | null } & {
  passportUpdatedAt: Date | null;
  passportUpdatedBy: { id: string; name: string | null; email: string } | null;
};

export function toPassport(u: Row): Passport {
  return {
    model: u.model as string | null,
    serial: u.serial as string | null,
    year: u.year as number | null,
    refrigerant: u.refrigerant as string | null,
    belts: u.belts as string | null,
    capacitor: u.capacitor as string | null,
    filter: u.filter as string | null,
    updatedAt: u.passportUpdatedAt?.toISOString() ?? null,
    updatedBy: u.passportUpdatedBy,
  };
}

export async function updatePassport(session: CurrentSession, unitId: string, patch: PassportPatch): Promise<AuthResult<Passport & { changed: PassportField[] }>> {
  const unit = await prisma.unit.findUnique({ where: { id: unitId }, select: { id: true, locationId: true, ...passportSelect } });
  // Reach first, role second: a unit outside someone's scope does not exist for them.
  const visible = await visibleLocationIds(session);
  if (!unit || !canSee(visible, unit.locationId)) return fail("not_found", "Unit not found", 404);
  if (!canEditPassport(session.user)) return fail("forbidden", "You cannot edit this passport", 403);

  const changes = passportDiff(unit, patch);
  if (!changes.length) return { ok: true, data: { ...toPassport(unit), changed: [] } };

  const now = new Date();
  const data: Record<string, unknown> = { passportUpdatedAt: now, passportUpdatedById: session.user.id };
  for (const c of changes) data[c.field] = c.field === "year" ? (c.newValue === null ? null : Number(c.newValue)) : c.newValue;

  const [row] = await prisma.$transaction([
    prisma.unit.update({ where: { id: unit.id }, data, select: passportSelect }),
    prisma.unitChange.createMany({
      data: changes.map((c) => ({ unitId: unit.id, userId: session.user.id, field: c.field, oldValue: c.oldValue, newValue: c.newValue, changedAt: now })),
    }),
  ]);
  return { ok: true, data: { ...toPassport(row), changed: changes.map((c) => c.field) } };
}
