import { zonedParts } from "@/lib/tz";

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
 * From the client's AC alert spec, with the open questions answered by Sanjar on 13–14 Oct 2026.
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
 * Sanjar, 13 Oct: forty-five minutes, and in minutes rather than a count of measurements. A
 * count would mean something different on every device: three readings is fifteen minutes on
 * a five-minute sensor and an hour on a twenty-minute one, and it shrinks further whenever
 * packets are lost.
 */
export const NOT_COOLING_SUSTAINED_MIN = 45;

/**
 * How far back the run is traced. The alert opens forty-five minutes into a run, so a run can
 * never grow much past that unaided; three hours only matters if the checks themselves stopped
 * (a deploy, a server down), and then the alert is dated from the edge of this window rather
 * than from a start we never saw.
 */
export const RUN_LOOKBACK_MIN = 180;

/**
 * Why a unit is in the state it is in. Four of these are shades of normal, and they exist to
 * answer "was the unit even being judged at that moment?" — a question the plain green status
 * cannot. Internal: Sanjar asked on 14 Oct that none of them reach the screen.
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

/**
 * What ends a run of failures: the unit was seen to be fine, or was not being judged at all.
 * Closed hours belong here — we were not watching, so the count cannot carry across the night.
 */
const ENDS_RUN: ReadonlySet<CoolingSubstatus> = new Set<CoolingSubstatus>(["closed", "no-load", "cooling", "heating"]);

/**
 * What closes an alert that is already open — and closing hours are deliberately not among them.
 *
 * The two sets differ by that one entry, and the difference is Sanjar's, 14 Oct 2026: a unit
 * that broke during the day keeps its alert through the night and is still red in the morning.
 * The alternative was worse in both directions — it would have announced a recovery nobody
 * earned at midnight, and hidden a dead compressor from whoever opens up at half past seven.
 *
 * Not judging a closed restaurant and forgetting what we already found are different things.
 */
const RESOLVES: ReadonlySet<CoolingSubstatus> = new Set<CoolingSubstatus>(["no-load", "cooling", "heating"]);

export function endsRun(s: CoolingSubstatus): boolean {
  return ENDS_RUN.has(s);
}

export function resolvesAlert(s: CoolingSubstatus): boolean {
  return RESOLVES.has(s);
}

/** Open from 07:30 local to midnight. The zone is the restaurant's, never the server's. */
export function isWithinWorkingHours(ms: number, timeZone: string): boolean {
  const p = zonedParts(ms, timeZone);
  return p.h * 60 + p.mi >= WORK_START_MIN;
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

/**
 * The verdict on one reading.
 *
 * Order matters. Closed comes first because a closed restaurant is not judged at all, whatever
 * the numbers say. A missing duct reading comes next: without it there is no verdict to give.
 * Then the load check, then the drop itself. "heating" sits after "no-load" only because both
 * are shades of normal and the distinction never changes what happens — if that ever stops
 * being true, heating has to be tested first.
 */
export function substatusOf(r: CoolingReading, ctx: CoolingContext): CoolingSubstatus {
  if (!isWithinWorkingHours(r.measuredAt, ctx.timeZone)) return "closed";
  if (r.probeTempF === null) return "no-duct";
  if (r.tempF < ctx.loadAboveF) return "no-load";
  if (r.tempF - r.probeTempF >= COOLING_DROP_F) return "cooling";
  if (r.probeTempF - r.tempF >= HEATING_RISE_F) return "heating";
  return "not-cooling";
}

export interface CoolingRun {
  /** When the current unbroken run of "not cooling" began. */
  startedAt: number;
  /** Minutes from that first bad reading to the newest one. */
  minutes: number;
}

/**
 * The current unbroken run of "not cooling", read backwards from the newest reading.
 *
 * Two rules decide what breaks a run, and both are Sanjar's, 13 Oct:
 *
 * - any normal reading resets it to zero — one measurement showing a working unit is enough,
 *   so a unit that recovers and fails again starts its forty-five minutes over;
 * - a hole in the data does not. Losing a packet or three is ordinary on this network, and
 *   fifteen minutes of silence is not evidence that anything improved. Holes longer than
 *   half an hour are already somebody else's alert — the sensor is reported offline — so the
 *   only gaps that ever land inside a run are the routine ones.
 *
 * A reading with no duct probe is the same kind of nothing as a hole: skipped, neither
 * breaking the run nor counting towards it.
 */
export function notCoolingRun(readings: CoolingReading[], ctx: CoolingContext): CoolingRun | null {
  if (!readings.length) return null;
  const newest = readings[readings.length - 1];
  if (substatusOf(newest, ctx) !== "not-cooling") return null;

  let startedAt = newest.measuredAt;
  for (let i = readings.length - 2; i >= 0; i--) {
    const s = substatusOf(readings[i], ctx);
    if (endsRun(s)) break;
    if (s === "not-cooling") startedAt = readings[i].measuredAt;
  }
  return { startedAt, minutes: (newest.measuredAt - startedAt) / 60_000 };
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

/**
 * What to do about the reading that just arrived.
 *
 * An open alert closes on the first reading that shows the unit working, with no margin around
 * the twelve degrees — the forty-five minute run is the damping. A unit hovering at the boundary
 * cannot flap: every reopen costs another three quarters of an hour of continuous failure, which
 * is exactly the guard a hysteresis band would have bought, without a second invented number.
 *
 * Closing time does not close an alert; see RESOLVES above.
 */
export function evaluateCooling(e: CoolingEvaluation): CoolingDecision {
  const newest = e.readings[e.readings.length - 1];
  const substatus = newest ? substatusOf(newest, e.ctx) : "no-duct";

  if (e.openAlert) {
    return resolvesAlert(substatus) ? { action: "close", substatus } : { action: "none", substatus };
  }

  const run = notCoolingRun(e.readings, e.ctx);
  if (run && run.minutes >= NOT_COOLING_SUSTAINED_MIN) {
    return { action: "open", openedAt: run.startedAt, substatus };
  }
  return { action: "none", substatus };
}
