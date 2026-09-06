import { BKLocation, Unit, UnitType } from "./types";
import { mulberry32, hashString, pick, intBetween } from "./rng";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type PMStatus = "complete" | "due" | "overdue";
export type ServiceType = "PM" | "Service" | "Installation";

export const TECHNICIANS = ["Azat", "Eugenii"] as const;
export const PM_VISITS_PER_YEAR = 3;
export const PM_INTERVAL_MONTHS = 4;

export interface PMVisit {
  date: number; // epoch ms
  technician: string;
}

export interface LocationPM {
  location: BKLocation;
  year: number;
  /** Completed visits in this year, ascending (0–3) */
  visits: PMVisit[];
  /** Last completed PM; falls in the previous year when nothing is done yet */
  lastPM: number;
  /** Contract rule: next PM is due 4 months after the last one */
  nextPM: number;
  status: PMStatus;
}

export interface ServiceRecord {
  date: number;
  type: ServiceType;
  technician: string;
  notes: string;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const DAY = 24 * 60 * 60_000;

export function addMonths(ts: number, months: number): number {
  const d = new Date(ts);
  d.setMonth(d.getMonth() + months);
  return d.getTime();
}

export function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Years offered by the Maintenance Compliance year picker */
export function pmYears(): number[] {
  const y = new Date().getFullYear();
  return [y, y - 1];
}

/* ------------------------------------------------------------------ */
/* Preventive maintenance plan per location & year                     */
/* ------------------------------------------------------------------ */

interface PMPlan {
  visits: PMVisit[];
  lastPM: number;
  nextPM: number;
}

const planCache = new Map<string, PMPlan>();

function buildPlan(loc: BKLocation, year: number): PMPlan {
  const rng = mulberry32(hashString(`${loc.id}:pm:${year}`));
  const now = Date.now();
  const isCurrentYear = year >= new Date().getFullYear();

  // How many of the three contract visits have actually been done
  const r = rng();
  let target: number;
  if (isCurrentYear) {
    target = r < 0.68 ? 3 : r < 0.9 ? 2 : r < 0.97 ? 1 : 0;
  } else {
    target = r < 0.88 ? 3 : 2;
  }

  // Visit dates. Crews that keep up run a tight ~3-month cadence and are done
  // by late summer; crews that are behind stretch the gaps out.
  const gap = target === 3 ? intBetween(rng, 78, 98) : intBetween(rng, 100, 135);
  const dates: number[] = [];
  let d = new Date(year, 0, 5 + Math.floor(rng() * 32)).getTime();
  for (let i = 0; i < PM_VISITS_PER_YEAR; i++) {
    dates.push(d);
    d += (gap + intBetween(rng, -6, 6)) * DAY;
  }

  // The showcase location (#1020) is mid-cycle: 2 of 3 done, next visit due soon
  if (loc.storeNumber === 1020 && isCurrentYear) {
    target = 2;
    dates[0] = new Date(year, 0, 14).getTime();
    dates[1] = addMonths(now, -PM_INTERVAL_MONTHS) + 12 * DAY;
  }

  // A visit can't be completed before it happened
  const visits: PMVisit[] = dates
    .filter((t) => t <= now)
    .slice(0, target)
    .map((t) => ({ date: t, technician: pick(rng, TECHNICIANS) }));

  const lastPM = visits.length
    ? visits[visits.length - 1].date
    : new Date(year - 1, 10 + Math.floor(rng() * 2), 1 + Math.floor(rng() * 27)).getTime();

  return { visits, lastPM, nextPM: addMonths(lastPM, PM_INTERVAL_MONTHS) };
}

export function getLocationPM(loc: BKLocation, year: number): LocationPM {
  const key = `${loc.id}:${year}`;
  let plan = planCache.get(key);
  if (!plan) {
    plan = buildPlan(loc, year);
    planCache.set(key, plan);
  }

  // Status is derived from real dates, so "due" turns into "overdue" on its own
  const status: PMStatus =
    plan.visits.length >= PM_VISITS_PER_YEAR
      ? "complete"
      : plan.nextPM < Date.now()
        ? "overdue"
        : "due";

  return { location: loc, year, ...plan, status };
}

/* ------------------------------------------------------------------ */
/* Service history per unit                                            */
/* ------------------------------------------------------------------ */

const PM_NOTES: Record<UnitType, string[]> = {
  freezer: [
    "Cleaned condenser coil, verified door seal",
    "Checked refrigerant charge, calibrated thermostat",
    "Inspected evaporator fan, cleared drain line",
    "Tested defrost cycle, tightened door hinges",
  ],
  "walk-in-cooler": [
    "Cleaned evaporator and condenser coils, checked door closer",
    "Verified refrigerant pressure, replaced door sweep",
    "Inspected strip curtains, calibrated temperature sensor",
  ],
  "walk-in-freezer": [
    "Cleaned coils, inspected door heater and gasket",
    "Checked defrost timer, cleared drain heater line",
    "Verified refrigerant charge, calibrated sensor",
  ],
  ac: [
    "Replaced air filter, inspected blower motor",
    "Cleaned condenser coil, checked refrigerant pressure",
    "Tested thermostat, cleared condensate drain",
  ],
};

const SERVICE_NOTES: Record<"alert" | "normal" | "offline", string[]> = {
  alert: [
    "Investigated intermittent warm readings, adjusted defrost cycle",
    "Replaced door gasket after temperature drift complaints",
    "Evaporator fan motor noisy — lubricated, follow-up scheduled",
  ],
  normal: [
    "Replaced temperature sensor and recalibrated",
    "Recharged refrigerant, checked for leaks",
    "Replaced door gasket and hinge",
    "Replaced compressor start relay",
  ],
  offline: [
    "Sensor not reporting — gateway checked, replacement ordered",
    "Replaced sensor battery, signal still intermittent",
  ],
};

const historyCache = new Map<string, ServiceRecord[]>();

export function getServiceHistory(unit: Unit, loc: BKLocation): ServiceRecord[] {
  const hit = historyCache.get(unit.id);
  if (hit) return hit;

  const rng = mulberry32(hashString(`${unit.id}:svc`));
  const now = Date.now();
  const year = new Date().getFullYear();
  const records: ServiceRecord[] = [];

  // PM visits come from the location plan, so this table and the
  // Maintenance Compliance screen always tell the same story
  for (const y of [year - 1, year]) {
    for (const v of getLocationPM(loc, y).visits) {
      records.push({
        date: v.date,
        type: "PM",
        technician: v.technician,
        notes: pick(rng, PM_NOTES[unit.type]),
      });
    }
  }

  // Installation in the unit's manufacturing year
  records.push({
    date: new Date(unit.year, intBetween(rng, 1, 11), intBetween(rng, 1, 28)).getTime(),
    type: "Installation",
    technician: pick(rng, TECHNICIANS),
    notes: "Unit delivered, installed and commissioned",
  });

  // Ad-hoc service calls
  if (unit.status === "alert") {
    records.push({
      date: now - intBetween(rng, 4, 21) * DAY,
      type: "Service",
      technician: pick(rng, TECHNICIANS),
      notes: pick(rng, SERVICE_NOTES.alert),
    });
  } else if (unit.status === "offline") {
    records.push({
      date: now - intBetween(rng, 1, 6) * DAY,
      type: "Service",
      technician: pick(rng, TECHNICIANS),
      notes: pick(rng, SERVICE_NOTES.offline),
    });
  } else if (rng() < 0.4) {
    records.push({
      date: now - intBetween(rng, 40, 320) * DAY,
      type: "Service",
      technician: pick(rng, TECHNICIANS),
      notes: pick(rng, SERVICE_NOTES.normal),
    });
  }

  records.sort((a, b) => b.date - a.date);
  historyCache.set(unit.id, records);
  return records;
}
