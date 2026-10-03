/**
 * Time in a restaurant's own zone, without a date library.
 *
 * Everything the platform stores and computes is UTC. What a person sees and types is the
 * restaurant's wall clock (Location.timezone), so the picker for a chart period has to turn
 * "25 Sep, 2:00 PM Pacific" into an instant, and an instant back into what the wall clock said.
 * That is all this does, through Intl, with the two awkward days a year handled on purpose:
 * the spring-forward gap (a wall time that never happened) and the fall-back repeat (one that
 * happened twice).
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

export interface LocalParts {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
}

/** What the wall clock in `tz` read at the instant `ms`. */
export function zonedParts(ms: number, tz: string): LocalParts {
  const f = fieldsAt(ms, tz);
  return { y: f.y, m: f.m, d: f.d, h: f.h, mi: f.mi };
}

function fieldsAt(ms: number, tz: string) {
  const parts = formatter(tz).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  // Some engines print midnight as 24 even with h23; the remainder makes it 0 either way
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour") % 24, mi: get("minute"), s: get("second") };
}

/** How far the zone's clock is ahead of UTC at the instant `ms`, in milliseconds. */
export function tzOffsetMs(ms: number, tz: string): number {
  const f = fieldsAt(ms, tz);
  return Date.UTC(f.y, f.m - 1, f.d, f.h, f.mi, f.s) - Math.floor(ms / 1000) * 1000;
}

const sameParts = (a: LocalParts, b: LocalParts) => a.y === b.y && a.m === b.m && a.d === b.d && a.h === b.h && a.mi === b.mi;

/**
 * The instant at which the wall clock in `tz` read `p`.
 *
 * A wall time that never happened (the hour skipped when clocks go forward) moves forward by
 * the length of the gap, 2:30 becoming 3:30; one that happened twice (clocks going back) means
 * the first time round. These are the choices a calendar makes, and the ones people expect.
 */
export function zonedToUtcMs(p: LocalParts, tz: string): number {
  const wall = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi);
  const o1 = tzOffsetMs(wall, tz);
  const a = wall - o1;
  const o2 = tzOffsetMs(a, tz);
  const b = wall - o2;
  const valid = [a, b].filter((c) => sameParts(zonedParts(c, tz), p));
  return valid.length ? Math.min(...valid) : Math.max(a, b);
}

/** Midnight at the start of the day `ms` falls in, on the zone's clock. */
export function startOfZonedDay(ms: number, tz: string): number {
  const p = zonedParts(ms, tz);
  return zonedToUtcMs({ ...p, h: 0, mi: 0 }, tz);
}

/** The same wall-clock time `n` days later (or earlier), which is not always `n × 24` hours. */
export function addZonedDays(ms: number, n: number, tz: string): number {
  const p = zonedParts(ms, tz);
  const shifted = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
  return zonedToUtcMs({ y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate(), h: p.h, mi: p.mi }, tz);
}

/** "PDT", "PST", "GMT+6" — what to print beside a time so nobody has to guess the zone. */
export function tzAbbrev(ms: number, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date(ms));
  return parts.find((p) => p.type === "timeZoneName")?.value ?? tz;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-09-25T14:00" — a wall-clock time as it goes in an address or a form field. */
export function toLocalInput(ms: number, tz: string): string {
  const p = zonedParts(ms, tz);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`;
}

/** The inverse of toLocalInput; null for anything that is not a real wall-clock time. */
export function fromLocalInput(text: string, tz: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(text);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  // 31 February is not a date: it must survive a round trip through Date to count
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return zonedToUtcMs({ y, m: mo, d, h, mi }, tz);
}
