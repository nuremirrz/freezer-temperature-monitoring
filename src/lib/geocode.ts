/**
 * Turns a US street address into a point for the map and the weather card.
 *
 * Two free, keyless services, tried in order. The Census Bureau's geocoder knows every US
 * street address and answers with the rooftop; when it cannot match the address (a new
 * building, a typo in the street), Open-Meteo's place search gives the centre of the city, so
 * the restaurant still lands in the right town on the map rather than on nothing. `precision`
 * says which one answered, so a caller can tell the owner to check the street if it matters.
 */

export interface Address {
  address: string;
  city: string;
  state: string;
  zip: string;
}

export interface GeoPoint {
  lat: number;
  lng: number;
  precision: "address" | "city";
}

export type Geocoder = (a: Address) => Promise<GeoPoint | null>;

const TIMEOUT_MS = 6_000;

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** The Census geocoder's answer, only the parts we read. */
interface CensusResponse {
  result?: { addressMatches?: { coordinates?: { x: number; y: number } }[] };
}

/** Open-Meteo's place search, only the parts we read. */
interface PlacesResponse {
  results?: { latitude: number; longitude: number; admin1_code?: string }[];
}

export function censusPoint(body: unknown): GeoPoint | null {
  const c = (body as CensusResponse).result?.addressMatches?.[0]?.coordinates;
  if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.y)) return null;
  return { lat: c.y, lng: c.x, precision: "address" };
}

export function cityPoint(body: unknown): GeoPoint | null {
  const r = (body as PlacesResponse).results?.[0];
  if (!r || !Number.isFinite(r.latitude) || !Number.isFinite(r.longitude)) return null;
  return { lat: r.latitude, lng: r.longitude, precision: "city" };
}

export const geocode: Geocoder = async (a) => {
  const line = `${a.address}, ${a.city}, ${a.state} ${a.zip}`;
  try {
    const url =
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress" +
      `?address=${encodeURIComponent(line)}&benchmark=Public_AR_Current&format=json`;
    const p = censusPoint(await getJson(url));
    if (p) return p;
  } catch {
    // fall through to the city
  }
  try {
    const url =
      "https://geocoding-api.open-meteo.com/v1/search" +
      `?name=${encodeURIComponent(a.city)}&count=5&language=en&format=json&countryCode=US`;
    const body = (await getJson(url)) as PlacesResponse;
    // Prefer the town in the right state: there is a Paris in Texas and one in Tennessee.
    const inState = body.results?.find((r) => r.admin1_code?.toUpperCase() === a.state.toUpperCase());
    return cityPoint(inState ? { results: [inState] } : body);
  } catch {
    return null;
  }
};

/** IANA zones a US restaurant can be in, in the order a form should list them. */
export const US_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
] as const;

export type UsTimezone = (typeof US_TIMEZONES)[number];

/**
 * The zone a state is in, for the form's default. States split across zones get their larger
 * side; the owner can change it, and a wrong default only shifts chart labels, never data.
 */
const STATE_ZONE: Record<string, UsTimezone> = {
  CT: "America/New_York", DE: "America/New_York", DC: "America/New_York", FL: "America/New_York",
  GA: "America/New_York", IN: "America/New_York", KY: "America/New_York", ME: "America/New_York",
  MD: "America/New_York", MA: "America/New_York", MI: "America/New_York", NH: "America/New_York",
  NJ: "America/New_York", NY: "America/New_York", NC: "America/New_York", OH: "America/New_York",
  PA: "America/New_York", RI: "America/New_York", SC: "America/New_York", VT: "America/New_York",
  VA: "America/New_York", WV: "America/New_York",
  AL: "America/Chicago", AR: "America/Chicago", IL: "America/Chicago", IA: "America/Chicago",
  KS: "America/Chicago", LA: "America/Chicago", MN: "America/Chicago", MS: "America/Chicago",
  MO: "America/Chicago", NE: "America/Chicago", ND: "America/Chicago", OK: "America/Chicago",
  SD: "America/Chicago", TN: "America/Chicago", TX: "America/Chicago", WI: "America/Chicago",
  CO: "America/Denver", ID: "America/Denver", MT: "America/Denver", NM: "America/Denver",
  UT: "America/Denver", WY: "America/Denver",
  AZ: "America/Phoenix",
  CA: "America/Los_Angeles", NV: "America/Los_Angeles", OR: "America/Los_Angeles", WA: "America/Los_Angeles",
  AK: "America/Anchorage",
  HI: "Pacific/Honolulu",
};

export function defaultTimezone(state: string): UsTimezone {
  return STATE_ZONE[state.toUpperCase()] ?? "America/New_York";
}
