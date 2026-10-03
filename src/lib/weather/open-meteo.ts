/**
 * Open-Meteo, the one weather source the platform uses: no key, no account, generous limits.
 * Two shapes come back — the current conditions every quarter hour (what the minute loop
 * stores), and hourly history (what a backfill stores). Timestamps are asked for as Unix
 * seconds so nothing here parses a date string.
 */

export interface WeatherSample {
  /** Unix milliseconds, Open-Meteo's own stamp for the sample */
  at: number;
  tempF: number;
  code: number | null;
}

const BASE = "https://api.open-meteo.com/v1/forecast";
const ARCHIVE = "https://archive-api.open-meteo.com/v1/archive";

async function getJson(url: string, fetcher: typeof fetch): Promise<unknown> {
  const res = await fetcher(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status} for ${url.replace(/\?.*/, "")}`);
  return res.json();
}

/** The conditions now: Open-Meteo refreshes these every 15 minutes. */
export async function fetchCurrent(lat: number, lng: number, fetcher: typeof fetch = fetch): Promise<WeatherSample> {
  const url = `${BASE}?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code&temperature_unit=fahrenheit&timeformat=unixtime&timezone=UTC`;
  const json = (await getJson(url, fetcher)) as { current?: { time?: number; temperature_2m?: number; weather_code?: number } };
  return parseCurrent(json);
}

export function parseCurrent(json: { current?: { time?: number; temperature_2m?: number; weather_code?: number } }): WeatherSample {
  const c = json.current;
  if (!c || typeof c.time !== "number" || typeof c.temperature_2m !== "number") {
    throw new Error("Open-Meteo answered without a current temperature");
  }
  return { at: c.time * 1000, tempF: c.temperature_2m, code: typeof c.weather_code === "number" ? c.weather_code : null };
}

interface HourlyJson {
  hourly?: { time?: number[]; temperature_2m?: (number | null)[]; weather_code?: (number | null)[] };
}

export function parseHourly(json: HourlyJson): WeatherSample[] {
  const h = json.hourly;
  if (!h?.time || !h.temperature_2m) return [];
  const out: WeatherSample[] = [];
  h.time.forEach((t, i) => {
    const temp = h.temperature_2m?.[i];
    if (typeof temp !== "number") return; // hours not yet measured come back as null
    const code = h.weather_code?.[i];
    out.push({ at: t * 1000, tempF: temp, code: typeof code === "number" ? code : null });
  });
  return out;
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Hourly history from `from` to now. The forecast endpoint holds the last 92 days; anything
 * older comes from the archive, which runs a few days behind — so the two overlap by a week
 * and the store's unique key keeps one row per hour.
 */
export async function fetchHistory(lat: number, lng: number, from: number, fetcher: typeof fetch = fetch): Promise<WeatherSample[]> {
  const DAY = 86_400_000;
  const now = Date.now();
  const recentDays = Math.min(92, Math.ceil((now - from) / DAY) + 1);
  const common = `latitude=${lat}&longitude=${lng}&hourly=temperature_2m,weather_code&temperature_unit=fahrenheit&timeformat=unixtime&timezone=UTC`;
  const recent = parseHourly((await getJson(`${BASE}?${common}&past_days=${recentDays}&forecast_days=1`, fetcher)) as HourlyJson)
    // forecast_days=1 is the smallest allowed; hours still ahead of us are not history
    .filter((s) => s.at <= now);
  if (now - from <= 85 * DAY) return recent.filter((s) => s.at >= from);
  const older = parseHourly(
    (await getJson(`${ARCHIVE}?${common}&start_date=${day(from)}&end_date=${day(now - 85 * DAY)}`, fetcher)) as HourlyJson,
  );
  return [...older, ...recent].filter((s) => s.at >= from);
}
