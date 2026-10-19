import { describe, it, expect } from "vitest";
import {
  untrustedBecause,
  readingsTrusted,
  isReadingBasedCause,
  DISCONNECTED_AT_F,
  STUCK_WINDOW_H,
  STUCK_RANGE_F,
  type TrustReading,
} from "./trust";
import { ALERT_ERROR } from "./codes";

const NOW = Date.parse("2026-10-20T20:00:00Z");
const MIN = 60_000;
const ago = (minutes: number) => NOW - minutes * MIN;

/** `count` readings ending now, `everyMin` apart, oldest first. */
const series = (count: number, everyMin: number, r: Omit<TrustReading, "measuredAt">): TrustReading[] =>
  Array.from({ length: count }, (_, i) => ({ ...r, measuredAt: ago((count - 1 - i) * everyMin) }));

const OK = { tempF: 84, probeTempF: 68 };

describe("a probe that is not connected to anything", () => {
  const DEAD = { tempF: 84, probeTempF: DISCONNECTED_AT_F };

  it("is recognised after two readings in a row, not one", () => {
    expect(untrustedBecause([...series(4, 5, OK), { ...DEAD, measuredAt: NOW }], NOW)).toBeNull();
    expect(untrustedBecause([...series(3, 5, OK), { ...DEAD, measuredAt: ago(5) }, { ...DEAD, measuredAt: NOW }], NOW)).toBe(
      ALERT_ERROR.probeDisconnected,
    );
  });

  it("is recognised on the room sensor too, not only the duct", () => {
    const room = { tempF: 199, probeTempF: 68 };
    expect(untrustedBecause(series(2, 5, room), NOW)).toBe(ALERT_ERROR.probeDisconnected);
  });

  it("wins over the impossible-value rule, which also fits", () => {
    // 199 °F is both a disconnected probe and a number no room holds; the first is the useful one
    expect(untrustedBecause(series(2, 5, { tempF: 199, probeTempF: 199 }), NOW)).toBe(ALERT_ERROR.probeDisconnected);
  });
});

describe("a number that could not have been measured", () => {
  it("is recognised below a room's floor and above its ceiling", () => {
    expect(untrustedBecause(series(2, 5, { tempF: 12, probeTempF: 68 }), NOW)).toBe(ALERT_ERROR.impossibleReading);
    expect(untrustedBecause(series(2, 5, { tempF: 140, probeTempF: 68 }), NOW)).toBe(ALERT_ERROR.impossibleReading);
  });

  it("is recognised on the duct, which is allowed to be colder than a room", () => {
    expect(untrustedBecause(series(2, 5, { tempF: 84, probeTempF: 10 }), NOW)).toBe(ALERT_ERROR.impossibleReading);
    // 40 °F from a duct is simply a unit doing its job
    expect(untrustedBecause(series(2, 5, { tempF: 84, probeTempF: 40 }), NOW)).toBeNull();
  });

  it("leaves a hot kitchen alone", () => {
    expect(untrustedBecause(series(4, 5, { tempF: 99, probeTempF: 97 }), NOW)).toBeNull();
  });
});

describe("a device that has stopped measuring", () => {
  it("is recognised once a full eighteen hours have gone by without the numbers moving", () => {
    const flat = series(40, (STUCK_WINDOW_H * 60) / 39, { tempF: 72.5, probeTempF: 71.0 });
    expect(untrustedBecause(flat, NOW)).toBe(ALERT_ERROR.sensorStuck);
  });

  it("is not claimed before there is eighteen hours of history to claim it from", () => {
    // A unit wired this morning has not had time to be stuck
    expect(untrustedBecause(series(20, 10, { tempF: 72.5, probeTempF: 71.0 }), NOW)).toBeNull();
  });

  it("leaves a device alone whose readings actually move", () => {
    const moving = series(40, (STUCK_WINDOW_H * 60) / 39, OK).map((r, i) => ({
      ...r,
      tempF: 70 + (i % 9),
      probeTempF: 55 + (i % 9),
    }));
    expect(untrustedBecause(moving, NOW)).toBeNull();
  });

  it("catches a frozen duct probe beside a room sensor that is still alive", () => {
    const step = (STUCK_WINDOW_H * 60) / 39;
    const halfDead = series(40, step, OK).map((r, i) => ({ ...r, tempF: 70 + (i % 9), probeTempF: 68 }));
    expect(untrustedBecause(halfDead, NOW)).toBe(ALERT_ERROR.sensorStuck);
  });

  it("puts the boundary at four degrees of movement", () => {
    const step = (STUCK_WINDOW_H * 60) / 39;
    const spread = (by: number) => series(40, step, OK).map((r, i) => ({ ...r, tempF: 70 + (i % 2 ? by : 0), probeTempF: null }));
    expect(untrustedBecause(spread(STUCK_RANGE_F - 0.1), NOW)).toBe(ALERT_ERROR.sensorStuck);
    expect(untrustedBecause(spread(STUCK_RANGE_F), NOW)).toBeNull();
  });
});

describe("the way back out", () => {
  it("takes two normal readings in a row, not one", () => {
    const bad = { tempF: 199, probeTempF: 199 };
    expect(readingsTrusted([...series(2, 5, bad), { ...OK, measuredAt: NOW }])).toBe(false);
    expect(readingsTrusted([{ ...bad, measuredAt: ago(10) }, { ...OK, measuredAt: ago(5) }, { ...OK, measuredAt: NOW }])).toBe(true);
  });

  it("is not simply the opposite of the rule that got us here", () => {
    // One bad then one good: not two bad, so nothing opens — and not two good, so nothing closes
    const mixed = [{ tempF: 199, probeTempF: 199, measuredAt: ago(5) }, { ...OK, measuredAt: NOW }];
    expect(untrustedBecause(mixed, NOW)).toBeNull();
    expect(readingsTrusted(mixed)).toBe(false);
  });

  it("needs two readings to exist at all", () => {
    expect(readingsTrusted([{ ...OK, measuredAt: NOW }])).toBe(false);
    expect(readingsTrusted([])).toBe(false);
  });
});

describe("which causes come from readings", () => {
  it("counts the three judged from numbers, and not silence", () => {
    expect([21, 41, 51].map(isReadingBasedCause)).toEqual([true, true, true]);
    expect(isReadingBasedCause(ALERT_ERROR.noData)).toBe(false);
    expect(isReadingBasedCause(null)).toBe(false);
  });
});
