import { prisma } from "@/lib/db";
import type { UserRole } from "@/generated/prisma/client";
import type { CurrentSession } from "./session";
import { fail, type AuthResult } from "./service";
import { canManageLocations } from "./permissions";
import { organizationFor } from "./team";
import { geocode, defaultTimezone, type Geocoder } from "@/lib/geocode";

/**
 * The owner's side of the estate: the restaurants themselves, and who is on each.
 *
 * Agreed with the client on 30 Sep 2026: the owner brings the list of restaurants and the
 * people; Qimby brings the equipment and the sensors at installation. So this module creates
 * and edits a restaurant as a name and a street, never anything inside it, and it assigns
 * managers and technicians to it one restaurant at a time — which is how the owner's table
 * reads, one row per restaurant.
 *
 * A restaurant is never deleted, only deactivated. Its readings and alerts are history worth
 * keeping, and a sensor still on its wall keeps being stored. Deactivated, it is off every
 * list, map and counter and raises nothing; the owner sees it only here, to bring it back.
 */

export interface Person {
  id: string;
  email: string;
  name: string | null;
  status: "invited" | "active";
}

export interface LocationRow {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  timezone: string;
  lat: number;
  lng: number;
  active: boolean;
  deactivatedAt: string | null;
  unitsTotal: number;
  managers: Person[];
  technicians: Person[];
}

export interface OrganizationView {
  organization: { id: string; name: string };
  owners: Person[];
  managers: Person[];
  technicians: Person[];
  locations: LocationRow[];
}

export interface LocationInput {
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  timezone?: string;
  organizationId?: string;
}

export interface LocationPatch {
  name?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  timezone?: string;
  active?: boolean;
  managerIds?: string[];
  technicianIds?: string[];
}

const personSelect = { id: true, email: true, name: true, status: true, role: true } as const;

const locationInclude = {
  access: { include: { user: { select: personSelect } } },
  _count: { select: { units: true } },
} as const;

type LocationRecord = NonNullable<Awaited<ReturnType<typeof loadLocation>>>;

function loadLocation(id: string) {
  return prisma.location.findUnique({ where: { id }, include: locationInclude });
}

function person(u: { id: string; email: string; name: string | null; status: string }): Person {
  return { id: u.id, email: u.email, name: u.name, status: u.status === "active" ? "active" : "invited" };
}

function toRow(l: LocationRecord): LocationRow {
  // Someone deactivated stays on the row in the database — their name is history — but the
  // table shows who is actually there.
  const people = l.access.map((a) => a.user).filter((u) => u.status !== "deactivated");
  return {
    id: l.id,
    name: l.name,
    address: l.address,
    city: l.city,
    state: l.state,
    zip: l.zip,
    timezone: l.timezone,
    lat: l.lat,
    lng: l.lng,
    active: l.deactivatedAt === null,
    deactivatedAt: l.deactivatedAt?.toISOString() ?? null,
    unitsTotal: l._count.units,
    managers: people.filter((u) => u.role === "district_manager").map(person),
    technicians: people.filter((u) => u.role === "technician").map(person),
  };
}

/** A location the actor may manage, or why not. Outside their organization it is "not found". */
async function manageable(session: CurrentSession, id: string): Promise<AuthResult<LocationRecord>> {
  const actor = session.user;
  if (!canManageLocations(actor)) return fail("forbidden", "Only an owner manages restaurants", 403);
  const l = await loadLocation(id);
  if (!l || (actor.role !== "admin" && l.organizationId !== actor.organizationId)) {
    return fail("not_found", "No such restaurant", 404);
  }
  return { ok: true, data: l };
}

/** Everything the owner's table shows: the people of the organization and its restaurants, deactivated ones last. */
export async function listOrganization(session: CurrentSession, organizationId?: string): Promise<AuthResult<OrganizationView>> {
  const actor = session.user;
  if (!canManageLocations(actor)) return fail("forbidden", "Only an owner manages restaurants", 403);
  const org = await organizationFor(actor, organizationId);
  if (!org.ok) return org;

  const [organization, people, locations] = await Promise.all([
    prisma.organization.findUnique({ where: { id: org.data }, select: { id: true, name: true } }),
    prisma.user.findMany({
      where: { organizationId: org.data, status: { not: "deactivated" } },
      select: personSelect,
      orderBy: [{ name: "asc" }, { email: "asc" }],
    }),
    prisma.location.findMany({
      where: { organizationId: org.data },
      include: locationInclude,
      orderBy: [{ deactivatedAt: { sort: "asc", nulls: "first" } }, { name: "asc" }],
    }),
  ]);
  if (!organization) return fail("not_found", "No such organization", 404);

  const byRole = (role: UserRole) => people.filter((u) => u.role === role).map(person);
  return {
    ok: true,
    data: {
      organization,
      owners: byRole("owner"),
      managers: byRole("district_manager"),
      technicians: byRole("technician"),
      locations: locations.map(toRow),
    },
  };
}

async function nameTaken(name: string, exceptId?: string): Promise<boolean> {
  // Location names are unique across the whole database, not only the organization, because
  // the sensor map (data/sensors.csv) addresses restaurants by name alone.
  const hit = await prisma.location.findFirst({ where: { name, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
  return Boolean(hit);
}

export async function createLocation(
  session: CurrentSession,
  input: LocationInput,
  geocoder: Geocoder = geocode,
): Promise<AuthResult<LocationRow>> {
  const actor = session.user;
  if (!canManageLocations(actor)) return fail("forbidden", "Only an owner adds restaurants", 403);
  const org = await organizationFor(actor, input.organizationId);
  if (!org.ok) return org;

  if (await nameTaken(input.name)) return fail("location_exists", "There is already a restaurant with that name", 409);

  const point = await geocoder(input);
  if (!point) return fail("address_not_found", "Could not place that address on the map — check the street and city", 422);

  const l = await prisma.location.create({
    data: {
      organizationId: org.data,
      name: input.name,
      address: input.address,
      city: input.city,
      state: input.state,
      zip: input.zip,
      timezone: input.timezone ?? defaultTimezone(input.state),
      lat: point.lat,
      lng: point.lng,
    },
    include: locationInclude,
  });
  return { ok: true, data: toRow(l) };
}

/**
 * Renames or re-addresses a restaurant, activates or deactivates it, or sets who is on it.
 * A changed street is looked up again; a changed name is not, so a rename never moves a pin.
 */
export async function updateLocation(
  session: CurrentSession,
  id: string,
  patch: LocationPatch,
  geocoder: Geocoder = geocode,
): Promise<AuthResult<LocationRow>> {
  const found = await manageable(session, id);
  if (!found.ok) return found;
  const l = found.data;

  if (patch.name !== undefined && patch.name !== l.name && (await nameTaken(patch.name, l.id))) {
    return fail("location_exists", "There is already a restaurant with that name", 409);
  }

  const address = {
    address: patch.address ?? l.address,
    city: patch.city ?? l.city,
    state: patch.state ?? l.state,
    zip: patch.zip ?? l.zip,
  };
  const moved =
    address.address !== l.address || address.city !== l.city || address.state !== l.state || address.zip !== l.zip;
  let point: { lat: number; lng: number } | null = null;
  if (moved) {
    point = await geocoder(address);
    if (!point) return fail("address_not_found", "Could not place that address on the map — check the street and city", 422);
  }

  const people = await resolvePeople(l.organizationId, patch);
  if (!people.ok) return people;

  const deactivating = patch.active === false && l.deactivatedAt === null;
  const reactivating = patch.active === true && l.deactivatedAt !== null;

  await prisma.$transaction(async (tx) => {
    await tx.location.update({
      where: { id: l.id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(moved ? { ...address, lat: point!.lat, lng: point!.lng } : {}),
        ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
        ...(deactivating ? { deactivatedAt: new Date() } : {}),
        ...(reactivating ? { deactivatedAt: null } : {}),
      },
    });
    // Whatever was open at a closed restaurant is over: nothing there will be acted on, and
    // the counters would otherwise carry it forever.
    if (deactivating) {
      await tx.alert.updateMany({
        where: { unit: { locationId: l.id }, resolvedAt: null },
        data: { resolvedAt: new Date() },
      });
    }
    for (const { role, ids } of people.data) {
      await tx.locationAccess.deleteMany({ where: { locationId: l.id, user: { role }, userId: { notIn: ids } } });
      await tx.locationAccess.createMany({
        data: ids.map((userId) => ({ userId, locationId: l.id })),
        skipDuplicates: true,
      });
    }
  });

  const row = await loadLocation(l.id);
  return { ok: true, data: toRow(row!) };
}

/**
 * Checks that everyone named is a manager or a technician of this organization, as the patch
 * says they are. An id that is not fails loudly rather than being skipped: the owner asked for
 * a person, and silently getting fewer would look like it worked.
 */
async function resolvePeople(
  organizationId: string | null,
  patch: LocationPatch,
): Promise<AuthResult<{ role: UserRole; ids: string[] }[]>> {
  const wanted: { role: UserRole; ids: string[] | undefined }[] = [
    { role: "district_manager", ids: patch.managerIds },
    { role: "technician", ids: patch.technicianIds },
  ];
  const out: { role: UserRole; ids: string[] }[] = [];
  for (const { role, ids } of wanted) {
    if (ids === undefined) continue;
    const unique = [...new Set(ids)];
    if (unique.length) {
      const found = await prisma.user.count({
        where: { id: { in: unique }, organizationId, role, status: { not: "deactivated" } },
      });
      if (found !== unique.length) {
        const noun = role === "technician" ? "technician" : "district manager";
        return fail("unknown_person", `One of those people is not a ${noun} of this organization`, 400);
      }
    }
    out.push({ role, ids: unique });
  }
  return { ok: true, data: out };
}
