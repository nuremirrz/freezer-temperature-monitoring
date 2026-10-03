import { describe, it, expect } from "vitest";
import { parseCurrent, parseHourly, fetchHistory } from "./open-meteo";

describe("Open-Meteo answers", () => {
  it("reads the current conditions with their own stamp", () => {
    expect(parseCurrent({ current: { time: 1_790_000_000, temperature_2m: 71.3, weather_code: 2 } })).toEqual({ at: 1_790_000_000_000, tempF: 71.3, code: 2 });
  });

  it("refuses an answer without a temperature rather than storing nothing quietly", () => {
    expect(() => parseCurrent({ current: { time: 1 } })).toThrow();
    expect(() => parseCurrent({})).toThrow();
  });

  it("skips the hours not yet measured in an hourly series", () => {
    const out = parseHourly({ hourly: { time: [1, 2, 3], temperature_2m: [60, null, 62], weather_code: [0, 1, null] } });
    expect(out).toEqual([
      { at: 1000, tempF: 60, code: 0 },
      { at: 3000, tempF: 62, code: null },
    ]);
  });
});

describe("history", () => {
  const DAY = 86_400_000;
  const now = Date.now();
  const hourly = (from: number, to: number) => {
    const time: number[] = [];
    for (let t = Math.ceil(from / 3_600_000) * 3_600_000; t <= to; t += 3_600_000) time.push(t / 1000);
    return { hourly: { time, temperature_2m: time.map(() => 65), weather_code: time.map(() => 0) } };
  };
  const fetcher = (async (url: string) => {
    const u = new URL(url);
    let body;
    if (u.hostname.startsWith("archive")) {
      body = hourly(Date.parse(u.searchParams.get("start_date")!), Date.parse(u.searchParams.get("end_date")!) + DAY);
    } else {
      body = hourly(now - Number(u.searchParams.get("past_days")) * DAY, now + DAY);
    }
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;

  it("takes a month from the forecast endpoint alone, and nothing from the future", async () => {
    const from = now - 30 * DAY;
    const s = await fetchHistory(0, 0, from, fetcher);
    expect(s.length).toBeGreaterThan(29 * 24);
    expect(s.every((x) => x.at >= from && x.at <= now)).toBe(true);
  });

  it("reaches into the archive for a year, with the two halves overlapping", async () => {
    const from = now - 365 * DAY;
    const s = await fetchHistory(0, 0, from, fetcher);
    expect(s.length).toBeGreaterThan(366 * 24); // the overlap week is in twice; the store keeps one
    expect(s[0].at).toBeGreaterThanOrEqual(from);
  });
});
