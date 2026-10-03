import { describe, it, expect } from "vitest";
import { zonedToUtcMs, zonedParts, startOfZonedDay, addZonedDays, tzAbbrev, toLocalInput, fromLocalInput } from "./tz";

const LA = "America/Los_Angeles";
const BISHKEK = "Asia/Bishkek";
const utc = (y: number, m: number, d: number, h = 0, mi = 0) => Date.UTC(y, m - 1, d, h, mi);

describe("a restaurant's wall clock to an instant", () => {
  it("applies summer time in September and winter time in December", () => {
    expect(zonedToUtcMs({ y: 2026, m: 9, d: 25, h: 14, mi: 0 }, LA)).toBe(utc(2026, 9, 25, 21, 0));
    expect(zonedToUtcMs({ y: 2026, m: 12, d: 1, h: 14, mi: 0 }, LA)).toBe(utc(2026, 12, 1, 22, 0));
  });

  it("moves a wall time that never happened forward by the gap — 2:30 on 8 Mar becomes 3:30", () => {
    expect(zonedToUtcMs({ y: 2026, m: 3, d: 8, h: 2, mi: 30 }, LA)).toBe(utc(2026, 3, 8, 10, 30));
  });

  it("takes the first time round for one that happened twice — 1:30 on 1 Nov", () => {
    expect(zonedToUtcMs({ y: 2026, m: 11, d: 1, h: 1, mi: 30 }, LA)).toBe(utc(2026, 11, 1, 8, 30));
  });

  it("works for a zone with no summer time, a long way from Los Angeles", () => {
    expect(zonedToUtcMs({ y: 2026, m: 9, d: 25, h: 14, mi: 0 }, BISHKEK)).toBe(utc(2026, 9, 25, 8, 0));
  });
});

describe("an instant back to the wall clock", () => {
  it("round-trips across the whole of a day", () => {
    for (const h of [0, 1, 6, 12, 23]) {
      const ms = zonedToUtcMs({ y: 2026, m: 9, d: 25, h, mi: 15 }, LA);
      expect(zonedParts(ms, LA)).toEqual({ y: 2026, m: 9, d: 25, h, mi: 15 });
    }
  });

  it("reads midnight as 0, not 24", () => {
    expect(zonedParts(utc(2026, 9, 25, 7, 0), LA).h).toBe(0);
  });
});

describe("days on the restaurant's clock", () => {
  it("starts a day at local midnight", () => {
    // 3 PM Pacific on 25 Sep is 22:00 UTC; the day began at 07:00 UTC
    expect(startOfZonedDay(utc(2026, 9, 25, 22, 0), LA)).toBe(utc(2026, 9, 25, 7, 0));
  });

  it("is 23 hours across the spring change and 25 across the autumn one", () => {
    const spring = startOfZonedDay(utc(2026, 3, 8, 20, 0), LA);
    expect(addZonedDays(spring, 1, LA) - spring).toBe(23 * 3_600_000);
    const autumn = startOfZonedDay(utc(2026, 11, 1, 20, 0), LA);
    expect(addZonedDays(autumn, 1, LA) - autumn).toBe(25 * 3_600_000);
  });
});

describe("the zone's name and the text form", () => {
  it("names the zone as it stands at that moment", () => {
    expect(tzAbbrev(utc(2026, 9, 25, 21, 0), LA)).toBe("PDT");
    expect(tzAbbrev(utc(2026, 12, 1, 22, 0), LA)).toBe("PST");
  });

  it("writes and reads a wall-clock time for an address", () => {
    const ms = utc(2026, 9, 25, 21, 0);
    expect(toLocalInput(ms, LA)).toBe("2026-09-25T14:00");
    expect(fromLocalInput("2026-09-25T14:00", LA)).toBe(ms);
  });

  it("refuses what is not a time", () => {
    expect(fromLocalInput("2026-02-31T10:00", LA)).toBeNull();
    expect(fromLocalInput("2026-09-25T25:00", LA)).toBeNull();
    expect(fromLocalInput("yesterday", LA)).toBeNull();
    expect(fromLocalInput("2026-09-25 14:00", LA)).toBeNull();
  });
});
