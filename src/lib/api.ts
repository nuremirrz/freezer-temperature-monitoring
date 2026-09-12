/**
 * Client-side view of the pilot API (`src/app/api/*`).
 *
 * These types mirror what the route handlers actually return, so the UI reads
 * live database rows instead of the generated demo data in `src/data/`.
 */

export type UnitStatus = "normal" | "alert" | "offline";
export type LocationStatus = UnitStatus;
export type UnitType = "freezer" | "walk_in_freezer" | "walk_in_cooler" | "ac";
export type AlertType = "temp_out_of_range" | "offline";

export interface StatusCounts {
  normal: number;
  alert: number;
  offline: number;
}

export interface LocationSummary {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  lat: number;
  lng: number;
  timezone: string;
  status: LocationStatus;
  unitsTotal: number;
  unitCounts: StatusCounts;
}

export interface LocationsResponse {
  locations: LocationSummary[];
  summary: StatusCounts;
}

export interface LastReading {
  tempF: number;
  measuredAt: string;
}

export interface ActiveAlert {
  id: string;
  type: AlertType;
  openedAt: string;
  peakTempF: number | null;
}

export interface SensorInfo {
  id: string;
  devEui: string;
  nodeType: string | null;
  /** Hardware model from the client's inventory, e.g. "LHT65N-NE117" */
  model: string | null;
  /** Installer's label for the probe, e.g. "AC1-kitchen" */
  label: string | null;
  /** Device id in The Things Network, e.g. "bk6816-norco-ac1" */
  ttnDeviceId: string | null;
  channel: number;
  expectedIntervalSec: number;
  batteryV: number | null;
  batteryPct: number | null;
  batStatus: string | null;
  ambientTempF: number | null;
  ambientHum: number | null;
  lastRssi: number | null;
  lastSnr: number | null;
  lastSeenAt: string | null;
}

export interface UnitDetail {
  id: string;
  type: UnitType;
  name: string;
  model: string | null;
  serial: string | null;
  year: number | null;
  refrigerant: string | null;
  rangeMinF: number;
  rangeMaxF: number;
  status: UnitStatus;
  lastReading: LastReading | null;
  activeAlert: ActiveAlert | null;
  sensor: SensorInfo | null;
}

export interface GatewayInfo {
  id: string;
  ttnGatewayId: string;
  eui: string | null;
  lastSeenAt: string | null;
}

export interface LocationDetail {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  lat: number;
  lng: number;
  timezone: string;
  status: LocationStatus;
  gateways: GatewayInfo[];
  units: UnitDetail[];
}

export type ChartRange = "24h" | "7d" | "30d";

export interface ReadingPoint {
  t: string;
  tempF: number;
  min?: number;
  max?: number;
  n?: number;
}

export interface ReadingsResponse {
  unitId: string;
  range: ChartRange;
  bucketMinutes: number | null;
  rangeMinF: number;
  rangeMaxF: number;
  points: ReadingPoint[];
}

/* ------------------------------------------------------------------ */
/* Fetching                                                            */
/* ------------------------------------------------------------------ */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", cache: "no-store", signal });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new ApiError(body.message ?? `Request failed (${res.status})`, res.status);
  }
  return (await res.json()) as T;
}

export interface UnitPatch {
  rangeMinF: number;
  rangeMaxF: number;
  refrigerant?: string | null;
  year?: number | null;
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    throw new ApiError(data.message ?? `Request failed (${res.status})`, res.status);
  }
  return (await res.json()) as T;
}

export const api = {
  locations: (signal?: AbortSignal) => get<LocationsResponse>("/api/locations", signal),
  location: (id: string, signal?: AbortSignal) => get<LocationDetail>(`/api/locations/${id}`, signal),
  readings: (unitId: string, range: ChartRange, signal?: AbortSignal) =>
    get<ReadingsResponse>(`/api/units/${unitId}/readings?range=${range}`, signal),
  updateUnit: (unitId: string, body: UnitPatch) =>
    patch<{ rangeMinF: number; rangeMaxF: number; refrigerant: string | null; year: number | null }>(
      `/api/units/${unitId}`,
      body,
    ),
};

/* ------------------------------------------------------------------ */
/* Presentation helpers                                                */
/* ------------------------------------------------------------------ */

export const UNIT_TYPE_LABEL: Record<UnitType, string> = {
  freezer: "Freezer",
  walk_in_freezer: "Walk-in Freezer",
  walk_in_cooler: "Walk-in Cooler",
  ac: "AC Unit",
};

export const UNIT_IMAGE: Record<UnitType, string> = {
  freezer: "/units/freezer.svg",
  walk_in_freezer: "/units/walk-in-freezer.svg",
  walk_in_cooler: "/units/walk-in-cooler.svg",
  ac: "/units/ac.svg",
};

export const STATUS_LABEL: Record<UnitStatus, string> = {
  normal: "Normal",
  alert: "Alert",
  offline: "Offline",
};

export function shortAddress(l: { city: string; state: string }): string {
  return `${l.city}, ${l.state}`;
}

export function fullAddress(l: { address: string; city: string; state: string; zip: string }): string {
  return `${l.address}, ${l.city}, ${l.state} ${l.zip}`;
}

export function formatRange(u: { rangeMinF: number; rangeMaxF: number }): string {
  return `${u.rangeMinF}°F to ${u.rangeMaxF}°F`;
}

export function formatTemp(tempF: number): string {
  return `${Math.round(tempF)}°F`;
}

/**
 * A reading outside the unit's range is shown in red immediately, even before the
 * alert opens: an alert needs two consecutive bad readings, but the number itself
 * is already wrong and hiding that reads as a bug.
 */
export function isOutOfRange(tempF: number, u: { rangeMinF: number; rangeMaxF: number }): boolean {
  return tempF < u.rangeMinF || tempF > u.rangeMaxF;
}

/** "2h 45m", or "dd:hh:mm" once it exceeds a day. */
export function formatDuration(sinceIso: string, now: number = Date.now()): string {
  const totalMin = Math.max(0, Math.floor((now - new Date(sinceIso).getTime()) / 60_000));
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  if (days > 0) return `${p(days)}:${p(hours)}:${p(mins)}`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

/** Time of a reading, rendered in the location's timezone. */
export function formatLocalTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** How stale a reading is, e.g. "4 min ago". */
export function formatAge(iso: string, now: number = Date.now()): string {
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}
