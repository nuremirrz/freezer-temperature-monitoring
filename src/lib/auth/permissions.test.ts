import { describe, it, expect } from "vitest";
import {
  invitableRoles,
  canInvite,
  canManageTeam,
  canManageDistricts,
  canEditRange,
  canEditPassport,
  canFileReport,
  wouldOrphanOrganization,
  scopeSurvivesRoleChange,
  type Actor,
} from "./permissions";

const ORG = "org_steven";
const admin: Actor = { role: "admin", organizationId: null };
const owner: Actor = { role: "owner", organizationId: ORG };
const manager: Actor = { role: "district_manager", organizationId: ORG };
const technician: Actor = { role: "technician", organizationId: ORG };

/**
 * The permission matrix from the spec, row by row. The cases that matter most are the ones
 * where a wrong answer widens someone's reach: a manager who could make managers, a technician
 * who could set a range, the last owner who could remove themselves.
 */

describe("who may invite whom", () => {
  it("lets an owner hand out any customer role, another owner included", () => {
    expect(invitableRoles(owner)).toEqual(["owner", "district_manager", "technician"]);
  });

  it("lets a manager make technicians and only technicians", () => {
    expect(invitableRoles(manager)).toEqual(["technician"]);
    expect(canInvite(manager, "technician")).toBe(true);
    expect(canInvite(manager, "district_manager")).toBe(false);
    expect(canInvite(manager, "owner")).toBe(false);
  });

  it("lets a technician invite nobody", () => {
    expect(invitableRoles(technician)).toEqual([]);
    expect(canInvite(technician, "technician")).toBe(false);
  });

  it("never hands out the admin role by invitation", () => {
    for (const actor of [admin, owner, manager, technician]) {
      expect(canInvite(actor, "admin")).toBe(false);
    }
  });

  it("lets Qimby's team set an organization up", () => {
    expect(invitableRoles(admin)).toEqual(["owner", "district_manager", "technician"]);
  });
});

describe("managing the team and the districts", () => {
  it("is for owners", () => {
    expect(canManageTeam(owner)).toBe(true);
    expect(canManageDistricts(owner)).toBe(true);
  });

  it("is not for managers or technicians", () => {
    expect(canManageTeam(manager)).toBe(false);
    expect(canManageTeam(technician)).toBe(false);
    expect(canManageDistricts(manager)).toBe(false);
    expect(canManageDistricts(technician)).toBe(false);
  });

  it("is open to Qimby's team", () => {
    expect(canManageTeam(admin)).toBe(true);
    expect(canManageDistricts(admin)).toBe(true);
  });
});

describe("what each role may do to a unit", () => {
  it("lets everyone but a technician set the range", () => {
    expect(canEditRange(owner)).toBe(true);
    expect(canEditRange(manager)).toBe(true);
    expect(canEditRange(admin)).toBe(true);
    expect(canEditRange(technician)).toBe(false);
  });

  it("lets everyone edit the passport, the technician at the unit included", () => {
    for (const actor of [admin, owner, manager, technician]) {
      expect(canEditPassport(actor)).toBe(true);
    }
  });

  it("lets only a technician file a report", () => {
    expect(canFileReport(technician)).toBe(true);
    expect(canFileReport(owner)).toBe(false);
    expect(canFileReport(manager)).toBe(false);
    expect(canFileReport(admin)).toBe(false);
  });
});

describe("the last owner", () => {
  const activeOwner = { role: "owner", status: "active" } as const;

  it("may not be removed when they are the only one", () => {
    expect(wouldOrphanOrganization(activeOwner, 1)).toBe(true);
  });

  it("may be removed when another active owner remains", () => {
    expect(wouldOrphanOrganization(activeOwner, 2)).toBe(false);
  });

  it("is not a concern when the target is not an active owner", () => {
    expect(wouldOrphanOrganization({ role: "district_manager", status: "active" }, 1)).toBe(false);
    expect(wouldOrphanOrganization({ role: "owner", status: "invited" }, 1)).toBe(false);
    expect(wouldOrphanOrganization({ role: "owner", status: "deactivated" }, 1)).toBe(false);
  });

  /** A count of zero means the data is already wrong; the guard must still refuse. */
  it("refuses even when the count says nobody is left", () => {
    expect(wouldOrphanOrganization(activeOwner, 0)).toBe(true);
  });
});

describe("changing a role", () => {
  it("wipes the old role's scope", () => {
    expect(scopeSurvivesRoleChange("district_manager", "technician")).toBe(false);
    expect(scopeSurvivesRoleChange("technician", "district_manager")).toBe(false);
  });

  it("keeps the scope when the role is unchanged", () => {
    expect(scopeSurvivesRoleChange("technician", "technician")).toBe(true);
  });
});
