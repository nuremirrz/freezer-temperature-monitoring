import { runOfflineCheck } from "./service";
import { watchReadingFreshness } from "./freshness";
import { prisma } from "@/lib/db";
import { sampleWeather } from "@/lib/weather/store";

const INTERVAL_MS = 60_000;
const g = globalThis as unknown as { __qimbyOfflineLoop?: NodeJS.Timeout };

/** Starts the minute-based offline check once per process (idempotent across HMR). */
export function startOfflineCheckLoop(): void {
  if (g.__qimbyOfflineLoop) return;
  if (!process.env.DATABASE_URL) {
    console.warn("[offline-check] DATABASE_URL not set — loop not started");
    return;
  }

  const tick = async () => {
    try {
      const r = await runOfflineCheck();
      if (r.opened || r.resolved) {
        console.log(`[offline-check] opened=${r.opened} resolved=${r.resolved} sensors=${r.checkedSensors}`);
      }
    } catch (err) {
      console.error("[offline-check] failed:", err instanceof Error ? err.message : err);
    }
    try {
      await watchReadingFreshness();
    } catch (err) {
      console.error("[readings-watch] failed:", err instanceof Error ? err.message : err);
    }
    try {
      // Every quarter hour in practice; the function itself keeps the pace
      await sampleWeather(prisma);
    } catch (err) {
      console.error("[weather] failed:", err instanceof Error ? err.message : err);
    }
  };

  g.__qimbyOfflineLoop = setInterval(tick, INTERVAL_MS);
  g.__qimbyOfflineLoop.unref?.();
  // First pass shortly after boot so a restart doesn't hide a dead sensor for a minute
  setTimeout(tick, 5_000).unref?.();
  console.log("[offline-check] loop started (every 60s)");
}
