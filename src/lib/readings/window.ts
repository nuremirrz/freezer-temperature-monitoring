/**
 * Which stretch of time a chart shows, and how finely.
 *
 * A preset ("1w") is a window that ends now and moves with the clock; a custom window is two
 * fixed instants the person chose. Either way the server gets instants in UTC — the browser has
 * already turned the restaurant's wall clock into them (see tz.ts) — and the answer is a window
 * plus the bucket size that keeps the series around a few hundred points.
 */

export const PRESETS = ["12h", "1d", "1w", "1m"] as const;
export type Preset = (typeof PRESETS)[number];

export const PRESET_HOURS: Record<Preset, number> = { "12h": 12, "1d": 24, "1w": 24 * 7, "1m": 24 * 30 };

const HOUR = 3_600_000;
/** The client asked for a year at most; a leap year is still a year. */
export const MAX_SPAN_MS = 366 * 24 * HOUR;
/** Shorter than this is a couple of readings, not a chart. */
export const MIN_SPAN_MS = 15 * 60_000;
/** Up to two days is drawn from raw readings: at a five-minute uplink that is 576 points. */
export const RAW_UP_TO_MS = 48 * HOUR;
/** Averaged windows aim at this many buckets or fewer. */
export const TARGET_POINTS = 600;
const BUCKET_STEPS_MIN = [5, 10, 15, 30, 60, 120, 180, 360, 720, 1440];

export interface Window {
  /** The preset, or "custom" for two chosen instants. */
  range: Preset | "custom";
  from: number;
  to: number;
  /** True when the window ends now and should pick up new readings as they arrive. */
  live: boolean;
  /** null means raw readings; otherwise each point is an average over this many minutes. */
  bucketMinutes: number | null;
}

export type WindowResult = { ok: true; window: Window } | { ok: false; error: string };

/** The bucket that keeps `spanMs` under the point target; null for a span drawn raw. */
export function bucketMinutesFor(spanMs: number): number | null {
  if (spanMs <= RAW_UP_TO_MS) return null;
  const needMin = spanMs / TARGET_POINTS / 60_000;
  return BUCKET_STEPS_MIN.find((b) => b >= needMin) ?? BUCKET_STEPS_MIN[BUCKET_STEPS_MIN.length - 1];
}

export interface WindowParams {
  range?: string | null;
  from?: string | null;
  to?: string | null;
}

function instant(text: string | null | undefined): number | null {
  if (!text) return null;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * `range=1w` or `from=…&to=…` (ISO instants) to a window. Both at once means custom: a link
 * that carries both is a link made by hand, and the two instants are the more specific wish.
 */
export function resolveWindow(params: WindowParams, now = Date.now()): WindowResult {
  const hasCustom = params.from != null || params.to != null;
  if (!hasCustom) {
    const range = (params.range ?? "1d") as Preset;
    if (!PRESET_HOURS[range]) return { ok: false, error: "range must be 12h, 1d, 1w or 1m — or give from and to" };
    const from = now - PRESET_HOURS[range] * HOUR;
    return { ok: true, window: { range, from, to: now, live: true, bucketMinutes: bucketMinutesFor(now - from) } };
  }
  const from = instant(params.from);
  const to = instant(params.to);
  if (from === null || to === null) return { ok: false, error: "from and to must both be ISO timestamps" };
  if (to <= from) return { ok: false, error: "to must be after from" };
  if (to - from < MIN_SPAN_MS) return { ok: false, error: "the period must be at least 15 minutes" };
  if (to - from > MAX_SPAN_MS) return { ok: false, error: "the period can be a year at most" };
  if (from > now) return { ok: false, error: "the period starts in the future" };
  // A window reaching past now stops at now: nothing is there yet, and the axis would be empty
  const end = Math.min(to, now);
  return { ok: true, window: { range: "custom", from, to: end, live: false, bucketMinutes: bucketMinutesFor(end - from) } };
}
