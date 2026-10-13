import { describe, it, expect } from "vitest";
import { tempReadout, formatTemp, isTroubleLevel, isOutOfRange } from "./api";

/**
 * The client's table, as written on 16 Sep. Two things these pin down: the colour must never
 * argue with the number beside it (67.6 shows as "68", so a 68 range contains it), and the
 * boundaries belong to the band above — "33-40 Normal" means 33 is already normal.
 */

const FREEZER = { type: "walk_in_freezer", rangeMinF: 0, rangeMaxF: 10, alertMinF: -40, alertMaxF: 20 } as const;
const COOLER = { type: "walk_in_cooler", rangeMinF: 33, rangeMaxF: 40, alertMinF: 33, alertMaxF: 50 } as const;
// Dining was raised from 75 to 77 on 14 Oct 2026; see scripts/setup-locations.mts.
const AC_DINING = { type: "ac", rangeMinF: 65, rangeMaxF: 77, alertMinF: 65, alertMaxF: 80 } as const;
const AC_KITCHEN = { type: "ac", rangeMinF: 65, rangeMaxF: 80, alertMinF: 65, alertMaxF: 85 } as const;

const level = (t: number, u: Parameters<typeof tempReadout>[1]) => tempReadout(t, u).level;

describe("freezer", () => {
  it("is green up to 10, amber to 20, red past it", () => {
    expect(level(-5, FREEZER)).toBe("normal");
    expect(level(10, FREEZER)).toBe("normal");
    expect(level(11, FREEZER)).toBe("warning");
    expect(level(20, FREEZER)).toBe("warning");
    expect(level(21, FREEZER)).toBe("critical");
    expect(level(40, FREEZER)).toBe("critical");
  });
});

describe("cooler", () => {
  it("calls freezing a critical, not a warning", () => {
    expect(level(32, COOLER)).toBe("critical");
    expect(tempReadout(32, COOLER).note).toBe("Freeze risk");
  });

  it("is green 33-40, amber to 50, red past it", () => {
    expect(level(33, COOLER)).toBe("normal");
    expect(level(40, COOLER)).toBe("normal");
    expect(level(41, COOLER)).toBe("warning");
    expect(level(50, COOLER)).toBe("warning");
    expect(level(51, COOLER)).toBe("critical");
  });
});

/**
 * An AC's room temperature used to be coloured by these bands, the way a freezer's is. It is
 * not any more: the unit is judged by the drop across its duct, so the room is a fact about
 * the weather and the kitchen, not a verdict on the equipment. Painting it would show a
 * warning with no alert behind it — Sanjar asked for the number without the colour on
 * 14 Oct 2026, and these cases are what that decision looks like.
 */
describe("AC", () => {
  it("has no verdict painted on its room temperature, at any reading", () => {
    for (const t of [60, 64, 70, 78, 84, 99]) {
      expect(level(t, AC_DINING)).toBe("unjudged");
      expect(level(t, AC_KITCHEN)).toBe("unjudged");
    }
  });

  it("says nothing under the number either, so the card cannot contradict itself", () => {
    expect(tempReadout(64, AC_DINING).note).toBeNull();
    expect(tempReadout(99, AC_KITCHEN).note).toBeNull();
  });

  it("is never reported as out of range on the room, however hot the room gets", () => {
    // The bands have not gone anywhere — the chart still paints them and the cooling rule
    // still reads rangeMaxF as the point from which a unit is expected to be working. What
    // changed is that the room no longer passes judgement, and this is the thing that would
    // have put an amber warning on a card with no alert behind it.
    expect(isOutOfRange(99, AC_KITCHEN)).toBe(false);
    expect(isOutOfRange(60, AC_DINING)).toBe(false);
    expect(isOutOfRange(99, COOLER)).toBe(true);
  });
});

describe("isTroubleLevel", () => {
  it("counts the two levels that mean trouble, and neither normal nor unjudged", () => {
    expect([isTroubleLevel("warning"), isTroubleLevel("critical")]).toEqual([true, true]);
    expect([isTroubleLevel("normal"), isTroubleLevel("unjudged")]).toEqual([false, false]);
  });
});

describe("the number and its colour agree", () => {
  it("judges what is displayed, not what was measured", () => {
    expect(formatTemp(40.4)).toBe("40°F");
    expect(level(40.4, COOLER)).toBe("normal");
    expect(formatTemp(10.4)).toBe("10°F");
    expect(level(10.4, FREEZER)).toBe("normal");
  });
});
