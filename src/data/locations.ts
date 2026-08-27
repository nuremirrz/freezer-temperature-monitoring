import { BKLocation, Unit, UnitType } from "./types";
import { mulberry32, pick, intBetween, between, Rng } from "./rng";

/* ------------------------------------------------------------------ */
/* Static source lists                                                 */
/* ------------------------------------------------------------------ */

interface CityDef {
  city: string;
  zip: string;
  lat: number;
  lng: number;
  street: string;
}

// Upper / northern New Jersey
const CITIES: CityDef[] = [
  { city: "Passaic", zip: "07055", lat: 40.8568, lng: -74.1285, street: "22 Gregory Ave" },
  { city: "Newark", zip: "07102", lat: 40.7357, lng: -74.1724, street: "318 Market St" },
  { city: "Hackensack", zip: "07601", lat: 40.8859, lng: -74.0435, street: "410 Main St" },
  { city: "Elizabeth", zip: "07201", lat: 40.6639, lng: -74.2107, street: "125 Broad St" },
  { city: "Fort Lee", zip: "07024", lat: 40.8509, lng: -73.9701, street: "2160 Lemoine Ave" },
  { city: "Paterson", zip: "07501", lat: 40.9168, lng: -74.1718, street: "285 Main St" },
  { city: "Clifton", zip: "07011", lat: 40.8584, lng: -74.1638, street: "1006 Main Ave" },
  { city: "Jersey City", zip: "07302", lat: 40.7178, lng: -74.0431, street: "440 Grand St" },
  { city: "East Orange", zip: "07017", lat: 40.7673, lng: -74.2049, street: "80 Central Ave" },
  { city: "Bloomfield", zip: "07003", lat: 40.8068, lng: -74.1854, street: "1255 Broad St" },
  { city: "Kearny", zip: "07032", lat: 40.7684, lng: -74.1454, street: "175 Passaic Ave" },
  { city: "Bayonne", zip: "07002", lat: 40.6687, lng: -74.1143, street: "594 Broadway" },
  { city: "Union City", zip: "07087", lat: 40.7795, lng: -74.0238, street: "3196 Kennedy Blvd" },
  { city: "Hoboken", zip: "07030", lat: 40.744, lng: -74.0324, street: "308 Washington St" },
  { city: "Englewood", zip: "07631", lat: 40.8929, lng: -73.9726, street: "35 Nathaniel Pl" },
  { city: "Teaneck", zip: "07666", lat: 40.8976, lng: -74.016, street: "863 Cedar Ln" },
  { city: "Paramus", zip: "07652", lat: 40.9445, lng: -74.0754, street: "240 Route 17 N" },
  { city: "Garfield", zip: "07026", lat: 40.8815, lng: -74.1132, street: "34 Passaic St" },
  { city: "Wayne", zip: "07470", lat: 40.9254, lng: -74.2765, street: "1355 Willowbrook Mall" },
  { city: "Montclair", zip: "07042", lat: 40.8259, lng: -74.209, street: "590 Bloomfield Ave" },
  { city: "Irvington", zip: "07111", lat: 40.7323, lng: -74.2346, street: "1034 Springfield Ave" },
  { city: "North Bergen", zip: "07047", lat: 40.8043, lng: -74.0121, street: "7508 Bergenline Ave" },
  { city: "Secaucus", zip: "07094", lat: 40.7895, lng: -74.0565, street: "700 Plaza Dr" },
  { city: "West New York", zip: "07093", lat: 40.7879, lng: -74.0143, street: "5701 Bergenline Ave" },
  { city: "Lyndhurst", zip: "07071", lat: 40.812, lng: -74.1243, street: "425 Ridge Rd" },
];

// Unique 4-digit store numbers, multiples of 10
const STORE_NUMBERS = [
  1020, 2740, 3980, 1450, 5310, 2260, 4870, 1690, 3520, 6140, 2930, 7410, 1870,
  4230, 5560, 3090, 8620, 2480, 6710, 1340, 5980, 4460, 7150, 3810, 9240,
];

const FREEZER_MODELS = ["True T-49F", "True T-23F", "Turbo Air M3F47-2-N", "Beverage-Air VF2HC-1F"];
const COOLER_MODELS = ["True T-49", "Turbo Air M3R47-2-N", "True T-23"];
const WALKIN_COOLER_MODELS = ["Nor-Lake KLB7768-C", "Amerikooler QC080877", "Kolpak QS7-0810-CT"];
const WALKIN_FREEZER_MODELS = ["Nor-Lake KLF7768-C", "American Panel AP7X7F", "Kolpak QS7-0810-FT"];
const AC_MODELS = ["Carrier 48TC-A04", "Trane Precedent YSC060", "Lennox Landmark KGA060"];

interface UnitTemplate {
  type: UnitType;
  name: string;
  systemName: string;
  area: string;
  models: string[];
  isCooler?: boolean;
}

const UNIT_POOL: UnitTemplate[] = [
  { type: "freezer", name: "Freezer - Back", systemName: "Freezer #1 (Back)", area: "Back of House", models: FREEZER_MODELS },
  { type: "freezer", name: "Freezer - Front", systemName: "Freezer #2 (Front)", area: "Front of House", models: FREEZER_MODELS },
  { type: "freezer", name: "Reach-in Cooler", systemName: "Reach-in Cooler #1 (Kitchen)", area: "Kitchen", models: COOLER_MODELS, isCooler: true },
  { type: "freezer", name: "Reach-in Freezer", systemName: "Reach-in Freezer #1 (Kitchen)", area: "Kitchen", models: FREEZER_MODELS },
  { type: "walk-in-cooler", name: "Walk-in Cooler", systemName: "Walk-in Cooler #1 (Back)", area: "Back of House", models: WALKIN_COOLER_MODELS, isCooler: true },
  { type: "walk-in-freezer", name: "Walk-in Freezer", systemName: "Walk-in Freezer #1 (Back)", area: "Back of House", models: WALKIN_FREEZER_MODELS },
  { type: "ac", name: "AC Unit - Dining", systemName: "AC Unit #1 (Dining)", area: "Dining Area", models: AC_MODELS },
  { type: "ac", name: "AC Unit - Kitchen", systemName: "AC Unit #2 (Kitchen)", area: "Kitchen", models: AC_MODELS },
  { type: "ac", name: "AC Unit - Drive Thru", systemName: "AC Unit #3 (Drive Thru)", area: "Drive Thru", models: AC_MODELS },
];

/* ------------------------------------------------------------------ */
/* Status plan: 3 alert locations, 2 offline, 20 normal                */
/* ------------------------------------------------------------------ */

// location index -> unit names that are in alert + minutes since alert started
const ALERT_PLAN: Record<number, { unitName: string; minutesAgo: number; temp: number }[]> = {
  0: [
    { unitName: "Freezer - Back", minutesAgo: 165, temp: 15 }, // 2h 45m — matches the mockups
    { unitName: "Reach-in Cooler", minutesAgo: 72, temp: 14 },
  ],
  1: [{ unitName: "Walk-in Freezer", minutesAgo: 262, temp: 17 }],
  2: [{ unitName: "AC Unit - Kitchen", minutesAgo: 48, temp: 66 }],
};

// location index -> number of offline units
const OFFLINE_PLAN: Record<number, number> = { 3: 3, 4: 2 };

function serialFor(rng: Rng, year: number): string {
  const letters = "ABCDEFGHJKLMNPRSTUVWXYZ";
  const l = () => letters[Math.floor(rng() * letters.length)];
  const d = () => Math.floor(rng() * 10);
  return `${l()}${l()}${String(year).slice(2)}${d()}${d()}${d()}${d()}${d()}${d()}`;
}

function buildUnits(locIndex: number, locationId: string, rng: Rng): Unit[] {
  // Location #0 mirrors the mockups exactly: 8 units — 4 freezers, 3 AC, 1 walk-in
  const count = locIndex === 0 ? 8 : intBetween(rng, 6, 9);

  const templates: UnitTemplate[] = [];
  if (locIndex === 0) {
    templates.push(
      UNIT_POOL[0], UNIT_POOL[1], UNIT_POOL[2], UNIT_POOL[3], // 4 freezers
      UNIT_POOL[5],                                           // 1 walk-in
      UNIT_POOL[6], UNIT_POOL[7], UNIT_POOL[8],               // 3 AC
    );
  } else {
    // Always at least: 2 freezers, 1 walk-in, 2 AC; fill the rest from the pool
    const base = [UNIT_POOL[0], UNIT_POOL[2], pick(rng, [UNIT_POOL[4], UNIT_POOL[5]]), UNIT_POOL[6], UNIT_POOL[7]];
    const extras = UNIT_POOL.filter((t) => !base.includes(t));
    while (base.length < count && extras.length) {
      const i = Math.floor(rng() * extras.length);
      base.push(extras.splice(i, 1)[0]);
    }
    templates.push(...base.slice(0, count));
  }

  const alerts = ALERT_PLAN[locIndex] ?? [];
  const offlineCount = OFFLINE_PLAN[locIndex] ?? 0;
  const now = Date.now();

  const units = templates.map((t, i) => {
    const isAC = t.type === "ac";
    const rangeMin = isAC ? 55 : -10;
    const rangeMax = isAC ? 58 : 10;
    const year = intBetween(rng, 2015, 2023);
    const alert = alerts.find((a) => a.unitName === t.name);

    let baseTemp: number;
    if (alert) {
      baseTemp = alert.temp;
    } else if (isAC) {
      baseTemp = Math.round(between(rng, 55.5, 57.5));
    } else {
      baseTemp = Math.round(between(rng, t.isCooler ? 1 : -6, t.isCooler ? 8 : 6));
    }

    const unit: Unit = {
      id: `${locationId}-u${i + 1}`,
      locationId,
      name: t.name,
      systemName: t.systemName,
      area: t.area,
      type: t.type,
      model: pick(rng, t.models),
      serial: serialFor(rng, year),
      year,
      rangeMin,
      rangeMax,
      baseTemp,
      status: alert ? "alert" : "normal",
      alertSince: alert ? now - alert.minutesAgo * 60_000 : undefined,
    };
    return unit;
  });

  // Mark trailing (non-alert) units offline for offline locations
  if (offlineCount > 0) {
    let marked = 0;
    for (let i = units.length - 1; i >= 0 && marked < offlineCount; i--) {
      if (units[i].status === "normal") {
        units[i].status = "offline";
        marked++;
      }
    }
  }

  return units;
}

function buildLocations(): BKLocation[] {
  return CITIES.map((c, i) => {
    const rng = mulberry32(0xbeef + i * 101);
    const id = `bk-${STORE_NUMBERS[i]}`;
    return {
      id,
      name: `Burger King #${STORE_NUMBERS[i]}`,
      storeNumber: STORE_NUMBERS[i],
      street: c.street,
      city: c.city,
      state: "NJ",
      zip: c.zip,
      lat: c.lat,
      lng: c.lng,
      units: buildUnits(i, id, rng),
    };
  });
}

export const LOCATIONS: BKLocation[] = buildLocations();

export function getLocation(id: string): BKLocation | undefined {
  return LOCATIONS.find((l) => l.id === id);
}

export function getUnit(locationId: string, unitId: string): Unit | undefined {
  return getLocation(locationId)?.units.find((u) => u.id === unitId);
}
