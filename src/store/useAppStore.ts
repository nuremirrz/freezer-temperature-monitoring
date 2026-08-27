"use client";

import { create } from "zustand";
import { LOCATIONS } from "@/data/locations";
import { Unit } from "@/data/types";

export type SortMode = "alerts" | "name";

interface AppState {
  /** unitId -> live temperature */
  temps: Record<string, number>;
  /** bumped every minute so alert durations re-render */
  minuteTick: number;
  sortMode: SortMode;
  setSortMode: (m: SortMode) => void;
  startSimulation: () => void;
}

function initialTemps(): Record<string, number> {
  const t: Record<string, number> = {};
  for (const loc of LOCATIONS)
    for (const u of loc.units) t[u.id] = u.baseTemp;
  return t;
}

function nextTemp(unit: Unit, current: number): number {
  // ±1–2°F per tick
  const delta = (1 + Math.random()) * (Math.random() < 0.5 ? -1 : 1);
  let t = current + delta;

  if (unit.status === "alert") {
    // Alert units never recover: stay above the threshold, drift with a slight upward bias
    const floor = unit.rangeMax + 1.5;
    const ceil = unit.rangeMax + 12;
    if (t < floor) t = floor + Math.random();
    if (t > ceil) t = ceil - Math.random();
  } else {
    // Normal units stay inside their range
    if (t < unit.rangeMin) t = unit.rangeMin + Math.random();
    if (t > unit.rangeMax) t = unit.rangeMax - Math.random();
  }
  return Math.round(t * 10) / 10;
}

let simulationStarted = false;

export const useAppStore = create<AppState>((set) => ({
  temps: initialTemps(),
  minuteTick: 0,
  sortMode: "alerts",
  setSortMode: (m) => set({ sortMode: m }),

  startSimulation: () => {
    // Single global tick for the whole app
    if (simulationStarted) return;
    simulationStarted = true;

    setInterval(() => {
      set((state) => {
        const temps = { ...state.temps };
        for (const loc of LOCATIONS) {
          for (const u of loc.units) {
            if (u.status === "offline") continue;
            temps[u.id] = nextTemp(u, temps[u.id]);
          }
        }
        return { temps };
      });
    }, 5000);

    setInterval(() => {
      set((state) => ({ minuteTick: state.minuteTick + 1 }));
    }, 60_000);
  },
}));

/** "2h 45m", or "dd:hh:mm" once it exceeds a day */
export function formatDuration(sinceMs: number, style: "short" | "clock" = "short"): string {
  const totalMin = Math.max(0, Math.floor((Date.now() - sinceMs) / 60_000));
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;

  if (style === "clock" || days > 0) {
    const p = (n: number) => String(n).padStart(2, "0");
    if (days > 0) return `${p(days)}:${p(hours)}:${p(mins)}`;
    return `${hours}h ${mins}m`;
  }
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}
