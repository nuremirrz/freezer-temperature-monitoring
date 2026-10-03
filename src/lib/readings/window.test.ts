import { describe, it, expect } from "vitest";
import { resolveWindow, bucketMinutesFor } from "./window";

const NOW = Date.UTC(2026, 9, 3, 17, 0);
const H = 3_600_000;
const D = 24 * H;

describe("presets", () => {
  it("end now, move with the clock, and keep the bucket sizes the chart had before", () => {
    for (const [range, hours, bucket] of [["12h", 12, null], ["1d", 24, null], ["1w", 168, 30], ["1m", 720, 120]] as const) {
      const r = resolveWindow({ range }, NOW);
      expect(r.ok && r.window).toMatchObject({ range, from: NOW - hours * H, to: NOW, live: true, bucketMinutes: bucket });
    }
  });

  it("default to a day and refuse a made-up preset", () => {
    expect(resolveWindow({}, NOW)).toMatchObject({ ok: true, window: { range: "1d" } });
    expect(resolveWindow({ range: "1y" }, NOW).ok).toBe(false);
  });
});

describe("a chosen period", () => {
  it("is fixed, not live, and sized to a few hundred points", () => {
    const r = resolveWindow({ from: "2026-09-01T07:00:00Z", to: "2026-09-08T07:00:00Z" }, NOW);
    expect(r.ok && r.window).toMatchObject({ range: "custom", live: false, bucketMinutes: 30 });
  });

  it("stops at now when it reaches past it", () => {
    const r = resolveWindow({ from: new Date(NOW - D).toISOString(), to: new Date(NOW + D).toISOString() }, NOW);
    expect(r.ok && r.window.to).toBe(NOW);
  });

  it("refuses nonsense: backwards, too short, over a year, in the future, not a date", () => {
    const iso = (ms: number) => new Date(ms).toISOString();
    expect(resolveWindow({ from: iso(NOW - H), to: iso(NOW - 2 * H) }, NOW).ok).toBe(false);
    expect(resolveWindow({ from: iso(NOW - 60_000), to: iso(NOW) }, NOW).ok).toBe(false);
    expect(resolveWindow({ from: iso(NOW - 367 * D), to: iso(NOW) }, NOW).ok).toBe(false);
    expect(resolveWindow({ from: iso(NOW + H), to: iso(NOW + 2 * H) }, NOW).ok).toBe(false);
    expect(resolveWindow({ from: "last tuesday", to: iso(NOW) }, NOW).ok).toBe(false);
    expect(resolveWindow({ from: iso(NOW - H) }, NOW).ok).toBe(false);
  });

  it("wins over a preset given alongside it", () => {
    const r = resolveWindow({ range: "1w", from: "2026-09-01T07:00:00Z", to: "2026-09-02T07:00:00Z" }, NOW);
    expect(r.ok && r.window.range).toBe("custom");
  });
});

describe("bucket size", () => {
  it("is raw up to two days, then the smallest step that stays under 600 points", () => {
    expect(bucketMinutesFor(2 * D)).toBeNull();
    expect(bucketMinutesFor(3 * D)).toBe(10);
    expect(bucketMinutesFor(7 * D)).toBe(30);
    expect(bucketMinutesFor(30 * D)).toBe(120);
    expect(bucketMinutesFor(90 * D)).toBe(360);
    expect(bucketMinutesFor(366 * D)).toBe(1440);
  });
});
