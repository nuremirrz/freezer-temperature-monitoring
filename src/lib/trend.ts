export type Trend = "rising" | "falling" | "stable" | "unknown";

/** Below this the two halves are the same reading twice, not a direction. */
export const TREND_MIN_DELTA_F = 1;

/** Readings on each side of the comparison. Three is enough to outvote one odd sample. */
export const TREND_WINDOW = 3;

/**
 * Median, not average, on purpose. A door held open or a defrost cycle puts one reading well
 * above its neighbours, and an average would report that single spike as a direction. The
 * middle value ignores it and still moves the moment the run itself moves.
 */
function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Which way the temperature is going, from the readings themselves.
 *
 * The last few readings are compared against the few before them. Counting readings rather
 * than minutes makes this fit every device without tuning: three uplinks is a quarter of an
 * hour on an AC and an hour on a walk-in, which is about the right horizon for each — an AC
 * cycles in minutes, a walk-in drifts over an hour.
 *
 * This used to be read off the latest value against the normal range, which made "Rising" a
 * restatement of "too warm" and left it saying Falling for a room that had been steady for
 * hours. Direction is a property of the history, so it has to be computed from the history.
 *
 * @param recentFirst readings newest first — the shape every query here returns
 */
export function trendOf(recentFirst: number[], minDeltaF = TREND_MIN_DELTA_F): Trend {
  if (recentFirst.length < TREND_WINDOW * 2) return "unknown";
  const recent = median(recentFirst.slice(0, TREND_WINDOW));
  const earlier = median(recentFirst.slice(TREND_WINDOW, TREND_WINDOW * 2));
  const delta = recent - earlier;
  if (Math.abs(delta) < minDeltaF) return "stable";
  return delta > 0 ? "rising" : "falling";
}
