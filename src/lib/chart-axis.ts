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

/** Points more than `maxGapMs` apart are not joined: a line across an outage is a lie. */
export function breakGaps<T extends { t: number }>(points: T[], maxGapMs: number): (T | { t: number; gap: true })[] {
  const out: (T | { t: number; gap: true })[] = [];
  for (let i = 0; i < points.length; i++) {
    if (i > 0 && points[i].t - points[i - 1].t > maxGapMs) out.push({ t: points[i - 1].t + 1, gap: true });
    out.push(points[i]);
  }
  return out;
}

/** How far apart two neighbouring points may be before the line breaks between them. */
export function maxGapMs(bucketMinutes: number | null, intervalSec: number): number {
  // Raw: an uplink missed is noise; three in a row is an outage — the same yardstick as "Offline"
  if (bucketMinutes === null) return 3 * intervalSec * 1000 + 60_000;
  // Averaged: an empty bucket between two full ones is a hole worth showing
  return 2 * bucketMinutes * 60_000;
}

export { tzOffsetMs };
