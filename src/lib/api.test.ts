import { describe, it, expect } from "vitest";
import { tempReadout, formatTemp } from "./api";

/**
 * The client's table, as written on 16 Sep. Two things these pin down: the colour must never
 * argue with the number beside it (67.6 shows as "68", so a 68 range contains it), and the
 * boundaries belong to the band above — "33-40 Normal" means 33 is already normal.
 */

const FREEZER = { type: "walk_in_freezer", rangeMinF: 0, rangeMaxF: 10, alertMinF: -40, alertMaxF: 20 } as const;
const COOLER = { type: "walk_in_cooler", rangeMinF: 33, rangeMaxF: 40, alertMinF: 33, alertMaxF: 50 } as const;
const AC_DINING = { type: "ac", rangeMinF: 65, rangeMaxF: 75, alertMinF: 65, alertMaxF: 80 } as const;
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

describe("AC", () => {
  it("dining is green 65-75, amber to 80, red past it", () => {
    expect(level(64, AC_DINING)).toBe("critical");
    expect(tempReadout(64, AC_DINING).note).toBe("Below normal");
    expect(level(65, AC_DINING)).toBe("normal");
    expect(level(75, AC_DINING)).toBe("normal");
    expect(level(76, AC_DINING)).toBe("warning");
    expect(level(80, AC_DINING)).toBe("warning");
    expect(level(81, AC_DINING)).toBe("critical");
  });

  it("kitchen is allowed to run warmer than dining", () => {
    expect(level(78, AC_KITCHEN)).toBe("normal");
    expect(level(78, AC_DINING)).toBe("warning");
    expect(level(84, AC_KITCHEN)).toBe("warning");
    expect(level(86, AC_KITCHEN)).toBe("critical");
  });
});

describe("the number and its colour agree", () => {
  it("judges what is displayed, not what was measured", () => {
    expect(formatTemp(64.6)).toBe("65°F");
    expect(level(64.6, AC_DINING)).toBe("normal");
    expect(formatTemp(10.4)).toBe("10°F");
    expect(level(10.4, FREEZER)).toBe("normal");
  });
});
