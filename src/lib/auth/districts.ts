import { prisma } from "@/lib/db";
import type { CurrentSession } from "./session";
import { fail, type AuthResult } from "./service";
import { canManageDistricts } from "./permissions";
import { organizationFor } from "./team";

/**
 * Districts: how an owner groups locations so that a manager can be given several at once.
 *
 * A location is in one district or in none. Moving it changes who can see it on the very next
 * request, with no row to update on any manager — visibility goes through the district, so
 * the district is the only thing that has to be right. Deleting a district leaves its locations
 * with no district, which is to say visible to the owners and to no manager, until someone
 * places them again.
 */

export interface DistrictView {
  id: string;
  name: string;
  locations: { id: string; name: string }[];
  managers: { id: string; email: string; name: string | null }[];
}

export interface DistrictsView {
  districts: DistrictView[];
  /** Locations that belong to no district — visible to the owners only. */
  unassigned: { id: string; name: string }[];
}

const districtInclude = {
  locations: { select: { id: true, name: true }, orderBy: { name: "asc" as const } },
  managers: { include: { user: { select: { id: true, email: true, name: true } } } },
} as const;

type DistrictRow = NonNullable<Awaited<ReturnType<typeof loadDistrict>>>;

function loadDistrict(id: string) {
  return prisma.district.findUnique({ where: { id }, include: districtInclude });
}

function toView(d: DistrictRow): DistrictView {
  return { id: d.id, name: d.name, locations: d.locations, managers: d.managers.map((m) => m.user) };
}

/** A district the actor may manage, or why not. Outside their organization it is "not found". */
async function manageable(session: CurrentSession, id: string): Promise<AuthResult<DistrictRow>> {
  const actor = session.user;
  if (!canManageDistricts(actor)) return fail("forbidden", "Only an owner manages districts", 403);
  const d = await loadDistrict(id);
  if (!d || (actor.role !== "admin" && d.organizationId !== actor.organizationId)) {
    return fail("not_found", "No such district", 404);
  }
  return { ok: true, data: d };
}

export async function listDistricts(session: CurrentSession, organizationId?: string): Promise<AuthResult<DistrictsView>> {
  const actor = session.user;
  if (!canManageDistricts(actor)) return fail("forbidden", "Only an owner manages districts", 403);
  const org = await organizationFor(actor, organizationId);
  if (!org.ok) return org;

  const [districts, unassigned] = await Promise.all([
    prisma.district.findMany({ where: { organizationId: org.data }, include: districtInclude, orderBy: { name: "asc" } }),
    prisma.location.findMany({
      where: { organizationId: org.data, districtId: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return { ok: true, data: { districts: districts.map(toView), unassigned } };
}

export async function createDistrict(
  session: CurrentSession,
  input: { name: string; organizationId?: string },
): Promise<AuthResult<DistrictView>> {
  const actor = session.user;
  if (!canManageDistricts(actor)) return fail("forbidden", "Only an owner manages districts", 403);
  const org = await organizationFor(actor, input.organizationId);
  if (!org.ok) return org;

  const taken = await prisma.district.findFirst({ where: { organizationId: org.data, name: input.name }, select: { id: true } });
  if (taken) return fail("district_exists", "There is already a district with that name", 409);

  const d = await prisma.district.create({ data: { organizationId: org.data, name: input.name }, include: districtInclude });
  return { ok: true, data: toView(d) };
}

/**
 * Renames a district, or sets which locations belong to it. `locationIds` is the full set: a
 * location that was here and is not listed is moved out, one listed that was elsewhere is moved
 * in — a location has one district, so taking it here takes it from wherever it was.
 */
export async function updateDistrict(
  session: CurrentSession,
  id: string,
  patch: { name?: string; locationIds?: string[] },
): Promise<AuthResult<DistrictView>> {
  const found = await manageable(session, id);
  if (!found.ok) return found;
  const d = found.data;

  if (patch.name !== undefined && patch.name !== d.name) {
    const taken = await prisma.district.findFirst({
      where: { organizationId: d.organizationId, name: patch.name, id: { not: d.id } },
      select: { id: true },
    });
    if (taken) return fail("district_exists", "There is already a district with that name", 409);
  }

  const ops = [];
  if (patch.name !== undefined) {
    ops.push(prisma.district.update({ where: { id: d.id }, data: { name: patch.name } }));
  }
  if (patch.locationIds !== undefined) {
    const ids = [...new Set(patch.locationIds)];
    if (ids.length) {
      const real = await prisma.location.count({ where: { id: { in: ids }, organizationId: d.organizationId } });
      if (real !== ids.length) return fail("unknown_location", "One of those locations does not exist here", 400);
    }
    ops.push(
      prisma.location.updateMany({ where: { districtId: d.id, id: { notIn: ids } }, data: { districtId: null } }),
      prisma.location.updateMany({ where: { id: { in: ids } }, data: { districtId: d.id } }),
    );
  }
  if (ops.length) await prisma.$transaction(ops);

  const row = await loadDistrict(d.id);
  return { ok: true, data: toView(row!) };
}

/**
 * Removes a district. Its locations are left with none — the owners still see them, no manager
 * does — and its managers lose that district from their scope; both follow from the schema's
 * own rules for what happens to a row that pointed here.
 */
export async function deleteDistrict(session: CurrentSession, id: string): Promise<AuthResult<{ id: string; orphanedLocations: number }>> {
  const found = await manageable(session, id);
  if (!found.ok) return found;
  const orphanedLocations = found.data.locations.length;
  await prisma.district.delete({ where: { id: found.data.id } });
  return { ok: true, data: { id: found.data.id, orphanedLocations } };
}
