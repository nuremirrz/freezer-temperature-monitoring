export type UnitType = "freezer" | "walk-in-cooler" | "walk-in-freezer" | "ac";
export type UnitStatus = "normal" | "alert" | "offline";
export type LocationStatus = UnitStatus;

export interface Unit {
  id: string;
  locationId: string;
  /** Short name used in tables, e.g. "Freezer - Back" */
  name: string;
  /** Name in the system, e.g. "Freezer #1 (Back)" */
  systemName: string;
  /** Area of the restaurant, e.g. "Back of House" */
  area: string;
  type: UnitType;
  model: string;
  serial: string;
  year: number;
  rangeMin: number;
  rangeMax: number;
  /** Temperature at app start; live value lives in the store */
  baseTemp: number;
  status: UnitStatus;
  /** Epoch ms when the alert started (alert units only) */
  alertSince?: number;
}

export interface BKLocation {
  id: string;
  name: string;
  storeNumber: number;
  street: string;
  city: string;
  state: string;
  zip: string;
  lat: number;
  lng: number;
  units: Unit[];
}

export function locationStatus(loc: BKLocation): LocationStatus {
  if (loc.units.some((u) => u.status === "alert")) return "alert";
  if (loc.units.some((u) => u.status === "offline")) return "offline";
  return "normal";
}

export function shortAddress(loc: BKLocation): string {
  return `${loc.city}, ${loc.state}`;
}

export function fullAddress(loc: BKLocation): string {
  return `${loc.street}, ${loc.city}, ${loc.state} ${loc.zip}`;
}

export function formatRange(u: Unit): string {
  return `${u.rangeMin}°F to ${u.rangeMax}°F`;
}

export const UNIT_TYPE_LABEL: Record<UnitType, string> = {
  freezer: "Freezer",
  "walk-in-cooler": "Walk-in Cooler",
  "walk-in-freezer": "Walk-in Freezer",
  ac: "AC Unit",
};

export const UNIT_IMAGE: Record<UnitType, string> = {
  freezer: "/units/freezer.svg",
  "walk-in-cooler": "/units/walk-in-cooler.svg",
  "walk-in-freezer": "/units/walk-in-freezer.svg",
  ac: "/units/ac.svg",
};
