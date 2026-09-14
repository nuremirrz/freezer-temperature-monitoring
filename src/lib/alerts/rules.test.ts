import { describe, it, expect } from "vitest";
import {
  alertRange,
  evaluateTempReading,
  isBackInRange,
  isOutOfRange,
  isSensorOffline,
  offlineAfterSec,
  canNotify,
  fullyOfflineLocations,
} from "./rules";

const FREEZER = { rangeMinF: -10, rangeMaxF: 10 };
const AC = { rangeMinF: 55, rangeMaxF: 58 };

describe("temp out of range — opening", () => {
  it("ignores a single spike: the first bad reading has no elapsed time behind it", () => {
    expect(
      evaluateTempReading({ ...FREEZER, current: 15, outOfRangeForMin: 0, runPeakTempF: 15, openAlert: null }),
    ).toEqual({ action: "none" });
  });

  it("stays quiet while the temperature has been out of range for less than an hour", () => {
    expect(
      evaluateTempReading({ ...FREEZER, current: 15, outOfRangeForMin: 40, runPeakTempF: 15, openAlert: null }),
    ).toEqual({ action: "none" });
    expect(
      evaluateTempReading({ ...FREEZER, current: 15, outOfRangeForMin: 59.9, runPeakTempF: 15, openAlert: null }),
    ).toEqual({ action: "none" });
  });

  it("opens at a full hour, keeping the worst reading of the run as peak", () => {
    expect(
      evaluateTempReading({ ...FREEZER, current: 12.1, outOfRangeForMin: 60, runPeakTempF: 15.2, openAlert: null }),
    ).toEqual({ action: "open", peakTempF: 15.2 });
  });

  it("opens for readings below the range as well", () => {
    expect(
      evaluateTempReading({ ...FREEZER, current: -12, outOfRangeForMin: 75, runPeakTempF: -13, openAlert: null }),
    ).toEqual({ action: "open", peakTempF: -13 });
  });

  it("never opens while the reading is inside the range, however long the run", () => {
    expect(
      evaluateTempReading({ ...FREEZER, current: 4, outOfRangeForMin: 180, runPeakTempF: 15, openAlert: null }),
    ).toEqual({ action: "none" });
  });

  it("falls back to the current reading when the run has no peak", () => {
    expect(
      evaluateTempReading({ ...AC, current: 61, outOfRangeForMin: 60, runPeakTempF: null, openAlert: null }),
    ).toEqual({ action: "open", peakTempF: 61 });
  });
});

describe("temp out of range — while open", () => {
  it("updates the peak when it gets worse", () => {
    expect(
      evaluateTempReading({ ...FREEZER, current: 18, outOfRangeForMin: 0, runPeakTempF: null, openAlert: { peakTempF: 15 } }),
    ).toEqual({ action: "update", peakTempF: 18 });
  });

  it("keeps the old peak when the reading improves but is still out of range", () => {
    expect(
      evaluateTempReading({ ...FREEZER, current: 12, outOfRangeForMin: 0, runPeakTempF: null, openAlert: { peakTempF: 18 } }),
    ).toEqual({ action: "update", peakTempF: 18 });
  });

  it("does not close inside the hysteresis band (9°F for a 10°F ceiling)", () => {
    expect(
      evaluateTempReading({ ...FREEZER, current: 9, outOfRangeForMin: 0, runPeakTempF: null, openAlert: { peakTempF: 18 } }),
    ).toEqual({ action: "update", peakTempF: 18 });
  });

  it("closes once back inside the range by 2°F", () => {
    expect(
      evaluateTempReading({ ...FREEZER, current: 8, outOfRangeForMin: 0, runPeakTempF: null, openAlert: { peakTempF: 18 } }),
    ).toEqual({ action: "close" });
    expect(
      evaluateTempReading({ ...FREEZER, current: -8, outOfRangeForMin: 0, runPeakTempF: null, openAlert: { peakTempF: -13 } }),
    ).toEqual({ action: "close" });
    expect(
      evaluateTempReading({ ...AC, current: 56, outOfRangeForMin: 0, runPeakTempF: null, openAlert: { peakTempF: 61 } }),
    ).toEqual({ action: "close" });
  });

  it("AC (55–58): a high alert stays open at 57 and closes at 56; a low alert closes at 57", () => {
    expect(
      evaluateTempReading({ ...AC, current: 57, outOfRangeForMin: 0, runPeakTempF: null, openAlert: { peakTempF: 61 } }),
    ).toEqual({ action: "update", peakTempF: 61 });
    expect(
      evaluateTempReading({ ...AC, current: 56, outOfRangeForMin: 0, runPeakTempF: null, openAlert: { peakTempF: 61 } }),
    ).toEqual({ action: "close" });
    expect(
      evaluateTempReading({ ...AC, current: 56, outOfRangeForMin: 0, runPeakTempF: null, openAlert: { peakTempF: 52 } }),
    ).toEqual({ action: "update", peakTempF: 52 });
    expect(
      evaluateTempReading({ ...AC, current: 57, outOfRangeForMin: 0, runPeakTempF: null, openAlert: { peakTempF: 52 } }),
    ).toEqual({ action: "close" });
  });

  it("uses the current reading as peak when the alert has none yet", () => {
    expect(
      evaluateTempReading({ ...FREEZER, current: 14, outOfRangeForMin: 0, runPeakTempF: null, openAlert: { peakTempF: null } }),
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
  it("isBackInRange applies the 2°F margin on the violated side", () => {
    expect(isBackInRange(8, FREEZER, "high")).toBe(true);
    expect(isBackInRange(8.5, FREEZER, "high")).toBe(false);
    expect(isBackInRange(-9, FREEZER, "high")).toBe(true); // far from the violated bound
    expect(isBackInRange(-8, FREEZER, "low")).toBe(true);
    expect(isBackInRange(-9, FREEZER, "low")).toBe(false);
    expect(isBackInRange(12, FREEZER, "high")).toBe(false); // still out of range
  });
  it("with an unknown side it needs the margin on both sides, clamped to half the width", () => {
    expect(isBackInRange(0, FREEZER)).toBe(true);
    expect(isBackInRange(9, FREEZER)).toBe(false);
    expect(isBackInRange(56.5, AC)).toBe(true);
    expect(isBackInRange(58, AC)).toBe(false);
  });
});

describe("offline", () => {
  const now = new Date("2026-09-09T12:00:00Z");
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

  it("threshold is three missed uplinks plus a minute", () => {
    expect(offlineAfterSec()).toBe(960); // 5-minute devices → 16 min
    expect(offlineAfterSec(300)).toBe(960);
    expect(offlineAfterSec(120)).toBe(420); // 2-minute devices → 7 min
  });

  it("5-minute device: online within 16 minutes, offline after", () => {
    expect(isSensorOffline(minutesAgo(5), now)).toBe(false);
    expect(isSensorOffline(minutesAgo(15), now)).toBe(false);
    expect(isSensorOffline(minutesAgo(16), now)).toBe(false);
    expect(isSensorOffline(minutesAgo(17), now)).toBe(true);
  });

  it("2-minute device: online within 7 minutes, offline after", () => {
    const t = offlineAfterSec(120);
    expect(isSensorOffline(minutesAgo(6), now, t)).toBe(false);
    expect(isSensorOffline(minutesAgo(7), now, t)).toBe(false);
    expect(isSensorOffline(minutesAgo(8), now, t)).toBe(true);
    expect(isSensorOffline(minutesAgo(8), now)).toBe(false); // same silence is fine for a 5-minute device
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
