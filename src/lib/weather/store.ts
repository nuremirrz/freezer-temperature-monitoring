import type { PrismaClient } from "@/generated/prisma/client";
import { fetchCurrent, fetchHistory, type WeatherSample } from "./open-meteo";

/**
 * Outdoor temperature in the database — one row per restaurant per Open-Meteo stamp.
 *
 * A sample seen twice (the loop ran before Open-Meteo moved on, a backfill overlapping the
 * live samples) is one row, by the unique key; nothing else is skipped quietly. A failure for
 * one restaurant is logged and counted, and the others still get their sample.
 */

/**
 * Open-Meteo publishes on a quarter-hour grid and stamps each sample with its own slot, so a
 * slot is what this samples once — not "fifteen minutes since last time".
 *
 * The difference is not pedantry, it is where three per cent of the outdoor temperature went.
 * The loop asks once a minute whether fifteen minutes have passed, and its own period is a
 * shade over sixty seconds — its work and its queries. So the fifteenth tick keeps landing
 * just short of the threshold and the sixteenth is the one that fires: the cycles measured in
 * production ran 16, 15, 15, 16, 15, 16 minutes, averaging 15.5. At that pace an hour holds
 * 3.87 samples against the grid's 4, which is a 3.2% shortfall — and the holes counted in the
 * table across eleven days were 2.1% to 4.5%, with the excess on the days Open-Meteo was also
 * rate-limiting us. Aligning to the slot makes the drift irrelevant: whether the loop takes
 * 15.5 minutes or 16.2, each slot still gets exactly one sample.
 */
const SLOT_MS = 15 * 60_000;
const slotOf = (ms: number) => Math.floor(ms / SLOT_MS);

const g = globalThis as unknown as { __qimbyWeather?: { lastSlot: number; lastOkAt: number | null; failures: number; lastError: string | null } };
const state = (g.__qimbyWeather ??= { lastSlot: 0, lastOkAt: null, failures: 0, lastError: null });

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
 * One current sample per open restaurant. Called every minute by the loop; does the work once
 * per quarter-hour slot, which is how often Open-Meteo has something new.
 */
export async function sampleWeather(db: PrismaClient, now = Date.now(), fetcher: typeof fetch = fetch): Promise<{ sampled: number; stored: number } | null> {
  const slot = slotOf(now);
  if (slot === state.lastSlot) return null;
  state.lastSlot = slot;
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
