import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import type { Prisma, UserRole, UserStatus } from "@/generated/prisma/client";
import type { CurrentSession, SessionUser } from "./session";
import { fail, type AuthResult } from "./service";
import { hashPassword } from "./password";
import { generateToken } from "./tokens";
import { sendMail } from "./mailer";
import { inviteMail } from "./emails";
import { visibleLocationIds } from "./access";
import {
  canInvite,
  canManageTeam,
  scopeSurvivesRoleChange,
  withinReach,
  wouldOrphanOrganization,
} from "./permissions";

/**
 * The team behind an organization: who is in it, what they may reach, and how they got in.
 *
 * Every decision about *whether* something is allowed comes from permissions.ts; this module
 * only carries it out. Everything here checks reach on the way in — a manager may hand out only
 * what they can see themselves, an owner only what is in their organization — because a
 * scope that escaped that check would be a way to reach past one's own.
 */

/** 72 hours, per the spec. Long enough to be read on a Friday and used on Monday. */
export const INVITE_TTL_MS = 72 * 60 * 60_000;

export interface InviteInput {
  email: string;
  name?: string;
  role: UserRole;
  districtIds?: string[];
  locationIds?: string[];
  /** Only an admin passes this — they stand outside every organization. */
  organizationId?: string;
}

export interface MemberPatch {
  name?: string;
  role?: UserRole;
  districtIds?: string[];
  locationIds?: string[];
}

export interface Member {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  status: UserStatus;
  districts: { id: string; name: string }[];
  locations: { id: string; name: string }[];
  createdAt: string;
  /** The invitation still waiting to be used, if there is one. */
  invite: { expiresAt: string; expired: boolean } | null;
}

const memberInclude = {
  districts: { include: { district: { select: { id: true, name: true } } } },
  access: { include: { location: { select: { id: true, name: true } } } },
  tokens: {
    where: { type: "password_reset" as const, usedAt: null },
    orderBy: { expiresAt: "desc" as const },
    take: 1,
  },
} as const;

type MemberRow = NonNullable<Awaited<ReturnType<typeof loadMember>>>;

function loadMember(id: string) {
  return prisma.user.findUnique({ where: { id }, include: memberInclude });
}

function toMember(u: MemberRow, now = Date.now()): Member {
  const token = u.status === "invited" ? u.tokens[0] : undefined;
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    status: u.status,
    districts: u.districts.map((d) => d.district),
    locations: u.access.map((a) => a.location),
    createdAt: u.createdAt.toISOString(),
    invite: token ? { expiresAt: token.expiresAt.toISOString(), expired: token.expiresAt.getTime() <= now } : null,
  };
}

/**
 * Which organization an actor acts on. Everyone but an admin is inside exactly one; an admin
 * stands outside all of them and has to say which.
 */
function organizationFor(actor: SessionUser, explicit?: string): AuthResult<string> {
  if (actor.role === "admin") {
    return explicit
      ? { ok: true, data: explicit }
      : fail("organization_required", "Say which organization this is for", 400);
  }
  return actor.organizationId
    ? { ok: true, data: actor.organizationId }
    : fail("no_organization", "Your account is not part of an organization", 403);
}

/**
 * Checks that a scope someone wants to hand out is real, inside the organization, and within
 * the actor's own reach — then returns the ids to write. Fails loudly on an id that does not
 * exist rather than silently granting less than was asked.
 */
async function resolveScope(
  actor: CurrentSession,
  organizationId: string,
  role: UserRole,
  districtIds: string[] | undefined,
  locationIds: string[] | undefined,
): Promise<AuthResult<{ districtIds: string[]; locationIds: string[] }>> {
  if (role === "district_manager") {
    const ids = [...new Set(districtIds ?? [])];
    if (ids.length) {
      const found = await prisma.district.findMany({ where: { id: { in: ids }, organizationId }, select: { id: true } });
      if (found.length !== ids.length) return fail("unknown_district", "One of those districts does not exist here", 400);
    }
    return { ok: true, data: { districtIds: ids, locationIds: [] } };
  }
  if (role === "technician") {
    const ids = [...new Set(locationIds ?? [])];
    if (ids.length) {
      const found = await prisma.location.findMany({ where: { id: { in: ids }, organizationId }, select: { id: true } });
      if (found.length !== ids.length) return fail("unknown_location", "One of those locations does not exist here", 400);
      const reach = await visibleLocationIds(actor);
      if (!withinReach(ids, reach)) {
        return fail("beyond_reach", "You can only hand out locations you can see yourself", 403);
      }
    }
    return { ok: true, data: { districtIds: [], locationIds: ids } };
  }
  // Owners and admins have no scope rows: their reach is the organization itself.
  return { ok: true, data: { districtIds: [], locationIds: [] } };
}

async function issueInvite(userId: string): Promise<string> {
  // A fresh link supersedes any unused one, same as the app's own reset flow.
  await prisma.authToken.updateMany({
    where: { userId, type: "password_reset", usedAt: null },
    data: { usedAt: new Date() },
  });
  const { raw, hash } = generateToken();
  await prisma.authToken.create({
    data: { id: hash, userId, type: "password_reset", expiresAt: new Date(Date.now() + INVITE_TTL_MS) },
  });
  return raw;
}

async function sendInvite(actor: SessionUser, organizationId: string, to: string, role: UserRole, raw: string, base: string) {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
  await sendMail(
    inviteMail(to, `${base}/reset-password?token=${raw}`, {
      organization: org?.name ?? "Qimby",
      invitedBy: actor.name ?? actor.email,
      role,
      ttlHours: INVITE_TTL_MS / 3_600_000,
    }),
  );
}

/** Creates an account that cannot sign in yet, gives it its scope, and mails the one link that will let it. */
export async function inviteUser(session: CurrentSession, input: InviteInput, base: string): Promise<AuthResult<Member>> {
  const actor = session.user;
  if (!canInvite(actor, input.role)) {
    return fail("forbidden", `You cannot invite someone as ${input.role.replace("_", " ")}`, 403);
  }
  const org = organizationFor(actor, input.organizationId);
  if (!org.ok) return org;

  const existing = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) {
    return fail("user_exists", "Someone with that e-mail is already here — change their role instead of inviting again", 409);
  }

  const scope = await resolveScope(session, org.data, input.role, input.districtIds, input.locationIds);
  if (!scope.ok) return scope;

  const user = await prisma.user.create({
    data: {
      email: input.email,
      name: input.name?.trim() || null,
      role: input.role,
      status: "invited",
      organizationId: org.data,
      // An unguessable hash nobody holds the input to: no password works until the invitee
      // sets one through the link. The address is confirmed by using that link, not before.
      passwordHash: await hashPassword(randomBytes(32).toString("base64url")),
      districts: { create: scope.data.districtIds.map((districtId) => ({ districtId })) },
      access: { create: scope.data.locationIds.map((locationId) => ({ locationId })) },
    },
  });

  const raw = await issueInvite(user.id);
  await sendInvite(actor, org.data, user.email, user.role, raw, base);

  const row = await loadMember(user.id);
  return { ok: true, data: toMember(row!) };
}

/**
 * Everyone the actor is responsible for. Owners see their whole organization; a manager sees the
 * technicians on their own locations, since those are the ones they can invite. Qimby's own
 * accounts are never listed — they are not in any organization, and the owner did not add them.
 */
export async function listTeam(session: CurrentSession): Promise<AuthResult<Member[]>> {
  const actor = session.user;
  let where: Prisma.UserWhereInput;

  switch (actor.role) {
    case "admin":
      where = { role: { not: "admin" } };
      break;
    case "owner": {
      const org = organizationFor(actor);
      if (!org.ok) return org;
      where = { organizationId: org.data };
      break;
    }
    case "district_manager": {
      const reach = await visibleLocationIds(session);
      const ids = reach === "all" ? undefined : reach;
      where = {
        organizationId: actor.organizationId,
        role: "technician",
        ...(ids ? { access: { some: { locationId: { in: ids } } } } : {}),
      };
      break;
    }
    case "technician":
      return fail("forbidden", "Technicians do not manage the team", 403);
  }

  const rows = await prisma.user.findMany({ where, include: memberInclude, orderBy: [{ role: "asc" }, { createdAt: "asc" }] });
  const now = Date.now();
  return { ok: true, data: rows.map((r) => toMember(r, now)) };
}

/** Finds a member the actor may manage, or explains why not. */
async function manageable(session: CurrentSession, userId: string): Promise<AuthResult<MemberRow>> {
  const actor = session.user;
  if (!canManageTeam(actor)) return fail("forbidden", "Only an owner manages the team", 403);
  const target = await loadMember(userId);
  // Outside the organization, or one of Qimby's own: "not found", so that ids cannot be probed.
  if (!target || target.role === "admin") return fail("not_found", "No such member", 404);
  if (actor.role !== "admin" && target.organizationId !== actor.organizationId) {
    return fail("not_found", "No such member", 404);
  }
  return { ok: true, data: target };
}

async function activeOwnerCount(organizationId: string | null): Promise<number> {
  if (!organizationId) return 0;
  return prisma.user.count({ where: { organizationId, role: "owner", status: "active" } });
}

/** Changes a member's name, role or scope. A new role wipes the scope that belonged to the old one. */
export async function updateMember(session: CurrentSession, userId: string, patch: MemberPatch): Promise<AuthResult<Member>> {
  const found = await manageable(session, userId);
  if (!found.ok) return found;
  const target = found.data;
  const actor = session.user;

  const newRole = patch.role ?? target.role;
  if (patch.role && patch.role !== target.role) {
    if (!canInvite(actor, patch.role)) return fail("forbidden", `You cannot make someone ${patch.role.replace("_", " ")}`, 403);
    if (wouldOrphanOrganization(target, await activeOwnerCount(target.organizationId))) {
      return fail("last_owner", "This is the last active owner — make someone else an owner first", 409);
    }
  }

  const roleChanged = !scopeSurvivesRoleChange(target.role, newRole);
  const wantsScope = patch.districtIds !== undefined || patch.locationIds !== undefined;
  let scope: { districtIds: string[]; locationIds: string[] } | null = null;
  if (roleChanged || wantsScope) {
    const resolved = await resolveScope(
      session,
      target.organizationId ?? "",
      newRole,
      patch.districtIds ?? (roleChanged ? [] : target.districts.map((d) => d.districtId)),
      patch.locationIds ?? (roleChanged ? [] : target.access.map((a) => a.locationId)),
    );
    if (!resolved.ok) return resolved;
    scope = resolved.data;
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: target.id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name.trim() || null } : {}),
        ...(patch.role ? { role: patch.role } : {}),
      },
    }),
    ...(scope
      ? [
          prisma.userDistrict.deleteMany({ where: { userId: target.id } }),
          prisma.locationAccess.deleteMany({ where: { userId: target.id } }),
          prisma.userDistrict.createMany({ data: scope.districtIds.map((districtId) => ({ userId: target.id, districtId })) }),
          prisma.locationAccess.createMany({ data: scope.locationIds.map((locationId) => ({ userId: target.id, locationId })) }),
        ]
      : []),
  ]);

  const row = await loadMember(target.id);
  return { ok: true, data: toMember(row!) };
}

/**
 * Takes a member out of use without taking them out of the record. Their sessions end now,
 * their pending links stop working, and everything they ever wrote still carries their name.
 */
export async function deactivateMember(session: CurrentSession, userId: string): Promise<AuthResult<Member>> {
  const found = await manageable(session, userId);
  if (!found.ok) return found;
  const target = found.data;
  if (target.status === "deactivated") return { ok: true, data: toMember(target) };
  if (wouldOrphanOrganization(target, await activeOwnerCount(target.organizationId))) {
    return fail("last_owner", "This is the last active owner — make someone else an owner first", 409);
  }
  await prisma.$transaction([
    prisma.user.update({ where: { id: target.id }, data: { status: "deactivated" } }),
    prisma.session.deleteMany({ where: { userId: target.id } }),
    prisma.authToken.updateMany({ where: { userId: target.id, usedAt: null }, data: { usedAt: new Date() } }),
  ]);
  const row = await loadMember(target.id);
  return { ok: true, data: toMember(row!) };
}

/** A fresh link for someone who has not used theirs. The old one stops working. */
export async function resendInvite(session: CurrentSession, userId: string, base: string): Promise<AuthResult<Member>> {
  const found = await manageable(session, userId);
  if (!found.ok) return found;
  const target = found.data;
  if (target.status !== "invited") return fail("not_invited", "This account is already active", 409);
  const raw = await issueInvite(target.id);
  await sendInvite(session.user, target.organizationId ?? "", target.email, target.role, raw, base);
  const row = await loadMember(target.id);
  return { ok: true, data: toMember(row!) };
}

/**
 * Withdraws an invitation nobody has used. An account that was never activated is not yet an
 * account — nothing was written under its name — so it is removed outright, which also frees
 * the address to be invited again. Deactivation is for accounts that were once live.
 */
export async function revokeInvite(session: CurrentSession, userId: string): Promise<AuthResult<{ id: string }>> {
  const found = await manageable(session, userId);
  if (!found.ok) return found;
  const target = found.data;
  if (target.status !== "invited") return fail("not_invited", "This account is already active — deactivate it instead", 409);
  await prisma.user.delete({ where: { id: target.id } });
  return { ok: true, data: { id: target.id } };
}
