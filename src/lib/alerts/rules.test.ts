import { describe, it, expect } from "vitest";
import {
  alertRange,
  evaluateTempReading,
  isOutOfRange,
  isSensorOffline,
  offlineAfterSec,
  canNotify,
  fullyOfflineLocations,
  readingFreshness,
} from "./rules";

const FREEZER = { rangeMinF: -10, rangeMaxF: 10 };
const AC = { rangeMinF: 55, rangeMaxF: 58 };

describe("temp out of range — opening", () => {
  it("ignores a single spike: the first bad reading has no elapsed time behind it", () => {
    expect(
      evaluateTempReading({ ...FREEZER, current: 15, outOfRangeForMin: 0, runPeakTempF: 15, backInRangeForMin: 0, openAlert: null }),
    ).toEqual({ action: "none" });
  });

  it("stays quiet while the temperature has been out of range for less than two hours", () => {
    expect(
      evaluateTempReading({ ...FREEZER, current: 15, outOfRangeForMin: 40, runPeakTempF: 15, backInRangeForMin: 0, openAlert: null }),
    ).toEqual({ action: "none" });
    expect(
      evaluateTempReading({ ...FREEZER, current: 15, outOfRangeForMin: 119.9, runPeakTempF: 15, backInRangeForMin: 0, openAlert: null }),
    ).toEqual({ action: "none" });
  });

  it("opens at a full two hours, keeping the worst reading of the run as peak", () => {
    expect(
      evaluateTempReading({ ...FREEZER, current: 12.1, outOfRangeForMin: 120, runPeakTempF: 15.2, backInRangeForMin: 0, openAlert: null }),
    ).toEqual({ action: "open", peakTempF: 15.2 });
  });

  it("opens for readings below the range as well", () => {
    expect(
      evaluateTempReading({ ...FREEZER, current: -12, outOfRangeForMin: 130, runPeakTempF: -13, backInRangeForMin: 0, openAlert: null }),
    ).toEqual({ action: "open", peakTempF: -13 });
  });

  it("never opens while the reading is inside the range, however long the run", () => {
    expect(
      evaluateTempReading({ ...FREEZER, current: 4, outOfRangeForMin: 180, runPeakTempF: 15, backInRangeForMin: 0, openAlert: null }),
    ).toEqual({ action: "none" });
  });

  it("falls back to the current reading when the run has no peak", () => {
    expect(
      evaluateTempReading({ ...AC, current: 61, outOfRangeForMin: 120, runPeakTempF: null, backInRangeForMin: 0, openAlert: null }),
    ).toEqual({ action: "open", peakTempF: 61 });
  });
});

describe("temp out of range — while open", () => {
  it("updates the peak when it gets worse", () => {
    expect(
      evaluateTempReading({ ...FREEZER, current: 18, outOfRangeForMin: 0, runPeakTempF: null, backInRangeForMin: 0, openAlert: { peakTempF: 15 } }),
    ).toEqual({ action: "update", peakTempF: 18 });
  });

  it("keeps the old peak when the reading improves but is still out of range", () => {
    expect(
      evaluateTempReading({ ...FREEZER, current: 12, outOfRangeForMin: 0, runPeakTempF: null, backInRangeForMin: 0, openAlert: { peakTempF: 18 } }),
    ).toEqual({ action: "update", peakTempF: 18 });
  });

  it("does not close inside the hysteresis band (9°F for a 10°F ceiling)", () => {
    expect(
      evaluateTempReading({ ...FREEZER, current: 9, outOfRangeForMin: 0, runPeakTempF: null, backInRangeForMin: 0, openAlert: { peakTempF: 18 } }),
    ).toEqual({ action: "update", peakTempF: 18 });
  });

  it("closes once back inside the range by 2°F", () => {
    expect(
      evaluateTempReading({ ...FREEZER, current: 8, outOfRangeForMin: 0, runPeakTempF: null, backInRangeForMin: 120, openAlert: { peakTempF: 18 } }),
    ).toEqual({ action: "close" });
    expect(
      evaluateTempReading({ ...FREEZER, current: -8, outOfRangeForMin: 0, runPeakTempF: null, backInRangeForMin: 120, openAlert: { peakTempF: -13 } }),
    ).toEqual({ action: "close" });
  });

  /**
   * The close used to need the reading back inside by a 2 °F margin, and nothing else. The
   * client's card of 26 Oct 2026 replaces that with a wait: "алерт вырубить, если температура
   * спустилась ниже warning threshold и держалась 2ч". Two hours under the line is a far
   * stronger guard against flapping than two degrees, so the margin went with it.
   */
  it("will not close on a reading that is merely back inside, however far inside", () => {
    expect(
      evaluateTempReading({ ...FREEZER, current: -5, outOfRangeForMin: 0, runPeakTempF: null, backInRangeForMin: 0, openAlert: { peakTempF: 18 } }),
    ).toEqual({ action: "update", peakTempF: 18 });
    expect(
      evaluateTempReading({ ...FREEZER, current: 0, outOfRangeForMin: 0, runPeakTempF: null, backInRangeForMin: 119, openAlert: { peakTempF: 18 } }),
    ).toEqual({ action: "update", peakTempF: 18 });
  });

  it("a reading that climbs back out resets nothing but does not close either", () => {
    // Still above the line two hours later: the wait is over, the temperature is not
    expect(
      evaluateTempReading({ ...FREEZER, current: 14, outOfRangeForMin: 0, runPeakTempF: null, backInRangeForMin: 200, openAlert: { peakTempF: 18 } }),
    ).toEqual({ action: "update", peakTempF: 18 });
  });

  it("uses the current reading as peak when the alert has none yet", () => {
    expect(
      evaluateTempReading({ ...FREEZER, current: 14, outOfRangeForMin: 0, runPeakTempF: null, backInRangeForMin: 0, openAlert: { peakTempF: null } }),
    ).toEqual({ action: "update", peakTempF: 14 });
  });
});

describe("alertRange", () => {
  it("uses the alarm thresholds when they are set", () => {
    expect(alertRange({ rangeMinF: 0, rangeMaxF: 10, alertMinF: null, alertMaxF: 20 })).toEqual({
      rangeMinF: 0,
      rangeMaxF: 20,
    });
  });

  it("falls back to the normal band when they are not", () => {
    expect(alertRange({ rangeMinF: 32, rangeMaxF: 40 })).toEqual({ rangeMinF: 32, rangeMaxF: 40 });
  });

  it("keeps a walk-in freezer quiet between normal and alarming", () => {
    const freezer = { rangeMinF: 0, rangeMaxF: 10, alertMinF: null, alertMaxF: 20 };
    // 15 °F is out of the normal band — the reading shows red — but nothing is raised
    expect(isOutOfRange(15, freezer)).toBe(true);
    expect(isOutOfRange(15, alertRange(freezer))).toBe(false);
    expect(isOutOfRange(21, alertRange(freezer))).toBe(true);
  });
});

describe("range helpers", () => {
  it("isOutOfRange is inclusive at the edges", () => {
    expect(isOutOfRange(10, FREEZER)).toBe(false);
    expect(isOutOfRange(10.01, FREEZER)).toBe(true);
    expect(isOutOfRange(-10, FREEZER)).toBe(false);
  });
});

describe("offline", () => {
  const now = new Date("2026-09-09T12:00:00Z");
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

  it("is three missed uplinks plus a minute once that passes half an hour", () => {
    expect(offlineAfterSec(1200)).toBe(3660); // 20-minute devices → 61 min
    expect(offlineAfterSec(900)).toBe(2760); // 15-minute devices → 46 min
  });

  it("never falls below half an hour, however often the device is expected", () => {
    // Three losses in a row are ordinary here; at five minutes that is 20 minutes of silence,
    // and the old 16-minute threshold turned every one of them into a false alert
    expect(offlineAfterSec()).toBe(1800);
    expect(offlineAfterSec(300)).toBe(1800);
    expect(offlineAfterSec(120)).toBe(1800);
  });

  it("5-minute device: three lost packets are not an outage, half an hour is", () => {
    expect(isSensorOffline(minutesAgo(5), now)).toBe(false);
    expect(isSensorOffline(minutesAgo(20), now)).toBe(false); // the San Bernardino case
    expect(isSensorOffline(minutesAgo(30), now)).toBe(false);
    expect(isSensorOffline(minutesAgo(31), now)).toBe(true);
  });

  it("20-minute device keeps its own, longer threshold", () => {
    const t = offlineAfterSec(1200);
    expect(isSensorOffline(minutesAgo(40), now, t)).toBe(false); // one lost packet, seen at Whittier
    expect(isSensorOffline(minutesAgo(61), now, t)).toBe(false);
    expect(isSensorOffline(minutesAgo(62), now, t)).toBe(true);
  });

  it("a sensor that has never reported is offline", () => {
    expect(isSensorOffline(null, now)).toBe(true);
  });

  it("finds locations where every sensor is silent", () => {
    const set = fullyOfflineLocations([
      { sensorId: "a", locationId: "L1", offline: true },
      { sensorId: "b", locationId: "L1", offline: true },
      { sensorId: "c", locationId: "L2", offline: true },
      { sensorId: "d", locationId: "L2", offline: false },
    ]);
    expect([...set]).toEqual(["L1"]);
  });
});

describe("notification cooldown", () => {
  const now = new Date("2026-09-09T12:00:00Z");
  it("allows the first notification and blocks repeats within 30 minutes", () => {
    expect(canNotify(null, now)).toBe(true);
    expect(canNotify(new Date(now.getTime() - 10 * 60_000), now)).toBe(false);
    expect(canNotify(new Date(now.getTime() - 30 * 60_000), now)).toBe(true);
  });
});

describe("reading freshness — sensors heard, readings written?", () => {
  const now = new Date("2026-09-30T19:00:00Z");
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);

  it("is fine while both are recent", () => {
    expect(readingFreshness(ago(2), ago(3), now)).toEqual({ stalled: false, minutesSinceUplink: 2, minutesSinceReading: 3 });
  });

  it("is stalled when sensors were heard minutes ago but nothing was written for hours", () => {
    // The 29 Sep 2026 signature: lastSeenAt fresh, last reading a day old.
    expect(readingFreshness(ago(1), ago(24 * 60), now).stalled).toBe(true);
  });

  it("is stalled when sensors are heard and nothing was ever written", () => {
    expect(readingFreshness(ago(5), null, now)).toEqual({ stalled: true, minutesSinceUplink: 5, minutesSinceReading: null });
  });

  it("is not stalled when the sensors themselves are silent — that is an outage, not a write failure", () => {
    expect(readingFreshness(ago(90), ago(90), now).stalled).toBe(false);
    expect(readingFreshness(null, null, now).stalled).toBe(false);
  });

  it("gives a fresh restart the same grace as the offline rule", () => {
    expect(readingFreshness(ago(1), ago(20), now).stalled).toBe(false);
    expect(readingFreshness(ago(1), ago(21), now).stalled).toBe(true);
  });
});
