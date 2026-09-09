export type UnitStatus = "normal" | "alert" | "offline";
export type LocationStatus = UnitStatus;

export interface OpenAlertLike {
  type: "temp_out_of_range" | "offline";
}

/**
 * Unit status is derived from data, never stored:
 * open temp alert → alert; open offline alert or no reading ever → offline; otherwise normal.
 */
export function deriveUnitStatus(openAlerts: OpenAlertLike[], hasReading: boolean): UnitStatus {
  if (openAlerts.some((a) => a.type === "temp_out_of_range")) return "alert";
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
