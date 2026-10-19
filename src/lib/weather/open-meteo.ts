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

/** How long to wait before the one retry. Long enough for a blip, short enough for a loop. */
export const RETRY_AFTER_MS = 2_000;

export class OpenMeteoError extends Error {
  constructor(
    message: string,
    /** Whether asking again could plausibly give a different answer. */
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "OpenMeteoError";
  }
}

/** Enough of a body to recognise what answered, on one line. */
const snippet = (body: string): string => {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > 160 ? `${flat.slice(0, 160)}…` : flat || "(empty body)";
};

async function readJson(url: string, fetcher: typeof fetch): Promise<unknown> {
  const endpoint = url.replace(/\?.*/, "");
  let res: Response;
  let body: string;
  try {
    res = await fetcher(url, { headers: { accept: "application/json" } });
    body = await res.text();
  } catch (err) {
    // Nothing was served: DNS, TLS, or a connection cut mid-answer. Worth asking again.
    throw new OpenMeteoError(`Open-Meteo unreachable for ${endpoint}: ${err instanceof Error ? err.message : String(err)}`, true);
  }

  if (!res.ok) {
    // Their own errors are JSON with a matching status, e.g. 400 {"error":true,"reason":"…"}.
    // A 4xx is our own request being wrong and will be wrong again; 429 and 5xx are theirs.
    throw new OpenMeteoError(`Open-Meteo ${res.status} for ${endpoint}: ${snippet(body)}`, res.status === 429 || res.status >= 500);
  }

  try {
    return JSON.parse(body);
  } catch {
    // A 200 whose body is not JSON. That is not a shape Open-Meteo produces — every error of
    // theirs carries a status — so something between us and them answered instead, briefly.
    // This is the failure that has been showing up as "Unexpected token 'U'" with no clue
    // attached: the body and the content type are the clue, so they go in the message.
    throw new OpenMeteoError(
      `Open-Meteo answered ${res.status} ${res.headers.get("content-type") ?? "without a content type"} that is not JSON for ${endpoint}: ${snippet(body)}`,
      true,
    );
  }
}

/**
 * One retry, and only for failures that could go the other way.
 *
 * The sampling loop asks once a quarter of an hour, so a failure costs a whole sample and
 * leaves a hole in the chart. In October 2026 these arrived as brief blips that took every
 * restaurant at the same second — around one a day — which is exactly the shape a single
 * retry absorbs. A bad request is not retried: it would be just as bad the second time.
 */
async function getJson(url: string, fetcher: typeof fetch): Promise<unknown> {
  try {
    return await readJson(url, fetcher);
  } catch (err) {
    if (!(err instanceof OpenMeteoError) || !err.retryable) throw err;
    await new Promise((r) => setTimeout(r, RETRY_AFTER_MS));
    return readJson(url, fetcher);
  }
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
