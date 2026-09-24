import { describe, it, expect } from "vitest";
import { canSee, locationWhere, scopeOf, type VisibleLocations } from "./visibility";

const ORG = "org_steven";

/**
 * The role decides which question the database is asked. The cases that matter are the ones
 * where getting it wrong hands someone the wrong estate: an owner of nothing, a manager of
 * nothing, and the technician who came through the migration with no organization at all.
 */
describe("scopeOf", () => {
  it("gives Qimby's own team everything, organization or not", () => {
    expect(scopeOf({ role: "admin", organizationId: null })).toEqual({ kind: "everything" });
    expect(scopeOf({ role: "admin", organizationId: ORG })).toEqual({ kind: "everything" });
  });

  it("gives an owner their organization, and carries its id along", () => {
    expect(scopeOf({ role: "owner", organizationId: ORG })).toEqual({ kind: "organization", organizationId: ORG });
  });

  it("gives an owner of no organization nothing — there is nothing to own", () => {
    expect(scopeOf({ role: "owner", organizationId: null })).toEqual({ kind: "nothing" });
  });

  it("sends a manager through their districts", () => {
    expect(scopeOf({ role: "district_manager", organizationId: ORG })).toEqual({ kind: "districts" });
  });

  it("gives a manager of no organization nothing", () => {
    expect(scopeOf({ role: "district_manager", organizationId: null })).toEqual({ kind: "nothing" });
  });

  /**
   * The account that exists today: migrated from `client`, granted two restaurants, in no
   * organization yet. Its grants are explicit, so it keeps them. Requiring an organization
   * here would have switched that account off the moment this shipped.
   */
  it("sends a technician through their grants, whether or not they have an organization", () => {
    expect(scopeOf({ role: "technician", organizationId: ORG })).toEqual({ kind: "locations" });
    expect(scopeOf({ role: "technician", organizationId: null })).toEqual({ kind: "locations" });
  });
});

/**
 * These two decide whether one client can see another's restaurant, so the cases worth
 * pinning down are the empty one and the "all" one — the two that are easiest to get
 * backwards, and the two where getting it backwards leaks everything.
 */

const NORCO = "loc_norco";
const TEANECK = "loc_teaneck";

describe("canSee", () => {
  it("lets staff see any location", () => {
    expect(canSee("all", NORCO)).toBe(true);
    expect(canSee("all", TEANECK)).toBe(true);
  });

  it("lets a client see only what was granted", () => {
    const visible: VisibleLocations = [NORCO];
    expect(canSee(visible, NORCO)).toBe(true);
    expect(canSee(visible, TEANECK)).toBe(false);
  });

  it("shows nothing to an account with no grants", () => {
    expect(canSee([], NORCO)).toBe(false);
    expect(canSee([], TEANECK)).toBe(false);
  });
});

describe("locationWhere", () => {
  it("does not constrain the query for staff", () => {
    expect(locationWhere("all")).toEqual({});
  });

  it("constrains the query to the granted ids", () => {
    expect(locationWhere([NORCO])).toEqual({ id: { in: [NORCO] } });
  });

  it("matches nothing for an account with no grants, rather than everything", () => {
    expect(locationWhere([])).toEqual({ id: { in: [] } });
  });
});
