import { describe, it, expect } from "vitest";
import { canSee, locationWhere, type VisibleLocations } from "./visibility";

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
