import { describe, it, expect } from "vitest";
import { chartNotices, type NoticeInput } from "./chart-notices";

const LA = "America/Los_Angeles";
const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = Date.UTC(2026, 9, 10, 20, 0); // 1 PM in Los Angeles

/** A healthy day: a reading every five minutes, right up to now. */
function input(over: Partial<NoticeInput> = {}): NoticeInput {
  const from = NOW - 24 * HOUR;
  const times: number[] = [];
  for (let t = from; t <= NOW; t += 5 * MIN) times.push(t);
  return {
    times,
    from,
    to: NOW,
    live: true,
    bucketMinutes: null,
    intervalSec: 300,
    observedGapMs: 5 * MIN,
    maxGapMs: 16 * MIN,
    firstReadingAt: from - 30 * 24 * HOUR,
    timeZone: LA,
    now: NOW,
    ...over,
  };
}

const kinds = (i: NoticeInput) => chartNotices(i).map((n) => n.kind);
const textOf = (i: NoticeInput, kind: string) => chartNotices(i).find((n) => n.kind === kind)?.text;

describe("a chart with nothing to complain about", () => {
  it("says nothing", () => {
    expect(chartNotices(input())).toEqual([]);
  });
});

describe("nothing drawn", () => {
  it("says the period is empty when the unit has older readings", () => {
    expect(textOf(input({ times: [] }), "empty")).toBe("No readings in this period");
  });

  it("says when the unit's history begins, if it begins after this period", () => {
    const i = input({ times: [], firstReadingAt: NOW + 5 * 24 * HOUR });
    expect(textOf(i, "starts-late")).toBe("This unit's first reading is Oct 15");
    expect(kinds(i)).toEqual(["starts-late"]); // and not "no readings", which explains nothing
  });

  it("names the year when the history begins in another one", () => {
    const i = input({ times: [], from: Date.UTC(2025, 0, 1), to: Date.UTC(2025, 0, 2), firstReadingAt: NOW });
    expect(textOf(i, "starts-late")).toBe("This unit's first reading is Oct 10, 2026");
  });
});

describe("the series stops before the window does", () => {
  it("counts the silence from now while the window is still moving", () => {
    const times = input().times.filter((t) => t <= NOW - 3 * HOUR);
    expect(textOf(input({ times }), "ends-early")).toBe("Last reading 3 h ago");
  });

  it("names the moment instead, when the window is a period someone chose", () => {
    const times = input().times.filter((t) => t <= NOW - 3 * HOUR);
    expect(textOf(input({ times, live: false }), "ends-early")).toBe("Last reading Oct 10, 10:00 AM");
  });

  it("stays quiet while the silence is still shorter than a break in the line", () => {
    const times = input().times.filter((t) => t <= NOW - 10 * MIN);
    expect(kinds(input({ times }))).toEqual([]);
  });
});

describe("the pace on the wire against the pace on record", () => {
  it("says both when the device slows down — the San Bernardino case", () => {
    const from = NOW - 24 * HOUR;
    const times: number[] = [];
    for (let t = from; t <= NOW; t += 20 * MIN) times.push(t);
    const i = input({ times, observedGapMs: 20 * MIN, maxGapMs: 61 * MIN });
    expect(textOf(i, "pace")).toBe("This sensor reports every 20 min, and is set to 5 min");
  });

  it("says both when it speeds up", () => {
    const i = input({ intervalSec: 1200, observedGapMs: 5 * MIN, maxGapMs: 61 * MIN });
    expect(textOf(i, "pace")).toBe("This sensor reports every 5 min, and is set to 20 min");
  });

  it("ignores a drift too small to mean anything", () => {
    expect(kinds(input({ observedGapMs: 6 * MIN }))).toEqual([]);
  });

  it("keeps quiet about averaged points, whose spacing is ours and not the device's", () => {
    const from = NOW - 30 * 24 * HOUR;
    const times: number[] = [];
    for (let t = from; t <= NOW; t += 2 * HOUR) times.push(t);
    const i = input({ times, from, bucketMinutes: 120, observedGapMs: 2 * HOUR, maxGapMs: 4 * HOUR });
    expect(kinds(i)).toEqual([]);
  });
});

describe("holes inside the window", () => {
  it("counts them and names the worst", () => {
    const times = input().times.filter((t) => {
      const age = NOW - t;
      return !(age > 4 * HOUR && age < 4 * HOUR + 42 * MIN) && !(age > 9 * HOUR && age < 9 * HOUR + 25 * MIN);
    });
    expect(textOf(input({ times }), "gaps")).toBe("The link dropped 2 times, the longest for 45 min");
  });

  it("counts a single one in the singular", () => {
    const times = input().times.filter((t) => !(NOW - t > 4 * HOUR && NOW - t < 4 * HOUR + 42 * MIN));
    expect(textOf(input({ times }), "gaps")).toBe("The link dropped once, for 45 min");
  });
});

describe("the left edge", () => {
  it("explains an empty left side by the unit having no older readings", () => {
    const from = NOW - 24 * HOUR;
    const times = input().times.filter((t) => t >= from + 6 * HOUR);
    const i = input({ times, firstReadingAt: from + 6 * HOUR });
    // from + 6 h is 02:00 UTC, which is still the evening of the 9th in Los Angeles
    expect(textOf(i, "starts-late")).toBe("This unit's first reading is Oct 9");
  });

  it("says nothing when the readings reach back past the window", () => {
    expect(kinds(input())).toEqual([]);
  });
});

describe("order", () => {
  it("puts the silence and the pace ahead of the rest, so two notices are the useful two", () => {
    const from = NOW - 24 * HOUR;
    const times: number[] = [];
    for (let t = from + 6 * HOUR; t <= NOW - 3 * HOUR; t += 20 * MIN) times.push(t);
    const i = input({ times, observedGapMs: 20 * MIN, maxGapMs: 61 * MIN, firstReadingAt: from + 6 * HOUR });
    expect(kinds(i).slice(0, 2)).toEqual(["ends-early", "pace"]);
  });
});
