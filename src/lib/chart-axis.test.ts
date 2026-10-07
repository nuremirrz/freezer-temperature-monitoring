import { describe, it, expect } from "vitest";
import { axisTicks, tickLabel, windowLabel, breakGaps, maxGapMs, sampleAt } from "./chart-axis";
import { zonedParts } from "./tz";

const LA = "America/Los_Angeles";
const utc = (y: number, m: number, d: number, h = 0, mi = 0) => Date.UTC(y, m - 1, d, h, mi);
const H = 3_600_000;
const D = 24 * H;

describe("ticks on the restaurant's clock", () => {
  it("puts a day's ticks on local whole hours, labelled as the clock on the wall reads", () => {
    // 25 Sep 2 PM to 26 Sep 2 PM Pacific
    const from = utc(2026, 9, 25, 21), to = utc(2026, 9, 26, 21);
    const { mode, values } = axisTicks(from, to, LA);
    expect(mode).toBe("hour");
    expect(values.map((t) => zonedParts(t, LA).h)).toEqual([15, 18, 21, 0, 3, 6, 9, 12]);
    expect(tickLabel(mode, values[3], LA)).toBe("12 AM");
  });

  it("gives an AC chart more ticks than a freezer's", () => {
    const from = utc(2026, 9, 25, 21), to = from + 12 * H;
    expect(axisTicks(from, to, LA, true).values).toHaveLength(13);
    expect(axisTicks(from, to, LA, false).values).toHaveLength(7);
  });

  it("stays on local hours across the clocks going back", () => {
    // 31 Oct 8 PM to 1 Nov 8 PM Pacific: 25 hours long
    const from = utc(2026, 11, 1, 3), to = utc(2026, 11, 2, 4);
    const parts = axisTicks(from, to, LA).values.map((t) => zonedParts(t, LA));
    const hours = parts.map((p) => p.h);
    expect(parts.every((p) => p.mi === 0 && p.h % 4 === 0)).toBe(true);
    expect(hours).toContain(0);
  });

  it("puts a month's ticks on local midnight every third day", () => {
    const from = utc(2026, 9, 3, 17), to = from + 30 * D;
    const { mode, values } = axisTicks(from, to, LA);
    expect(mode).toBe("day");
    expect(values.every((t) => zonedParts(t, LA).h === 0 && zonedParts(t, LA).mi === 0)).toBe(true);
    expect(values.length).toBe(10);
    expect(tickLabel(mode, values[0], LA)).toBe("Sep 4");
  });

  it("puts a year's ticks on the first of each month, with the year on January", () => {
    const from = utc(2025, 10, 3, 17), to = utc(2026, 10, 3, 17);
    const { mode, values } = axisTicks(from, to, LA);
    expect(mode).toBe("month");
    expect(values).toHaveLength(12);
    expect(values.every((t) => zonedParts(t, LA).d === 1)).toBe(true);
    expect(tickLabel(mode, values[0], LA)).toBe("Nov");
    expect(tickLabel(mode, values[2], LA)).toBe("Jan 2026");
  });
});

describe("the heading for a window", () => {
  it("drops the second date when both ends fall on one day", () => {
    expect(windowLabel(utc(2026, 9, 25, 21), utc(2026, 9, 26, 2), LA)).toBe("Sep 25, 2:00 PM – 7:00 PM");
  });
  it("names both days otherwise, and the years only when they differ", () => {
    expect(windowLabel(utc(2026, 9, 25, 21), utc(2026, 9, 26, 21), LA)).toBe("Sep 25, 2:00 PM – Sep 26, 2:00 PM");
    expect(windowLabel(utc(2025, 12, 31, 20), utc(2026, 1, 1, 20), LA)).toBe("Dec 31, 2025, 12:00 PM – Jan 1, 2026, 12:00 PM");
  });
});

describe("gaps in the line", () => {
  it("breaks the line where readings stopped for three intervals, and nowhere else", () => {
    const pts = [0, 5, 10, 40, 45].map((m) => ({ t: m * 60_000, v: 1 }));
    const out = breakGaps(pts, maxGapMs(null, 300));
    expect(out).toHaveLength(6);
    expect(out[3]).toEqual({ t: 10 * 60_000 + 1, gap: true });
  });
  it("breaks an averaged line at an empty bucket", () => {
    expect(maxGapMs(30, 300)).toBe(60 * 60_000);
    expect(breakGaps([{ t: 0 }, { t: 30 * 60_000 }, { t: 90 * 60_000 }], maxGapMs(30, 300))).toHaveLength(3);
    expect(breakGaps([{ t: 0 }, { t: 30 * 60_000 }, { t: 100 * 60_000 }], maxGapMs(30, 300))).toHaveLength(4);
  });
});

describe("a coarser series read at a finer one's moments", () => {
  const HOUR = 3_600_000;
  // The air outside, on the hour
  const weather = [0, 1, 2].map((h) => ({ t: h * HOUR, v: 60 + h * 10 }));

  it("gives the sample itself at a moment that falls on one", () => {
    expect(sampleAt([0, HOUR, 2 * HOUR], weather, 2 * HOUR)).toEqual([60, 70, 80]);
  });

  it("reads between two samples rather than reusing the one before", () => {
    // The bug this was written for: at 4 AM the chart showed 4 PM's air
    expect(sampleAt([HOUR / 2, 1.5 * HOUR], weather, 2 * HOUR)).toEqual([65, 75]);
  });

  it("has no value before the first sample or after the last", () => {
    expect(sampleAt([-HOUR, 3 * HOUR], weather, 2 * HOUR)).toEqual([null, null]);
  });

  it("leaves a hole across a gap in the samples instead of drawing through it", () => {
    const withGap = [{ t: 0, v: 60 }, { t: 10 * HOUR, v: 80 }];
    expect(sampleAt([5 * HOUR], withGap, 2 * HOUR)).toEqual([null]);
    expect(sampleAt([5 * HOUR], withGap, 12 * HOUR)).toEqual([70]);
  });

  it("gives nothing at all when there are no samples", () => {
    expect(sampleAt([0, HOUR], [], 2 * HOUR)).toEqual([null, null]);
  });

  it("walks a long pair of series in step, not from the start each time", () => {
    const samples = Array.from({ length: 500 }, (_, i) => ({ t: i * HOUR, v: i }));
    const times = Array.from({ length: 2000 }, (_, i) => i * (HOUR / 4));
    const out = sampleAt(times, samples, 2 * HOUR);
    expect(out[0]).toBe(0);
    expect(out[4]).toBe(1);
    expect(out[2]).toBe(0.5);
  });
});
