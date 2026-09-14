/**
 * Pure alert rules — no database, no clock, so they are trivially unit-testable.
 * The service layer (service.ts) loads state, calls these, and persists the result.
 */

/**
 * How long the temperature has to stay outside the range before an alert opens.
 *
 * Set by the client (13 Sep): "такая температура должна быть минимум час". A freezer in
 * defrost, a door held open during a delivery, an AC cycling off — all of these leave the
 * range for minutes at a time and none of them is a problem. An hour of it is.
 */
export const SUSTAINED_OUT_OF_RANGE_MIN = 60;
/** Alert closes only once the reading is back inside the range by this margin. */
export const HYSTERESIS_F = 2;
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

/**
 * Back inside the range with the hysteresis margin on the side that was violated:
 * a high alert on −10…10 closes at ≤ 8°F, a low one at ≥ −8°F.
 * Directional on purpose — a symmetric 2°F band would be empty for AC (55–58).
 * The margin never exceeds the range width (or half of it when the side is unknown).
 */
export function isBackInRange(tempF: number, r: TempRange, side: AlertSide | null = null): boolean {
  if (isOutOfRange(tempF, r)) return false;
  const width = r.rangeMaxF - r.rangeMinF;
  if (side === "high") return tempF <= r.rangeMaxF - Math.min(HYSTERESIS_F, width);
  if (side === "low") return tempF >= r.rangeMinF + Math.min(HYSTERESIS_F, width);
  const h = Math.min(HYSTERESIS_F, width / 2);
  return tempF >= r.rangeMinF + h && tempF <= r.rangeMaxF - h;
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
  /** The currently open temp alert, if any */
  openAlert: { peakTempF: number | null } | null;
}

export function evaluateTempReading(e: TempEvaluation): TempDecision {
  if (e.openAlert) {
    if (isBackInRange(e.current, e, alertSide(e.openAlert.peakTempF, e))) return { action: "close" };
    const prevPeak = e.openAlert.peakTempF ?? e.current;
    return { action: "update", peakTempF: peakOf(prevPeak, e.current, e) };
  }

  if (isOutOfRange(e.current, e) && e.outOfRangeForMin >= SUSTAINED_OUT_OF_RANGE_MIN) {
    return { action: "open", peakTempF: e.runPeakTempF ?? e.current };
  }
  return { action: "none" };
}

/**
 * Offline threshold for a sensor: three missed uplinks plus a minute of slack.
 * 300 s → 960 s (16 min), 120 s → 420 s (7 min).
 */
export function offlineAfterSec(expectedIntervalSec: number = DEFAULT_EXPECTED_INTERVAL_SEC): number {
  return 3 * expectedIntervalSec + 60;
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
