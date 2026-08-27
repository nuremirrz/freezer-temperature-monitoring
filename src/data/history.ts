import { Unit } from "./types";
import { mulberry32, hashString } from "./rng";

export type ChartRange = "24H" | "7D" | "30D";

export interface HistoryPoint {
  t: number; // epoch ms
  temp: number;
}

const cache = new Map<string, HistoryPoint[]>();

interface RangeCfg {
  points: number;
  stepMs: number;
}

const RANGE_CFG: Record<ChartRange, RangeCfg> = {
  "24H": { points: 97, stepMs: 15 * 60_000 },
  "7D": { points: 169, stepMs: 60 * 60_000 },
  "30D": { points: 121, stepMs: 6 * 60 * 60_000 },
};

/**
 * Series are generated once per unit+range and cached (as per spec).
 * Normal units oscillate inside their range; alert units start inside the
 * range and rise, crossing the threshold so the 24H curve matches the design.
 */
export function getHistory(unit: Unit, range: ChartRange): HistoryPoint[] {
  const key = `${unit.id}:${range}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const { points, stepMs } = RANGE_CFG[range];
  const rng = mulberry32(hashString(key));
  const now = Date.now();
  const start = now - (points - 1) * stepMs;

  const mid = (unit.rangeMin + unit.rangeMax) / 2;
  const halfSpan = (unit.rangeMax - unit.rangeMin) / 2;
  const isAlert = unit.status === "alert";

  // Where (as a fraction of the series) the alert climb starts
  const climbStart = range === "24H" ? 0.58 : range === "7D" ? 0.9 : 0.95;

  const series: HistoryPoint[] = [];
  let wave = rng() * Math.PI * 2;

  for (let i = 0; i < points; i++) {
    const f = i / (points - 1);
    wave += 0.35 + rng() * 0.25;

    // Baseline: gentle oscillation inside the normal range
    let temp =
      mid +
      Math.sin(wave) * halfSpan * 0.45 +
      (rng() - 0.5) * halfSpan * 0.5;

    if (isAlert && f >= climbStart) {
      // Ease from the in-range baseline up to the current (out-of-range) temp
      const p = (f - climbStart) / (1 - climbStart);
      const eased = p * p * (3 - 2 * p); // smoothstep
      const target = unit.baseTemp + (rng() - 0.5) * 0.6;
      temp = temp * (1 - eased) + target * eased;
      if (p > 0.55 && temp < unit.rangeMax + 0.5) temp = unit.rangeMax + 0.5 + p;
    } else {
      temp = Math.min(unit.rangeMax - 0.2, Math.max(unit.rangeMin + 0.2, temp));
    }

    series.push({ t: start + i * stepMs, temp: Math.round(temp * 10) / 10 });
  }

  // Last point ends at the unit's current base temperature for continuity
  series[series.length - 1].temp = unit.baseTemp;

  cache.set(key, series);
  return series;
}
