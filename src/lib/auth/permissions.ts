/**
 * Who may do what — the client's permission matrix as code, with no database behind it.
 *
 * Every route that changes something asks here first. The matrix lives in one place so that a
 * row in the spec maps to one function, and a change to the spec is a change to one function
 * and its test — not a hunt through route handlers for the `role ===` that encodes it.
 *
 * Reach (which locations) is a separate question, answered in visibility.ts. These functions
 * assume the target is already within the actor's reach; they decide only whether the role
 * may act on it.
 */

import type { UserRole, UserStatus } from "@/generated/prisma/client";

export interface Actor {
  role: UserRole;
  organizationId: string | null;
}

const ALL_CUSTOMER_ROLES: readonly UserRole[] = ["owner", "district_manager", "technician"];
const EVERY_ROLE: readonly UserRole[] = ["admin", ...ALL_CUSTOMER_ROLES];

/**
 * Which roles this actor may hand out by invitation.
 *
 * An owner may make anyone, another owner included. A manager may make technicians and only
 * technicians — a manager who could mint managers could widen their own reach. A technician
 * makes nobody. Qimby's team may make anyone, since they set an organization up.
 */
export function invitableRoles(actor: Actor): readonly UserRole[] {
  switch (actor.role) {
    case "admin":
    case "owner":
      return ALL_CUSTOMER_ROLES;
    case "district_manager":
      return ["technician"];
    case "technician":
      return [];
    default:
      return unhandled(actor.role);
  }
}

export function canInvite(actor: Actor, role: UserRole): boolean {
  return invitableRoles(actor).includes(role);
}

/** Change someone's role or scope, deactivate them, resend or revoke their invitation. */
export function canManageTeam(actor: Actor): boolean {
  return actor.role === "owner" || actor.role === "admin";
}

/** Create, rename and delete districts, and move locations between them. */
export function canManageDistricts(actor: Actor): boolean {
  return actor.role === "owner" || actor.role === "admin";
}

/** Set a unit's normal and alert ranges. */
export function canEditRange(actor: Actor): boolean {
  return actor.role !== "technician";
}

/**
 * Model, serial, year, refrigerant and the rest of the nameplate. Every role — a technician
 * standing at the unit is the one who can read it. Listed rather than assumed, so that a fifth
 * role is granted this on purpose and not by falling through.
 */
export function canEditPassport(actor: Actor): boolean {
  return EVERY_ROLE.includes(actor.role);
}

/** File and edit a work report. Technicians only: reports say what was done, by whom. */
export function canFileReport(actor: Actor): boolean {
  return actor.role === "technician";
}

/**
 * Whether taking `target` out of the owners — by changing their role, or by deactivating them —
 * would leave the organization with no active owner at all.
 *
 * `activeOwners` is how many active owners the organization has right now, target included.
 * With nobody left to let people in, an organization is locked from the outside forever, so
 * the last owner may not be removed by anyone, themselves included.
 */
export function wouldOrphanOrganization(
  target: { role: UserRole; status: UserStatus },
  activeOwners: number,
): boolean {
  const targetIsActiveOwner = target.role === "owner" && target.status === "active";
  return targetIsActiveOwner && activeOwners <= 1;
}

/** A role change wipes the scope that belonged to the old role. */
export function scopeSurvivesRoleChange(from: UserRole, to: UserRole): boolean {
  return from === to;
}

function unhandled(role: never): never {
  throw new Error(`No permissions defined for role ${String(role)}`);
}
