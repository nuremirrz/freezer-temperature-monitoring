"use client";

import { create } from "zustand";
import {
  api,
  LocationSummary,
  LocationDetail,
  StatusCounts,
  ApiError,
} from "@/lib/api";

/**
 * Live view of the pilot data.
 *
 * The list and the open location are loaded from the API; `/api/stream` (SSE)
 * pushes readings and alerts as they arrive so the screens update without a
 * reload. Polling every 60 s is the fallback when SSE cannot connect.
 */

export type SortMode = "alerts" | "name";
export type ConnectionState = "connecting" | "live" | "polling";

interface LiveState {
  locations: LocationSummary[];
  summary: StatusCounts;
  listLoaded: boolean;
  listError: string | null;

  /** locationId -> detail, cached so switching back is instant */
  details: Record<string, LocationDetail>;
  detailError: Record<string, string>;

  sortMode: SortMode;
  /** bumped every minute so durations and "x min ago" re-render */
  minuteTick: number;
  connection: ConnectionState;
  /** bumped whenever a reading lands, so charts know to refetch */
  readingTick: number;

  setSortMode: (m: SortMode) => void;
  loadLocations: () => Promise<void>;
  loadLocation: (id: string) => Promise<void>;
  start: () => void;
}

const POLL_MS = 60_000;
const RECONNECT_MS = 10_000;

let started = false;
let source: EventSource | null = null;

function message(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}

export const useLiveStore = create<LiveState>((set, get) => ({
  locations: [],
  summary: { normal: 0, alert: 0, offline: 0 },
  listLoaded: false,
  listError: null,
  details: {},
  detailError: {},
  sortMode: "alerts",
  minuteTick: 0,
  connection: "connecting",
  readingTick: 0,

  setSortMode: (m) => set({ sortMode: m }),

  loadLocations: async () => {
    try {
      const data = await api.locations();
      set({ locations: data.locations, summary: data.summary, listLoaded: true, listError: null });
    } catch (err) {
      set({ listError: message(err), listLoaded: true });
    }
  },

  loadLocation: async (id) => {
    try {
      const detail = await api.location(id);
      set((s) => ({
        details: { ...s.details, [id]: detail },
        detailError: { ...s.detailError, [id]: "" },
      }));
    } catch (err) {
      set((s) => ({ detailError: { ...s.detailError, [id]: message(err) } }));
    }
  },

  start: () => {
    if (started) return;
    started = true;

    const { loadLocations, loadLocation } = get();
    void loadLocations();

    // Durations tick on their own, no server round-trip
    setInterval(() => set((s) => ({ minuteTick: s.minuteTick + 1 })), 60_000);

    // Fallback refresh; harmless while SSE is healthy, essential when it isn't
    setInterval(() => {
      void get().loadLocations();
      const open = Object.keys(get().details);
      for (const id of open) void loadLocation(id);
    }, POLL_MS);

    const connect = () => {
      source?.close();
      source = new EventSource("/api/stream");

      source.addEventListener("hello", () => set({ connection: "live" }));

      source.addEventListener("reading", (ev) => {
        const data = JSON.parse((ev as MessageEvent).data) as {
          unitId: string;
          locationId: string;
          tempF: number;
          measuredAt: string;
        };
        // Patch the open location in place so the number moves immediately
        set((s) => {
          const detail = s.details[data.locationId];
          if (!detail) return { readingTick: s.readingTick + 1 };
          return {
            readingTick: s.readingTick + 1,
            details: {
              ...s.details,
              [data.locationId]: {
                ...detail,
                units: detail.units.map((u) =>
                  u.id === data.unitId
                    ? { ...u, lastReading: { tempF: data.tempF, measuredAt: data.measuredAt } }
                    : u,
                ),
              },
            },
          };
        });
      });

      source.addEventListener("alert", (ev) => {
        const data = JSON.parse((ev as MessageEvent).data) as { locationId: string };
        // Statuses and counts changed — refetch rather than reimplement the rules here
        void get().loadLocations();
        if (get().details[data.locationId]) void get().loadLocation(data.locationId);
      });

      source.addEventListener("unit", (ev) => {
        // A normal range moved, so every status derived from it may have moved too
        const data = JSON.parse((ev as MessageEvent).data) as { locationId: string };
        void get().loadLocations();
        if (get().details[data.locationId]) void get().loadLocation(data.locationId);
      });

      source.onerror = () => {
        set({ connection: "polling" });
        source?.close();
        source = null;
        setTimeout(connect, RECONNECT_MS);
      };
    };

    if (typeof EventSource !== "undefined") connect();
    else set({ connection: "polling" });
  },
}));

/** Sorted list for the sidebar: problems first, or by store number. */
const STATUS_ORDER = { alert: 0, offline: 1, normal: 2 } as const;

export function sortLocations(locations: LocationSummary[], mode: SortMode): LocationSummary[] {
  const byName = (a: LocationSummary, b: LocationSummary) => a.name.localeCompare(b.name, "en", { numeric: true });
  return [...locations].sort((a, b) =>
    mode === "alerts"
      ? STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || byName(a, b)
      : byName(a, b),
  );
}
