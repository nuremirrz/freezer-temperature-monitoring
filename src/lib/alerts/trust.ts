import { ALERT_ERROR, type AlertErrorCode } from "./codes";

/**
 * Whether a unit's readings can be believed at all — step 1 of the client's AC algorithm.
 *
 * Silence is the obvious way to lose a sensor and the only one this platform used to notice.
 * The others are worse, because the device keeps talking: a probe pulled out of its socket
 * reports its disconnected sentinel, a failing one reports a number no kitchen could hold, and
 * a frozen one repeats yesterday's reading all day. Each of those would be fed into the cooling
 * rule as fact, and ΔT computed from a dead probe is a verdict about nothing.
 *
 * Every rule here needs two readings in a row before it will say so. One strange number is a
 * radio glitch; two is the device. That also sets the way back out, which the spec names
 * separately: two normal readings in a row and the unit is trusted again.
 *
 * Judged on air conditioners only. Walk-ins keep the rules they have until the spec's second
 * part arrives — and the stuck-sensor rule in particular would be wrong for them, since a
 * freezer holding within four degrees all day is a freezer doing its job.
 */

/** Dragino probes report this and above when nothing is wired to them. */
export const DISCONNECTED_AT_F = 150;

/** Rooms live between these. Outside is a broken sensor, not a hot kitchen. */
export const ROOM_MIN_F = 30;
export const ROOM_MAX_F = 130;

/** Supply air can be colder and hotter than a room, but not by this much. */
export const DUCT_MIN_F = 20;
export const DUCT_MAX_F = 150;

/** A device alive, reporting, and saying the same thing this long has stopped measuring. */
export const STUCK_WINDOW_H = 18;
export const STUCK_RANGE_F = 4;

/** How many readings in a row have to agree before anything is believed about the device. */
export const CONFIRM_READINGS = 2;

export interface TrustReading {
  tempF: number;
  probeTempF: number | null;
  measuredAt: number;
}

const disconnected = (r: TrustReading): boolean =>
  r.tempF >= DISCONNECTED_AT_F || (r.probeTempF !== null && r.probeTempF >= DISCONNECTED_AT_F);

const impossible = (r: TrustReading): boolean =>
  r.tempF < ROOM_MIN_F ||
  r.tempF > ROOM_MAX_F ||
  (r.probeTempF !== null && (r.probeTempF < DUCT_MIN_F || r.probeTempF > DUCT_MAX_F));

/** The spread of a series, or null when there is nothing to spread. */
const range = (values: number[]): number | null =>
  values.length ? Math.max(...values) - Math.min(...values) : null;

/**
 * Whether the device has been repeating itself for eighteen hours.
 *
 * Needs the full window to have been covered, so a unit wired this morning is not called stuck
 * for having a short history. Either series counts on its own: a duct probe can freeze while
 * the built-in air sensor beside it carries on.
 */
function stuck(readings: TrustReading[], now: number): boolean {
  const since = now - STUCK_WINDOW_H * 3_600_000;
  const inWindow = readings.filter((r) => r.measuredAt >= since);
  if (inWindow.length < 2 || inWindow[0].measuredAt > since) return false;
  const room = range(inWindow.map((r) => r.tempF));
  const duct = range(inWindow.map((r) => r.probeTempF).filter((t): t is number => t !== null));
  return (room !== null && room < STUCK_RANGE_F) || (duct !== null && duct < STUCK_RANGE_F);
}

/** Whether the last readings carry a number that could not have been measured. */
function lastTwo(readings: TrustReading[]): TrustReading[] {
  return readings.slice(-CONFIRM_READINGS);
}

/**
 * Why these readings cannot be trusted, or null when they can.
 *
 * Order is the spec's own, and it matters where two rules fit at once: a probe reading 151 °F
 * is both "disconnected" and "outside its range", and the first of those is the one worth
 * telling a technician. Silence is not judged here — nothing has arrived to judge — and comes
 * from the minute-based check instead.
 */
export function untrustedBecause(readings: TrustReading[], now: number): AlertErrorCode | null {
  const recent = lastTwo(readings);
  if (recent.length === CONFIRM_READINGS) {
    if (recent.every(disconnected)) return ALERT_ERROR.probeDisconnected;
    if (recent.every(impossible)) return ALERT_ERROR.impossibleReading;
  }
  if (stuck(readings, now)) return ALERT_ERROR.sensorStuck;
  return null;
}

/**
 * Whether the way back out is earned: two readings in a row that are simply normal.
 *
 * Deliberately not the negation of the rule above. Entering takes two bad readings and leaving
 * takes two good ones, so a device flipping between sense and nonsense stays untrusted instead
 * of flapping an alert open and shut with every uplink.
 */
export function readingsTrusted(readings: TrustReading[]): boolean {
  const recent = lastTwo(readings);
  return recent.length === CONFIRM_READINGS && recent.every((r) => !disconnected(r) && !impossible(r));
}

/** The causes judged from readings, as opposed to silence, which the minute loop owns. */
export function isReadingBasedCause(error: number | null): boolean {
  return (
    error === ALERT_ERROR.probeDisconnected ||
    error === ALERT_ERROR.impossibleReading ||
    error === ALERT_ERROR.sensorStuck
  );
}
