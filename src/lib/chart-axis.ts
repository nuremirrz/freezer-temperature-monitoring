import { addZonedDays, startOfZonedDay, tzOffsetMs, zonedParts, zonedToUtcMs } from "./tz";

/**
 * Where the ticks go on a chart's time axis, and how to label them — on the restaurant's clock.
 *
 * Up to two days: whole local hours ("9 AM"). Up to four months: local midnights ("Sep 25").
 * Longer: the first of the month ("Sep", "Jan 2027"). A tick is where the wall clock is round,
 * not where UTC is, so the labels read 12 AM, 6 AM, 12 PM across a clocks change as well.
 */

export type TickMode = "hour" | "day" | "month";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface Ticks {
  mode: TickMode;
  values: number[];
}

export function tickMode(spanMs: number): TickMode {
  if (spanMs <= 2 * DAY) return "hour";
  if (spanMs <= 123 * DAY) return "day";
  return "month";
}

const smallestStep = (steps: number[], count: number, target: number) =>
  steps.find((s) => count / s <= target) ?? steps[steps.length - 1];

/** `dense` asks for more ticks — an AC chart, which is read to the hour. */
export function axisTicks(from: number, to: number, tz: string, dense = false): Ticks {
  const span = to - from;
  const mode = tickMode(span);
  const values: number[] = [];

  if (mode === "hour") {
    const step = smallestStep([1, 2, 3, 4, 6, 12], span / HOUR, dense ? 14 : 8);
    // Walk the local hours: start from the local midnight before `from`, which keeps the ticks
    // on 12 AM / 6 AM / 12 PM rather than on hours offset from UTC
    const dayStart = startOfZonedDay(from, tz);
    for (let t = dayStart; t <= to + DAY; t += HOUR) {
      const p = zonedParts(t, tz);
      if (p.h % step === 0 && p.mi === 0 && t >= from && t <= to) values.push(t);
      // The spring gap skips an hour; walking by UTC hours still visits every local hour once
    }
    return { mode, values };
  }

  if (mode === "day") {
    const step = smallestStep([1, 2, 3, 7, 14], span / DAY, 10);
    let t = startOfZonedDay(from, tz);
    if (t < from) t = addZonedDays(t, 1, tz);
    for (; t <= to; t = addZonedDays(t, step, tz)) values.push(t);
    return { mode, values };
  }

  const months = span / (30 * DAY);
  const step = smallestStep([1, 2, 3], months, 13);
  const p = zonedParts(from, tz);
  let t = zonedToUtcMs({ y: p.y, m: p.m, d: 1, h: 0, mi: 0 }, tz);
  if (t < from) t = nextMonth(t, 1, tz);
  for (; t <= to; t = nextMonth(t, step, tz)) values.push(t);
  return { mode, values };
}

function nextMonth(t: number, n: number, tz: string): number {
  const p = zonedParts(t, tz);
  const m0 = p.m - 1 + n;
  return zonedToUtcMs({ y: p.y + Math.floor(m0 / 12), m: (m0 % 12) + 1, d: 1, h: 0, mi: 0 }, tz);
}

export function tickLabel(mode: TickMode, t: number, tz: string): string {
  const d = new Date(t);
  if (mode === "hour") return d.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", hour12: true });
  if (mode === "day") return d.toLocaleDateString("en-US", { timeZone: tz, month: "short", day: "numeric" });
  const p = zonedParts(t, tz);
  return p.m === 1
    ? d.toLocaleDateString("en-US", { timeZone: tz, month: "short", year: "numeric" })
    : d.toLocaleDateString("en-US", { timeZone: tz, month: "short" });
}

/** "Sep 25, 2:00 PM – Sep 26, 2:00 PM PDT": a window as the heading above a chart says it. */
export function windowLabel(from: number, to: number, tz: string): string {
  const sameDay = startOfZonedDay(from, tz) === startOfZonedDay(to, tz);
  const sameYear = zonedParts(from, tz).y === zonedParts(to, tz).y;
  const date = (ms: number) =>
    new Date(ms).toLocaleDateString("en-US", { timeZone: tz, month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
  const time = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  const start = `${date(from)}, ${time(from)}`;
  const end = sameDay ? time(to) : `${date(to)}, ${time(to)}`;
  return `${start} – ${end}`;
}

/**
 * A coarser series read at the moments of a finer one — the air outside at the moments the unit
 * reported.
 *
 * Recharts pairs a tooltip with a point by its position in the array, not by its time, so a
 * second series drawn from its own array lines up by accident at best: a day of five-minute
 * readings beside a day of hourly weather showed 4 PM's air against 4 AM's readings. One array
 * and one set of timestamps is the only arrangement that cannot drift.
 *
 * Between two samples the value is read along the line between them, which is honest for air an
 * hour apart at worst. Across a longer gap than `maxGapMs`, or beyond the samples altogether,
 * there is no value rather than a guess, and the line breaks there.
 */
export function sampleAt(times: number[], samples: { t: number; v: number }[], maxGapMs: number): (number | null)[] {
  const out: (number | null)[] = [];
  let i = 0;
  for (const t of times) {
    while (i + 1 < samples.length && samples[i + 1].t <= t) i++;
    const a = samples[i];
    const b = samples[i + 1];
    if (!a || t < a.t) out.push(null);
    else if (t === a.t) out.push(a.v);
    else if (!b || b.t - a.t > maxGapMs) out.push(null);
    else out.push(Math.round((a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t)) * 10) / 10);
  }
  return out;
}

/** Points more than `maxGapMs` apart are not joined: a line across an outage is a lie. */
export function breakGaps<T extends { t: number }>(points: T[], maxGapMs: number): (T | { t: number; gap: true })[] {
  const out: (T | { t: number; gap: true })[] = [];
  for (let i = 0; i < points.length; i++) {
    if (i > 0 && points[i].t - points[i - 1].t > maxGapMs) out.push({ t: points[i - 1].t + 1, gap: true });
    out.push(points[i]);
  }
  return out;
}

/** Enough points that the middle gap means something rather than describing an accident. */
const ENOUGH_FOR_MEDIAN = 6;

/**
 * How far apart the points in this series usually are, as the series itself shows it; null
 * when there are too few to tell.
 */
export function medianGapMs(times: number[]): number | null {
  if (times.length < ENOUGH_FOR_MEDIAN) return null;
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
  gaps.sort((a, b) => a - b);
  return gaps[gaps.length >> 1];
}

/**
 * How far apart two neighbouring points may be before the line breaks between them.
 *
 * Measured from how the device actually reports (`observedGapMs`) rather than from the interval
 * recorded against it, because that recording goes out of date and the chart must not. On
 * 10 Oct 2026 San Bernardino's walk-in sensor moved from a five-minute step to a twenty-minute
 * one while the database still said five: every pair of points was then "a gap", every segment
 * broke, and with no dots drawn the chart went blank while the readings were arriving fine.
 */
export function maxGapMs(bucketMinutes: number | null, intervalSec: number, observedGapMs: number | null = null): number {
  // Averaged: an empty bucket between two full ones is a hole worth showing
  if (bucketMinutes !== null) return 2 * bucketMinutes * 60_000;
  // Raw: one uplink missed is noise, three in a row is an outage — the yardstick "Offline" uses
  return 3 * (observedGapMs ?? intervalSec * 1000) + 60_000;
}

export { tzOffsetMs };
