/**
 * Who may see which location — the pure half, with no database behind it, so the rule that
 * separates one customer's restaurants from another's can be tested on its own.
 * The lookups that need the database live in access.ts.
 */

import type { UserRole } from "@/generated/prisma/client";

/**
 * Staff get "all" rather than a list of every id — the estate is meant to grow, and loading
 * it on every request only to not filter by it would be work done for nothing.
 */
export type VisibleLocations = "all" | string[];

/**
 * Which lookup answers "what can this account see". The role decides the shape of the answer
 * and the database fills it in — so this half can be checked without one.
 *
 * - everything:    Qimby's own team, who stand above the organizations.
 * - organization:  an owner — every location of theirs, in a district or not.
 * - districts:     a manager — the locations of the districts they were given.
 * - locations:     a technician — the locations they were granted, one by one.
 * - nothing:       an owner or a manager of no organization. There is nothing to own.
 */
export type Scope =
  | { kind: "everything" }
  | { kind: "organization"; organizationId: string }
  | { kind: "districts" }
  | { kind: "locations" }
  | { kind: "nothing" };

export function scopeOf(user: { role: UserRole; organizationId: string | null }): Scope {
  switch (user.role) {
    case "admin":
      return { kind: "everything" };
    case "owner":
      return user.organizationId ? { kind: "organization", organizationId: user.organizationId } : { kind: "nothing" };
    case "district_manager":
      return user.organizationId ? { kind: "districts" } : { kind: "nothing" };
    case "technician":
      // Grants are explicit and complete by themselves: a technician sees exactly the locations
      // somebody handed them, organization or no organization. Demanding one here would have
      // switched off every account that came through the migration with none.
      return { kind: "locations" };
    default: {
      // A fifth role has to be placed here on purpose, not fall through to "sees nothing" —
      // or worse, to whatever the first branch was.
      const unhandled: never = user.role;
      throw new Error(`No scope defined for role ${String(unhandled)}`);
    }
  }
}

export function canSee(visible: VisibleLocations, locationId: string): boolean {
  return visible === "all" || visible.includes(locationId);
}

/**
 * A `where` fragment for queries that filter locations directly.
 * `{ id: { in: [] } }` matches nothing, which is the right answer for an account that has
 * been granted nothing yet — the dangerous mistake here is an empty object, which matches
 * everything.
 */
export function locationWhere(visible: VisibleLocations) {
  return visible === "all" ? {} : { id: { in: visible } };
}
