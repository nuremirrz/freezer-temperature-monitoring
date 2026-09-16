import { describe, it, expect } from "vitest";
import { trendOf, TREND_WINDOW } from "./trend";

/** Readings arrive newest first, which is the order every query in the app returns. */
const newestFirst = (...xs: number[]) => xs;

describe("trendOf", () => {
  it("says nothing until there are readings on both sides", () => {
    expect(trendOf([])).toBe("unknown");
    expect(trendOf(newestFirst(10, 11, 12))).toBe("unknown");
    expect(trendOf(newestFirst(10, 11, 12, 13, 14))).toBe("unknown");
    expect(trendOf(newestFirst(10, 11, 12, 13, 14, 15))).not.toBe("unknown");
  });

  it("calls a climb rising and a drop falling", () => {
    expect(trendOf(newestFirst(30, 28, 27, 20, 19, 18))).toBe("rising");
    expect(trendOf(newestFirst(18, 19, 20, 27, 28, 30))).toBe("falling");
  });

  it("ignores a wobble smaller than a degree", () => {
    expect(trendOf(newestFirst(35.2, 35.0, 34.9, 34.8, 35.1, 34.7))).toBe("stable");
  });

  it("is not fooled by one odd reading", () => {
    // A single 40 among steady 34s averages out rather than flipping the verdict
    expect(trendOf(newestFirst(34, 40, 34, 34, 34, 34))).toBe("stable");
  });

  it("does not care where the range is — only which way the numbers moved", () => {
    // Deep inside a freezer's normal band, but climbing hard
    expect(trendOf(newestFirst(9, 8, 7, 1, 0, -1))).toBe("rising");
    // Far above it, yet steady
    expect(trendOf(newestFirst(38, 38, 38, 38, 38, 38))).toBe("stable");
  });

  it("uses only the two windows, not everything it is handed", () => {
    const tail = Array(20).fill(0);
    expect(trendOf(newestFirst(30, 30, 30, 20, 20, 20, ...tail))).toBe("rising");
    expect(TREND_WINDOW).toBe(3);
  });
});
