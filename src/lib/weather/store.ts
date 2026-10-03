import type { PrismaClient } from "@/generated/prisma/client";
import { fetchCurrent, fetchHistory, type WeatherSample } from "./open-meteo";

/**
 * Outdoor temperature in the database — one row per restaurant per Open-Meteo stamp.
 *
 * A sample seen twice (the loop ran before Open-Meteo moved on, a backfill overlapping the
 * live samples) is one row, by the unique key; nothing else is skipped quietly. A failure for
 * one restaurant is logged and counted, and the others still get their sample.
 */

const SAMPLE_EVERY_MS = 15 * 60_000;

const g = globalThis as unknown as { __qimbyWeather?: { lastSampleAt: number; lastOkAt: number | null; failures: number; lastError: string | null } };
const state = (g.__qimbyWeather ??= { lastSampleAt: 0, lastOkAt: null, failures: 0, lastError: null });

export function weatherStatus() {
  return { lastOkAt: state.lastOkAt ? new Date(state.lastOkAt).toISOString() : null, failures: state.failures, lastError: state.lastError };
}

export async function insertWeather(db: PrismaClient, locationId: string, samples: WeatherSample[]): Promise<number> {
  if (!samples.length) return 0;
  const r = await db.weatherReading.createMany({
    data: samples.map((s) => ({ locationId, tempF: s.tempF, code: s.code, measuredAt: new Date(s.at) })),
    skipDuplicates: true,
  });
  return r.count;
}

type Loc = { id: string; name: string; lat: number; lng: number };

async function openLocations(db: PrismaClient): Promise<Loc[]> {
  return db.location.findMany({ where: { deactivatedAt: null }, select: { id: true, name: true, lat: true, lng: true } });
}

/**
 * One current sample per open restaurant. Called every minute by the loop; does the work
 * every quarter hour, which is how often Open-Meteo has something new.
 */
export async function sampleWeather(db: PrismaClient, now = Date.now(), fetcher: typeof fetch = fetch): Promise<{ sampled: number; stored: number } | null> {
  if (now - state.lastSampleAt < SAMPLE_EVERY_MS) return null;
  state.lastSampleAt = now;
  let sampled = 0;
  let stored = 0;
  for (const loc of await openLocations(db)) {
    try {
      const s = await fetchCurrent(loc.lat, loc.lng, fetcher);
      stored += await insertWeather(db, loc.id, [s]);
      sampled++;
      state.lastOkAt = now;
    } catch (err) {
      state.failures++;
      state.lastError = err instanceof Error ? err.message : String(err);
      console.error(`[weather] ${loc.name}: ${state.lastError}`);
    }
  }
  return { sampled, stored };
}

/** Hourly history for every open restaurant from `from` on; returns rows stored per restaurant. */
export async function backfillWeather(db: PrismaClient, from: number, fetcher: typeof fetch = fetch): Promise<{ name: string; fetched: number; stored: number }[]> {
  const out = [];
  for (const loc of await openLocations(db)) {
    const samples = await fetchHistory(loc.lat, loc.lng, from, fetcher);
    out.push({ name: loc.name, fetched: samples.length, stored: await insertWeather(db, loc.id, samples) });
  }
  return out;
}
