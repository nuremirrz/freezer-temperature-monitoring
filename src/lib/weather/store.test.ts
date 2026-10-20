import { describe, it, expect, beforeEach } from "vitest";
import { sampleWeather } from "./store";
import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Three per cent of the outdoor temperature was going missing, every day, for weeks.
 *
 * It looked like Open-Meteo failing, and it was not. The minute loop asked "have fifteen
 * minutes passed?" and its own period runs a shade over sixty seconds — its work, its queries.
 * So the fifteenth tick kept landing just short and the sixteenth fired instead: production's
 * own cycles were 16, 15, 15, 16, 15, 16 minutes. Sixteen minutes steps straight over a
 * quarter-hour slot, and since the row is stamped with Open-Meteo's grid time, the slot stays
 * empty. 60/15.5 = 3.87 samples an hour against a grid of 4, which is the 3.2% that the table
 * of holes had been showing all along.
 */

const SLOT = 15 * 60_000;
const START = Date.parse("2026-10-20T00:00:00Z");

/**
 * A loop tick that is never exactly a minute — the thing that caused this. The minute loop
 * does real work on every pass (the offline check queries every sensor, the weather sampling
 * makes an HTTP request per restaurant), so a "minute" costs a second or two more than one.
 * At 61 s the old rule lost 2.1% of slots a day and at 62 s it lost 4.2%; the holes actually
 * counted in production ranged from 2.1% to 4.5%, which is this, varying with the load.
 */
const TICK_MS = 62_000;

const fakeDb = (stored: Set<number>) =>
  ({
    location: { findMany: async () => [{ id: "loc1", name: "BK #1", lat: 33.9, lng: -117.5 }] },
    weatherReading: {
      createMany: async ({ data }: { data: { measuredAt: Date }[] }) => {
        let count = 0;
        for (const row of data) {
          const at = row.measuredAt.getTime();
          if (stored.has(at)) continue;
          stored.add(at);
          count++;
        }
        return { count };
      },
    },
  }) as unknown as PrismaClient;

/** Open-Meteo answers with the slot the request lands in, as it really does. */
const fetcher = (async (url: string) => {
  const now = Number(new URL(url).searchParams.get("_now"));
  const slotStart = Math.floor(now / SLOT) * SLOT;
  return new Response(
    JSON.stringify({ current: { time: slotStart / 1000, temperature_2m: 70, weather_code: 0 } }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}) as unknown as typeof fetch;

/** Runs the minute loop for `hours`, and returns which grid slots ended up in the table. */
async function runLoop(hours: number): Promise<Set<number>> {
  const stored = new Set<number>();
  const db = fakeDb(stored);
  const end = START + hours * 3_600_000;
  for (let now = START; now < end; now += TICK_MS) {
    // The fetcher needs to know "now"; the real one gets it from Open-Meteo's own clock
    const at = now;
    await sampleWeather(db, at, ((url: string) => fetcher(`${url}&_now=${at}`)) as unknown as typeof fetch);
  }
  return stored;
}

describe("how often the outdoor temperature is sampled", () => {
  beforeEach(() => {
    // The sampler remembers its last slot on globalThis, as the running process does
    (globalThis as unknown as { __qimbyWeather?: unknown }).__qimbyWeather = undefined;
  });

  it("fills every quarter-hour slot, even though the loop never ticks exactly on the minute", async () => {
    const hours = 12;
    const stored = await runLoop(hours);
    expect(stored.size).toBe(hours * 4);
  });

  it("leaves no gap anywhere in the series", async () => {
    const slots = [...(await runLoop(6))].sort((a, b) => a - b);
    const gaps = slots.slice(1).map((t, i) => t - slots[i]).filter((g) => g !== SLOT);
    expect(gaps).toEqual([]);
  });

  it("does not sample the same slot twice, however often the loop asks", async () => {
    const stored = new Set<number>();
    const db = fakeDb(stored);
    let sampled = 0;
    // Ten ticks inside one slot: the first does the work, the rest are told to wait
    for (let i = 0; i < 10; i++) {
      const at = START + i * TICK_MS;
      const r = await sampleWeather(db, at, ((url: string) => fetcher(`${url}&_now=${at}`)) as unknown as typeof fetch);
      if (r) sampled++;
    }
    expect(sampled).toBe(1);
    expect(stored.size).toBe(1);
  });

  it("would have dropped slots under the old rule, which is what this fixes", () => {
    // The old rule by arithmetic rather than by resurrecting the code: wait for a full
    // fifteen minutes to have elapsed, asked by a loop whose own tick runs over a minute.
    const oldRule = (tickMs: number) => {
      let last = START;
      const slots = new Set<number>();
      for (let now = START; now < START + 24 * 3_600_000; now += tickMs) {
        if (now - last >= SLOT) {
          slots.add(Math.floor(now / SLOT));
          last = now;
        }
      }
      return (24 * 4 - slots.size) / (24 * 4);
    };
    // The band the production table showed, day after day, for eleven days
    expect(oldRule(61_000)).toBeCloseTo(0.021, 3);
    expect(oldRule(62_000)).toBeCloseTo(0.042, 3);
  });
});
