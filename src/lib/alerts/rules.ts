/**
 * Pure alert rules — no database, no clock, so they are trivially unit-testable.
 * The service layer (service.ts) loads state, calls these, and persists the result.
 */

/**
 * How long cold storage has to stay above its line before an alert opens.
 *
 * Two hours, from the client's card of 26 Oct 2026. It was one hour from 3 Oct, and before
 * that the written spec said two — so this returns to the original number, now with evidence
 * behind it. Replayed over three weeks of real readings the change takes the fleet from 32
 * alerts to 3: a walk-in in defrost crosses its line for twenty minutes several times a week,
 * and every one of those was a message nobody needed.
 *
 * Only cold storage is judged this way. An air conditioner has its own rule and its own
 * forty-five minutes (see cooling.ts).
 */
export const SUSTAINED_OUT_OF_RANGE_MIN = 120;

/**
 * And how long it has to stay back under the line before the alert is let go.
 *
 * The same two hours, the same card: "алерт вырубить, если температура спустилась ниже warning
 * threshold и держалась 2ч". This replaces the 2 °F margin the close used to need — two hours
 * under the line is a far stronger guard against flapping than two degrees, and keeping both
 * would have meant a reading just under the threshold did not count as under it, which is not
 * what the card asks for.
 */
export const SUSTAINED_BACK_IN_RANGE_MIN = 120;
/** Uplink interval Dragino devices ship with; each Sensor row can override it. */
export const DEFAULT_EXPECTED_INTERVAL_SEC = 300;
/** Never notify about the same alert more often than this. */
export const NOTIFY_COOLDOWN_MIN = 30;

export interface TempRange {
  rangeMinF: number;
  rangeMaxF: number;
}

/**
 * The band an alert is judged against.
 *
 * Two bands, because they answer different questions. The normal band is what the equipment
 * ought to hold and what the chart paints green; the alert band is where a person needs to be
 * woken up. A walk-in freezer is normal to 10 °F and alarming from 20 °F, and it spends most
 * of its day in between — defrosting, taking a delivery, having its door held open.
 *
 * When no alert band is set, the normal band does both jobs, which is how this behaved before.
 */
export function alertRange(u: {
  rangeMinF: number;
  rangeMaxF: number;
  alertMinF?: number | null;
  alertMaxF?: number | null;
}): TempRange {
  return { rangeMinF: u.alertMinF ?? u.rangeMinF, rangeMaxF: u.alertMaxF ?? u.rangeMaxF };
}

export function isOutOfRange(tempF: number, r: TempRange): boolean {
  return tempF < r.rangeMinF || tempF > r.rangeMaxF;
}

export type AlertSide = "high" | "low";

/** Which bound an open alert violated, derived from its peak (null when unknown). */
export function alertSide(peakTempF: number | null, r: TempRange): AlertSide | null {
  if (peakTempF === null) return null;
  if (peakTempF > r.rangeMaxF) return "high";
  if (peakTempF < r.rangeMinF) return "low";
  return null;
}

/** How far outside the range a reading is (0 when inside). */
export function deviation(tempF: number, r: TempRange): number {
  if (tempF > r.rangeMaxF) return tempF - r.rangeMaxF;
  if (tempF < r.rangeMinF) return r.rangeMinF - tempF;
  return 0;
}

/** Of two readings, the one further outside the range — that's the "peak". */
export function peakOf(a: number, b: number, r: TempRange): number {
  return deviation(b, r) > deviation(a, r) ? b : a;
}

export type TempDecision =
  | { action: "open"; peakTempF: number }
  | { action: "update"; peakTempF: number }
  | { action: "close" }
  | { action: "none" };

export interface TempEvaluation extends TempRange {
  /** The reading that just arrived */
  current: number;
  /**
   * Minutes the temperature has been continuously outside the range, counting from the first
   * bad reading of the current run up to this one. 0 while in range, and 0 on the first bad
   * reading — one spike can never open an alert, whatever the interval.
   */
  outOfRangeForMin: number;
  /** The most extreme reading of the current out-of-range run, this one included. */
  runPeakTempF: number | null;
  /**
   * Minutes the temperature has been continuously back inside the range, counting from the
   * last reading that was outside it. Only read while an alert is open.
   */
  backInRangeForMin: number;
  /** The currently open temp alert, if any */
  openAlert: { peakTempF: number | null } | null;
}

export function evaluateTempReading(e: TempEvaluation): TempDecision {
  if (e.openAlert) {
    if (!isOutOfRange(e.current, e) && e.backInRangeForMin >= SUSTAINED_BACK_IN_RANGE_MIN) return { action: "close" };
    const prevPeak = e.openAlert.peakTempF ?? e.current;
    return { action: "update", peakTempF: peakOf(prevPeak, e.current, e) };
  }

  if (isOutOfRange(e.current, e) && e.outOfRangeForMin >= SUSTAINED_OUT_OF_RANGE_MIN) {
    return { action: "open", peakTempF: e.runPeakTempF ?? e.current };
  }
  return { action: "none" };
}

/**
 * Never call a sensor silent before this, however often it is expected.
 *
 * Losing a packet or three in a row is ordinary on this radio network: measured over a day in
 * October 2026, Norco dropped one at a time, Whittier two, and San Bernardino's walk-in sensor
 * lost three in a row sixteen times. At a five-minute interval three losses are twenty minutes
 * of silence and the old threshold was sixteen, so every one of them became a false alert.
 * Thirty minutes is what the client's AC spec asks for and what the measurements support.
 */
export const MIN_OFFLINE_SEC = 30 * 60;

/**
 * Offline threshold for a sensor: three missed uplinks plus a minute of slack, but never less
 * than half an hour. 300 s → 1800 s (30 min), 1200 s → 3660 s (61 min).
 */
export function offlineAfterSec(expectedIntervalSec: number = DEFAULT_EXPECTED_INTERVAL_SEC): number {
  return Math.max(3 * expectedIntervalSec + 60, MIN_OFFLINE_SEC);
}

export function isSensorOffline(
  lastSeenAt: Date | null,
  now: Date,
  thresholdSec: number = offlineAfterSec(),
): boolean {
  if (!lastSeenAt) return true;
  return now.getTime() - lastSeenAt.getTime() > thresholdSec * 1000;
}

/** Whether a notification may be sent for an alert given when it was last notified. */
export function canNotify(
  lastNotifiedAt: Date | null,
  now: Date,
  cooldownMin: number = NOTIFY_COOLDOWN_MIN,
): boolean {
  if (!lastNotifiedAt) return true;
  return now.getTime() - lastNotifiedAt.getTime() >= cooldownMin * 60_000;
}

export interface OfflineSensorState {
  sensorId: string;
  locationId: string;
  offline: boolean;
}

/** Locations where every sensor is silent — a gateway / internet problem rather than one dead sensor. */
export function fullyOfflineLocations(sensors: OfflineSensorState[]): Set<string> {
  const byLocation = new Map<string, { total: number; offline: number }>();
  for (const s of sensors) {
    const agg = byLocation.get(s.locationId) ?? { total: 0, offline: 0 };
    agg.total++;
    if (s.offline) agg.offline++;
    byLocation.set(s.locationId, agg);
  }
  const out = new Set<string>();
  for (const [locationId, agg] of byLocation) {
    if (agg.total > 0 && agg.offline === agg.total) out.add(locationId);
  }
  return out;
}

/** Sensors heard, readings not written: after this long it is our fault, not a restaurant's. */
export const READINGS_STALLED_AFTER_MIN = 20;

export interface ReadingFreshness {
  /** Sensors have been heard recently but nothing has been written for too long. */
  stalled: boolean;
  minutesSinceUplink: number | null;
  minutesSinceReading: number | null;
}

/**
 * Whether the write path is dead while the sensors are alive.
 *
 * "Heard" and "recorded" are two different facts: an uplink marks the sensor as seen before
 * its reading is stored, so a broken insert leaves the first fresh and the second stale. On
 * 29 Sep 2026 that hid two days of lost readings behind a healthy-looking /api/health. This
 * compares the two: sensors heard within the window and no reading within it means stalled.
 * No sensors heard at all is a different problem (offline), and not this one.
 */
export function readingFreshness(
  lastUplinkAt: Date | null,
  lastReadingAt: Date | null,
  now: Date,
  afterMin: number = READINGS_STALLED_AFTER_MIN,
): ReadingFreshness {
  const minutes = (d: Date | null) => (d ? Math.max(0, Math.round((now.getTime() - d.getTime()) / 60_000)) : null);
  const minutesSinceUplink = minutes(lastUplinkAt);
  const minutesSinceReading = minutes(lastReadingAt);
  const sensorsAlive = minutesSinceUplink !== null && minutesSinceUplink <= afterMin;
  const readingsFresh = minutesSinceReading !== null && minutesSinceReading <= afterMin;
  return { stalled: sensorsAlive && !readingsFresh, minutesSinceUplink, minutesSinceReading };
}
