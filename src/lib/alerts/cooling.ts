import { zonedParts, zonedToUtcMs, addZonedDays } from "@/lib/tz";

/**
 * Whether an air conditioner is doing its job — pure, no database, no clock of its own.
 *
 * An AC used to be judged the way a freezer is: the room leaves its band for an hour and an
 * alert opens. That reads a hot kitchen as a broken unit, which it usually is not — on a
 * 100 °F afternoon a perfectly healthy AC cannot hold 80 °F in a kitchen with the fryers on.
 * What tells the two apart is the drop across the unit: the air leaving the duct against the
 * air in the room. A unit that is cooling makes cold air whatever the room is doing; a unit
 * that is broken blows room air.
 *
 * Two counters, as the client's AC spec describes them. One runs only while no alert is open
 * and decides when to raise one; the other runs only while an alert is open and decides when
 * to let it go. They are not each other's mirror: failing is judged during opening hours with
 * a warm room, recovering is judged at any hour and at any room temperature, because a unit
 * that cools is working whatever the clock says.
 */

/** Local time the restaurant opens: closed is 00:00–07:30, so nothing is judged before it. */
export const WORK_START_MIN = 7 * 60 + 30;

/** How much colder the duct has to be than the room for the unit to count as cooling. */
export const COOLING_DROP_F = 12;

/** Duct this much hotter than the room means it is running on heat — not ours to judge. */
export const HEATING_RISE_F = 18;

/**
 * How long "not cooling" has to hold before an alert opens.
 *
 * Sanjar, 13 Oct 2026: forty-five minutes, and in minutes rather than a count of measurements.
 * A count would mean something different on every device: nine readings is forty-five minutes
 * on a five-minute sensor and three hours on a twenty-minute one, and it shrinks further
 * whenever packets are lost. The spec's own "9 замеров" is this same forty-five minutes.
 */
export const NOT_COOLING_SUSTAINED_MIN = 45;

/**
 * How long a unit has to keep cooling before its alert is let go.
 *
 * The spec's recovery counter: twelve readings, which is an hour. A broken compressor that
 * stutters back to life for one reading has not recovered, and announcing that it has is worse
 * than saying nothing — so the alert stands until the unit has cooled for a solid hour.
 */
export const RECOVERY_SUSTAINED_MIN = 60;

/**
 * How far back readings are loaded.
 *
 * The alert counter never reaches further than the morning's 07:30 reset, so sixteen and a half
 * hours is its true ceiling; the recovery counter needs only the last hour plus slack. This is
 * the one number that has to cover the longer of the two.
 */
export const RUN_LOOKBACK_MIN = 17 * 60;

/**
 * Why a unit is in the state it is in. Four of these are shades of normal, and they exist to
 * answer "was the unit even being judged at that moment?" — a question the plain green status
 * cannot. Internal: Sanjar asked on 14 Oct 2026 that none of them reach the screen.
 */
export type CoolingSubstatus =
  /** The restaurant is closed. Nothing is judged and nothing is raised. */
  | "closed"
  /** The room is below its own threshold: cool enough already, nothing to cool. */
  | "no-load"
  /** The duct is COOLING_DROP_F or more below the room — working. */
  | "cooling"
  /** The duct is far above the room: the unit is on heat, which we do not grade. */
  | "heating"
  /** No duct reading in this uplink, so there is nothing to compare. Not a verdict. */
  | "no-duct"
  /** The room is warm and the duct is not cold. This is the fault that opens an alert. */
  | "not-cooling";

/** Open from 07:30 local to midnight. The zone is the restaurant's, never the server's. */
export function isWithinWorkingHours(ms: number, timeZone: string): boolean {
  const p = zonedParts(ms, timeZone);
  return p.h * 60 + p.mi >= WORK_START_MIN;
}

/**
 * The most recent 07:30 local at or before `ms` — where the alert counter starts from.
 *
 * The spec resets it every morning: yesterday's half-finished count must not add itself to
 * today's. Built from the zone's own wall clock rather than by subtracting hours, so the
 * mornings either side of a daylight-saving change still land on 07:30.
 */
export function workDayStart(ms: number, timeZone: string): number {
  const p = zonedParts(ms, timeZone);
  const today = zonedToUtcMs({ ...p, h: 7, mi: 30 }, timeZone);
  if (ms >= today) return today;
  const y = zonedParts(addZonedDays(ms, -1, timeZone), timeZone);
  return zonedToUtcMs({ ...y, h: 7, mi: 30 }, timeZone);
}

export interface CoolingReading {
  /** The room, which is what an AC is judged by. */
  tempF: number;
  /** The duct probe. Null on an AC wired without one — then there is nothing to judge. */
  probeTempF: number | null;
  measuredAt: number;
}

export interface CoolingContext {
  /**
   * The room temperature at which the unit is expected to be working: 80 °F in a kitchen,
   * 77 °F in a dining room. This is the unit's own `rangeMaxF` — the same number the chart
   * paints green up to, because it is the same idea said once.
   */
  loadAboveF: number;
  timeZone: string;
}

/** How much colder the duct is than the room, or null when there is no duct reading. */
export function coolingDrop(r: CoolingReading): number | null {
  return r.probeTempF === null ? null : r.tempF - r.probeTempF;
}

/**
 * The verdict on one reading.
 *
 * Order matters. Closed comes first because a closed restaurant is not judged at all, whatever
 * the numbers say. A missing duct reading comes next: without it there is no verdict to give.
 * Then the load check, then the drop itself.
 *
 * "Heating" keeps the spec's `room < 80`, and that condition is the whole point of it rather
 * than an oversight. Sanjar, 20 Oct 2026, asked whether a hot duct alone was enough: no — "если
 * жара сильная, и работает другой кондер, в комнате будет 80, а с дакта например щуп
 * перегреется и будет 100". A probe baking in the ceiling of a kitchen that a neighbouring unit
 * is holding at 80 looks exactly like a unit running on heat, and excusing it would hide a unit
 * doing nothing at all. So heat is only believed when the room is genuinely cool.
 *
 * It is tested before the load check only so that the substatus names the right thing. Both
 * freeze the counter, so for a cool room the two are the same decision either way — the case
 * that changed is the warm one, which is now a failure to cool rather than an excuse.
 */
export function substatusOf(r: CoolingReading, ctx: CoolingContext): CoolingSubstatus {
  if (!isWithinWorkingHours(r.measuredAt, ctx.timeZone)) return "closed";
  const drop = coolingDrop(r);
  if (drop === null) return "no-duct";
  if (-drop >= HEATING_RISE_F && r.tempF < ctx.loadAboveF) return "heating";
  if (r.tempF < ctx.loadAboveF) return "no-load";
  if (drop >= COOLING_DROP_F) return "cooling";
  return "not-cooling";
}

export interface AlertCounter {
  /** Minutes accumulated towards NOT_COOLING_SUSTAINED_MIN. */
  minutes: number;
  /** The first reading that counted, for dating the alert. Null while the counter is at zero. */
  startedAt: number | null;
}

/**
 * The alert counter: how long this unit has been failing, in minutes, since the last reset.
 *
 * Three behaviours, and the difference between the last two is the whole point:
 *
 * - **cooling resets it to zero.** One reading showing a working unit wipes the count, so a
 *   unit that recovers and fails again starts its forty-five minutes over.
 * - **closed hours, a cool room, a unit on heat and a reading with no duct all freeze it.**
 *   They neither add to it nor wipe it. Not judging a unit is not the same as finding it
 *   healthy: a kitchen that dips under 80 °F for one reading at seven in the evening has told
 *   us nothing about the compressor, and the forty minutes of failure before it still stand.
 * - **a hole in the data adds to it.** Losing a packet or three is ordinary on this network and
 *   fifteen minutes of silence is not evidence that anything improved, so the minutes between
 *   two failing readings count whether or not anything arrived in between (Sanjar, 13 Oct 2026,
 *   shown this exact case and asked; the spec would have frozen them instead).
 *
 * The count never reaches back past the morning's 07:30, which is the spec's daily reset.
 */
export function alertCounter(readings: CoolingReading[], ctx: CoolingContext): AlertCounter {
  if (!readings.length) return { minutes: 0, startedAt: null };
  const dayStart = workDayStart(readings[readings.length - 1].measuredAt, ctx.timeZone);

  let minutes = 0;
  let startedAt: number | null = null;
  let prev: CoolingReading | null = null;
  let prevFailing = false;

  for (const r of readings) {
    if (r.measuredAt < dayStart) continue;
    const s = substatusOf(r, ctx);
    if (s === "cooling") {
      minutes = 0;
      startedAt = null;
      prevFailing = false;
    } else if (s === "not-cooling") {
      // Time counts only between two failing readings. A stretch that was frozen — the room
      // cool, the restaurant shut, no duct reading — was time we were not judging the unit,
      // and it must not arrive later as minutes of failure. So the reading that resumes a
      // count after a freeze adds nothing; it only re-anchors it.
      if (prev && prevFailing) minutes += (r.measuredAt - prev.measuredAt) / 60_000;
      // The first failing reading of the day has nothing behind it either, so one reading can
      // never open an alert however bad it looks.
      startedAt ??= r.measuredAt;
      prevFailing = true;
    } else {
      // Frozen. The next failing reading re-anchors the count instead of extending it, so the
      // frozen stretch itself can never arrive later as minutes of failure.
      prevFailing = false;
    }
    prev = r;
  }
  return { minutes, startedAt };
}

/**
 * The recovery counter: how long the unit has been cooling without interruption.
 *
 * Only the drop matters here — not the hour, not how warm the room is. A unit that makes cold
 * air at three in the morning is working, and the spec says so: "+1, если ΔT ≥ 12°F, в любое
 * время суток и при любом room". Anything less than the full drop puts it back to zero; a
 * reading with no duct temperature freezes it, because there is nothing to judge.
 *
 * This is also what keeps an alert alive overnight without a rule of its own. A unit that is
 * simply switched off makes no cold air, so the counter never builds, and the alert is still
 * there in the morning for whoever opens up (Sanjar, 14 Oct 2026).
 */
export function recoveryCounter(readings: CoolingReading[]): number {
  let minutes = 0;
  let prev: CoolingReading | null = null;
  // As in the alert counter: time counts between two readings that both show cooling, never
  // across one that does not. Otherwise the minutes a unit spent failing, or a stretch nobody
  // could judge, would be handed to it as credit towards recovering.
  let prevCooling = false;

  for (const r of readings) {
    const drop = coolingDrop(r);
    if (drop === null) {
      prevCooling = false;
    } else if (drop >= COOLING_DROP_F) {
      if (prev && prevCooling) minutes += (r.measuredAt - prev.measuredAt) / 60_000;
      prevCooling = true;
    } else {
      minutes = 0;
      prevCooling = false;
    }
    prev = r;
  }
  return minutes;
}

export type CoolingDecision =
  | { action: "open"; openedAt: number; substatus: CoolingSubstatus }
  | { action: "close"; substatus: CoolingSubstatus }
  | { action: "none"; substatus: CoolingSubstatus };

export interface CoolingEvaluation {
  /** The unit's readings up to and including the one that just arrived, oldest first. */
  readings: CoolingReading[];
  ctx: CoolingContext;
  openAlert: { openedAt: number } | null;
}

/** What to do about the reading that just arrived. */
export function evaluateCooling(e: CoolingEvaluation): CoolingDecision {
  const newest = e.readings[e.readings.length - 1];
  const substatus = newest ? substatusOf(newest, e.ctx) : "no-duct";

  if (e.openAlert) {
    const cooling = recoveryCounter(e.readings);
    return cooling >= RECOVERY_SUSTAINED_MIN ? { action: "close", substatus } : { action: "none", substatus };
  }

  const counter = alertCounter(e.readings, e.ctx);
  if (counter.minutes >= NOT_COOLING_SUSTAINED_MIN && counter.startedAt !== null) {
    return { action: "open", openedAt: counter.startedAt, substatus };
  }
  return { action: "none", substatus };
}
