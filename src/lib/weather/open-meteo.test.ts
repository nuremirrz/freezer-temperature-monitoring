import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseCurrent, parseHourly, fetchHistory, fetchCurrent, RETRY_AFTER_MS } from "./open-meteo";

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

/**
 * Why these exist: for nine days the weather sampler logged `Unexpected token 'U',
 * "Unexpected"... is not valid JSON` — fifty-one times, with nothing in the message saying
 * which endpoint, what status, or what had actually answered. The failures arrived in bursts
 * that took every restaurant in the same second, so they were brief and not ours.
 *
 * The clock is faked here so the retry's two-second wait costs the suite nothing.
 */
describe("an answer that is not what was asked for", () => {
  const ok = JSON.stringify({ current: { time: 1_790_000_000, temperature_2m: 71.3, weather_code: 2 } });

  /** Replies in order, one per call, and counts the calls. */
  const serving = (...replies: (Response | Error)[]) => {
    let n = 0;
    const fetcher = (async () => {
      const r = replies[Math.min(n++, replies.length - 1)];
      if (r instanceof Error) throw r;
      return r.clone();
    }) as unknown as typeof fetch;
    return { fetcher, calls: () => n };
  };

  /** Runs one call to completion, letting the retry's wait pass instantly. */
  const settle = async <T>(p: Promise<T>): Promise<{ value?: T; error?: Error }> => {
    const caught = p.then((value) => ({ value }), (error: Error) => ({ error }));
    await vi.advanceTimersByTimeAsync(RETRY_AFTER_MS * 3);
    return caught;
  };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("says what answered instead, rather than where JSON.parse gave up", async () => {
    const s = serving(new Response("Unexpected error, please try again", { status: 200, headers: { "content-type": "text/plain" } }));
    const { error } = await settle(fetchCurrent(32.75, -117.2, s.fetcher));
    expect(error?.message).toContain("Unexpected error, please try again");
    expect(error?.message).toContain("text/plain");
    expect(error?.message).toContain("/v1/forecast");
    // The old message was "Unexpected token 'U', \"Unexpected\"... is not valid JSON" and said none of it
    expect(error?.message).not.toMatch(/Unexpected token/);
  });

  it("asks once more, and takes the good answer", async () => {
    const s = serving(
      new Response("Unexpected error", { status: 200, headers: { "content-type": "text/plain" } }),
      new Response(ok, { status: 200, headers: { "content-type": "application/json" } }),
    );
    const { value } = await settle(fetchCurrent(32.75, -117.2, s.fetcher));
    expect(value).toEqual({ at: 1_790_000_000_000, tempF: 71.3, code: 2 });
    expect(s.calls()).toBe(2);
  });

  it("asks once more after a connection that never answered", async () => {
    const s = serving(new TypeError("fetch failed"), new Response(ok, { status: 200 }));
    const { value } = await settle(fetchCurrent(32.75, -117.2, s.fetcher));
    expect(value).toMatchObject({ tempF: 71.3 });
    expect(s.calls()).toBe(2);
  });

  it("asks once more when the service itself is in trouble, and stops at two", async () => {
    const s = serving(new Response("gateway", { status: 502 }));
    const { error } = await settle(fetchCurrent(32.75, -117.2, s.fetcher));
    expect(error?.message).toContain("502");
    expect(s.calls()).toBe(2);
  });

  it("does not ask twice when our own request is wrong", async () => {
    // 400 {"error":true,"reason":"Latitude must be in range…"} — just as true a second later
    const s = serving(new Response(JSON.stringify({ error: true, reason: "Latitude must be in range of -90 to 90°" }), { status: 400 }));
    const { error } = await settle(fetchCurrent(999, -117.2, s.fetcher));
    expect(error?.message).toContain("Latitude must be in range");
    expect(s.calls()).toBe(1);
  });

  it("names an empty body rather than printing nothing", async () => {
    const s = serving(new Response("", { status: 200, headers: { "content-type": "text/html" } }));
    const { error } = await settle(fetchCurrent(32.75, -117.2, s.fetcher));
    expect(error?.message).toContain("(empty body)");
    expect(s.calls()).toBe(2);
  });
});
