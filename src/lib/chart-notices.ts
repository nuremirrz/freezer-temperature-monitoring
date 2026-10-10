/**
 * What the chart should say about itself.
 *
 * A chart that is empty, or ends early, or is drawn from points that arrive at a different pace
 * than we expect, used to show nothing and explain nothing: on 10 Oct 2026 San Bernardino's
 * walk-in chart went blank for a day and the only way to learn why was to read the database.
 * These checks turn each of those into a sentence on the screen. The line is still drawn
 * wherever there are points to draw — the words are for what the line cannot say.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;

export type NoticeKind = "empty" | "ends-early" | "pace" | "gaps" | "starts-late";

export interface ChartNotice {
  kind: NoticeKind;
  text: string;
}

export interface NoticeInput {
  /** Reading timestamps inside the window, ascending */
  times: number[];
  from: number;
  to: number;
  /** True when the window ends now and moves with the clock */
  live: boolean;
  /** null for a raw series, otherwise the averaging bucket */
  bucketMinutes: number | null;
  /** How often the device is recorded as reporting */
  intervalSec: number;
  /** The step the series actually keeps, or null when there are too few points to tell */
  observedGapMs: number | null;
  /** How far apart two points may be before the line breaks between them */
  maxGapMs: number;
  /** The oldest reading this unit has, whatever window is shown; null if it has none */
  firstReadingAt: number | null;
  timeZone: string;
  now: number;
}

/** "42 min", "3 h", "2 d" — coarse on purpose, this is a notice and not a measurement. */
function duration(ms: number): string {
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MIN))} min`;
  if (ms < 48 * HOUR) return `${Math.round(ms / HOUR)} h`;
  return `${Math.round(ms / (24 * HOUR))} d`;
}

/** A reporting cadence, which reads better in whole units than as a duration. */
function cadence(ms: number): string {
  return ms % HOUR === 0 && ms >= HOUR ? `${ms / HOUR} h` : `${Math.round(ms / MIN)} min`;
}

const at = (ms: number, tz: string) =>
  new Date(ms).toLocaleString("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const day = (ms: number, tz: string, sameYearAs: number) => {
  const year = (t: number) => new Date(t).toLocaleDateString("en-US", { timeZone: tz, year: "numeric" });
  const opts: Intl.DateTimeFormatOptions = { timeZone: tz, month: "short", day: "numeric" };
  if (year(ms) !== year(sameYearAs)) opts.year = "numeric";
  return new Date(ms).toLocaleDateString("en-US", opts);
};

/** How far the real pace may drift from the recorded one before it is worth saying. */
const PACE_DRIFT = 1.5;

/**
 * The notices this window earns, most useful first. The caller decides how many to show;
 * two is usually enough before a chart turns into a paragraph.
 */
export function chartNotices(i: NoticeInput): ChartNotice[] {
  const out: ChartNotice[] = [];
  const n = i.times.length;

  if (n === 0) {
    // Nothing here is different from nothing at all: say which it is
    if (i.firstReadingAt !== null && i.firstReadingAt > i.to) {
      out.push({ kind: "starts-late", text: `This unit's first reading is ${day(i.firstReadingAt, i.timeZone, i.to)}` });
    } else {
      out.push({ kind: "empty", text: "No readings in this period" });
    }
    return out;
  }

  const first = i.times[0];
  const last = i.times[n - 1];

  // The series stops well before the window does — the sensor fell silent, the period is not empty
  if (i.to - last > i.maxGapMs) {
    out.push({
      kind: "ends-early",
      text: i.live ? `Last reading ${duration(i.now - last)} ago` : `Last reading ${at(last, i.timeZone)}`,
    });
  }

  // The pace on the wire is not the pace on record. This is what emptied the chart in October:
  // the device had moved to twenty minutes and the record still said five.
  if (i.bucketMinutes === null && i.observedGapMs !== null) {
    const recorded = i.intervalSec * 1000;
    const drift = i.observedGapMs / recorded;
    if (drift >= PACE_DRIFT || drift <= 1 / PACE_DRIFT) {
      out.push({
        kind: "pace",
        text: `This sensor reports every ${cadence(i.observedGapMs)}, and is set to ${cadence(recorded)}`,
      });
    }
  }

  // Holes inside the window, counted because each one is an alert's worth of silence
  const dropouts: number[] = [];
  for (let k = 1; k < n; k++) {
    const gap = i.times[k] - i.times[k - 1];
    if (gap > i.maxGapMs) dropouts.push(gap);
  }
  if (dropouts.length) {
    const worst = duration(Math.max(...dropouts));
    out.push({
      kind: "gaps",
      text:
        dropouts.length === 1
          ? `The link dropped once, for ${worst}`
          : `The link dropped ${dropouts.length} times, the longest for ${worst}`,
    });
  }

  // The left of the chart is empty because nothing older exists, not because anything broke
  if (i.firstReadingAt !== null && i.firstReadingAt > i.from && first - i.from > i.maxGapMs) {
    out.push({ kind: "starts-late", text: `This unit's first reading is ${day(i.firstReadingAt, i.timeZone, i.to)}` });
  }

  return out;
}
