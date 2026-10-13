export type UnitStatus = "normal" | "alert" | "offline";
export type LocationStatus = UnitStatus;

export interface OpenAlertLike {
  type: "temp_out_of_range" | "offline" | "not_cooling";
}

/** The alert types that mean the equipment itself is in trouble, rather than out of touch. */
const FAULTS: ReadonlySet<OpenAlertLike["type"]> = new Set(["temp_out_of_range", "not_cooling"]);

/**
 * Unit status is derived from data, never stored: an open fault (a walk-in out of range, an AC
 * that is not cooling) → alert; an open offline alert or no reading ever → offline; otherwise
 * normal. The AC substatuses stay out of this on purpose — they are shades of green and were
 * never meant for the screen.
 */
export function deriveUnitStatus(openAlerts: OpenAlertLike[], hasReading: boolean): UnitStatus {
  if (openAlerts.some((a) => FAULTS.has(a.type))) return "alert";
  if (openAlerts.some((a) => a.type === "offline")) return "offline";
  if (!hasReading) return "offline";
  return "normal";
}

/** Worst unit wins: alert > offline > normal. */
export function deriveLocationStatus(unitStatuses: UnitStatus[]): LocationStatus {
  if (unitStatuses.includes("alert")) return "alert";
  if (unitStatuses.includes("offline")) return "offline";
  return "normal";
}

export function countStatuses(statuses: UnitStatus[]): Record<UnitStatus, number> {
  const c: Record<UnitStatus, number> = { normal: 0, alert: 0, offline: 0 };
  for (const s of statuses) c[s]++;
  return c;
}
