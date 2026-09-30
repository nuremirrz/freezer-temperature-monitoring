import { prisma } from "@/lib/db";
import { getNotifier } from "@/lib/notify";
import { readingFreshness, READINGS_STALLED_AFTER_MIN, type ReadingFreshness } from "./rules";

/**
 * Is anything being written? The one question /api/health used to skip.
 *
 * The newest reading is found by id, not by time: ids are handed out in insertion order and
 * the primary key answers "the last row" in one index step, where "the latest measuredAt"
 * would scan. It is also the more honest question — the row that was written last, whatever
 * its timestamp says.
 */
export async function currentFreshness(now: Date = new Date()): Promise<ReadingFreshness & { lastUplinkAt: Date | null; lastReadingAt: Date | null }> {
  const [sensors, latest] = await Promise.all([
    prisma.sensor.aggregate({ _max: { lastSeenAt: true } }),
    prisma.reading.findFirst({ orderBy: { id: "desc" }, select: { measuredAt: true } }),
  ]);
  const lastUplinkAt = sensors._max.lastSeenAt;
  const lastReadingAt = latest?.measuredAt ?? null;
  return { ...readingFreshness(lastUplinkAt, lastReadingAt, now), lastUplinkAt, lastReadingAt };
}

/** Say it again while it lasts, but not every minute. */
const REPEAT_MS = 6 * 60 * 60_000;

const g = globalThis as unknown as { __qimbyReadingsWatch?: { stalledSince: Date | null; lastSaidAt: number } };
const state = (g.__qimbyReadingsWatch ??= { stalledSince: null, lastSaidAt: 0 });

/**
 * Run from the minute loop: announces the moment readings stop being written while the
 * sensors are still talking, repeats every six hours while it lasts, and announces recovery.
 * The offline check cannot see this — it watches the sensors, and the sensors are fine.
 */
export async function watchReadingFreshness(now: Date = new Date()): Promise<void> {
  const f = await currentFreshness(now);
  const url = process.env.APP_URL ? `\n${process.env.APP_URL.replace(/\/+$/, "")}/api/health` : "";

  if (f.stalled) {
    const first = state.stalledSince === null;
    if (first) state.stalledSince = now;
    if (first || now.getTime() - state.lastSaidAt >= REPEAT_MS) {
      const since = f.minutesSinceReading === null ? "никогда не записывались" : `не записываются уже ${formatMin(f.minutesSinceReading)}`;
      await say(`🟠 Qimby: датчики на связи (последний пакет ${formatMin(f.minutesSinceUplink ?? 0)} назад), а показания ${since}. Это наша сторона, не ресторан — проверь базу: npm run db:sequences${url}`);
      state.lastSaidAt = now.getTime();
    }
    return;
  }

  if (state.stalledSince !== null) {
    const lasted = Math.round((now.getTime() - state.stalledSince.getTime()) / 60_000);
    state.stalledSince = null;
    state.lastSaidAt = 0;
    await say(`🟢 Qimby: показания снова записываются. Простой записи длился ${formatMin(lasted)}${url}`);
  }
}

function formatMin(min: number): string {
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  const d = Math.floor(h / 24);
  if (d >= 1) return `${d} д ${h % 24} ч`;
  return `${h} ч ${min % 60} мин`;
}

async function say(text: string): Promise<void> {
  try {
    await getNotifier().send(text);
  } catch (err) {
    console.error("[readings-watch] notify failed:", err instanceof Error ? err.message : err);
    console.log(`[readings-watch] (unsent) ${text}`);
  }
}

export { READINGS_STALLED_AFTER_MIN };
