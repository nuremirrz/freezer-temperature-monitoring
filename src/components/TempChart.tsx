"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
} from "recharts";
import { api, CHART_RANGES, ChartRange, ReadingsResponse, UnitDetail } from "@/lib/api";
import { useLiveStore } from "@/store/useLiveStore";

/* ------------------------------------------------------------------ */
/* Palette — from globals.css, so the chart matches the rest of the app */
/* ------------------------------------------------------------------ */

const C = {
  ok: "#16a34a",
  warn: "#d97706",
  alert: "#e5484d",
  freeze: "#2970ff",
  grid: "#eaecf0",
  axis: "#98a2b3",
  room: "#e5484d",
  duct: "#2970ff",
} as const;

/** Background wash for a zone — enough to read the band at a glance, not enough to fight the line. */
const wash = (hex: string) => `${hex}24`;

interface Band {
  /** null means "to the edge of the axis" */
  from: number | null;
  to: number | null;
  color: string;
}

interface Threshold {
  at: number;
  label: string;
  color: string;
}

/**
 * The zones and threshold lines for a unit, derived from its own configuration rather than
 * hard-coded: the normal band gives "Normal" (and, for a cooler, the freeze line below it),
 * the alert band gives "Warning". Editing a range in the app moves the chart with it.
 */
function bandsFor(u: {
  type: UnitDetail["type"];
  rangeMinF: number;
  rangeMaxF: number;
  alertMinF: number | null;
  alertMaxF: number | null;
}): { zones: Band[]; thresholds: Threshold[] } {
  const normalMax = u.rangeMaxF;
  const warnAt = u.alertMaxF ?? u.rangeMaxF;

  if (u.type === "walk_in_cooler") {
    const freezeAt = u.rangeMinF;
    return {
      zones: [
        { from: null, to: freezeAt, color: C.freeze },
        { from: freezeAt, to: normalMax, color: C.ok },
        { from: normalMax, to: warnAt, color: C.warn },
        { from: warnAt, to: null, color: C.alert },
      ],
      thresholds: [
        { at: freezeAt, label: `Freeze Risk ${freezeAt}°F`, color: C.freeze },
        { at: normalMax, label: `Normal ${normalMax}°F`, color: C.ok },
        { at: warnAt, label: `Warning ${warnAt}°F`, color: C.alert },
      ],
    };
  }

  // Freezers, and anything else judged by a single probe
  return {
    zones: [
      { from: null, to: normalMax, color: C.ok },
      { from: normalMax, to: warnAt, color: C.warn },
      { from: warnAt, to: null, color: C.alert },
    ],
    thresholds: [
      { at: normalMax, label: `Normal ${normalMax}°F`, color: C.ok },
      { at: warnAt, label: `Warning ${warnAt}°F`, color: C.alert },
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Axes                                                                */
/* ------------------------------------------------------------------ */

const floorTo = (n: number, step: number) => Math.floor(n / step) * step;
const ceilTo = (n: number, step: number) => Math.ceil(n / step) * step;

/**
 * The y-axis covers the zones by default and stretches only when a reading actually leaves
 * them, so a quiet day is not drawn as a flat line across an empty chart.
 */
function yDomain(base: [number, number], values: number[], step = 10): [number, number] {
  const lo = values.length ? Math.min(base[0], Math.min(...values)) : base[0];
  const hi = values.length ? Math.max(base[1], Math.max(...values)) : base[1];
  return [floorTo(lo, step), ceilTo(hi, step)];
}

function ticksFor([lo, hi]: [number, number], step = 10): number[] {
  const out: number[] = [];
  for (let v = lo; v <= hi; v += step) out.push(v);
  return out;
}

/** Whole hours on the x-axis: two-hourly for cold storage, hourly for an AC. */
function xTicks(from: number, to: number, everyHours: number): number[] {
  const ms = everyHours * 3_600_000;
  const out: number[] = [];
  for (let t = Math.ceil(from / ms) * ms; t <= to; t += ms) out.push(t);
  return out;
}

function fmtTick(range: ChartRange, t: number, timeZone: string): string {
  const d = new Date(t);
  if (range === "1h" || range === "1d") {
    return d.toLocaleTimeString("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false });
  }
  return d.toLocaleDateString("en-US", { timeZone, month: "short", day: "numeric" });
}

type Series = "both" | "room" | "duct";

/* ------------------------------------------------------------------ */

export default function TempChart({ unit, timeZone }: { unit: UnitDetail; timeZone: string }) {
  const [range, setRange] = useState<ChartRange>("1d");
  const [series, setSeries] = useState<Series>("both");
  const [state, setState] = useState<{
    data: ReadingsResponse | null;
    error: string | null;
    loading: boolean;
  }>({ data: null, error: null, loading: true });
  const readingTick = useLiveStore((s) => s.readingTick);

  useEffect(() => {
    const controller = new AbortController();
    // One state write per outcome keeps this a subscription, not a render cascade
    api
      .readings(unit.id, range, controller.signal)
      .then((res) => setState({ data: res, error: null, loading: false }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          data: null,
          error: err instanceof Error ? err.message : "Could not load the chart",
          loading: false,
        });
      });
    return () => controller.abort();
    // readingTick pulls fresh points in when a new uplink lands
  }, [unit.id, range, readingTick]);

  const { data, error, loading } = state;
  const isAC = unit.type === "ac";

  const points = useMemo(
    () =>
      (data?.points ?? []).map((p) => ({
        t: new Date(p.t).getTime(),
        tempF: p.tempF,
        probeTempF: p.probeTempF ?? null,
      })),
    [data],
  );

  const { zones, thresholds } = useMemo(() => bandsFor(unit), [unit]);

  const chart = useMemo(() => {
    const rooms = points.map((p) => p.tempF);
    const ducts = points.map((p) => p.probeTempF).filter((v): v is number => v !== null);

    if (isAC) {
      // The client's rule: a little air below the duct, a little more above the room
      const base: [number, number] = [
        ducts.length ? Math.min(...ducts) - 5 : 30,
        rooms.length ? Math.max(...rooms) + 7 : 90,
      ];
      return { domain: yDomain(base, [...rooms, ...ducts]) };
    }
    const base: [number, number] =
      unit.type === "walk_in_cooler" ? [30, 60] : [0, 40];
    return { domain: yDomain(base, rooms) };
  }, [points, isAC, unit.type]);

  const xFrom = points.length ? points[0].t : 0;
  const xTo = points.length ? points[points.length - 1].t : 0;
  const hourly = range === "1h" || range === "1d";
  const tickHours = isAC ? 1 : 2;

  const showRoom = !isAC || series !== "duct";
  const showDuct = isAC && series !== "room";

  return (
    <div className="rounded-xl border border-line bg-panel p-3.5 md:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold">
          Temperature (°F)
          {data?.bucketMinutes ? (
            <span className="ml-2 text-xs font-normal text-faint">
              {data.bucketMinutes >= 60
                ? `${data.bucketMinutes / 60}-hour averages`
                : `${data.bucketMinutes}-min averages`}
            </span>
          ) : null}
        </div>
        <div className="flex overflow-hidden rounded-lg border border-line text-xs font-medium">
          {CHART_RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`px-3 py-1.5 transition-colors ${
                r.key === range ? "bg-primary text-white" : "bg-panel text-muted hover:text-ink"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="h-56 w-full sm:h-64">
        {loading && !data && <div className="h-full animate-pulse rounded-lg bg-page" />}

        {error && !loading && (
          <div className="flex h-full items-center justify-center text-sm text-alert">{error}</div>
        )}

        {!loading && !error && points.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
            <div className="text-sm text-muted">No readings in this period</div>
            <div className="text-xs text-faint">The chart fills in as uplinks arrive</div>
          </div>
        )}

        {points.length > 0 && (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 10, right: 14, bottom: 0, left: -14 }}>
              <defs>
                <linearGradient id="fillRoom" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.room} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={C.room} stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="fillDuct" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.duct} stopOpacity={0.26} />
                  <stop offset="100%" stopColor={C.duct} stopOpacity={0.02} />
                </linearGradient>
              </defs>

              {/* Zones first, so every line and label sits on top of them */}
              {!isAC &&
                zones.map((z, i) => (
                  <ReferenceArea
                    key={i}
                    y1={z.from ?? chart.domain[0]}
                    y2={z.to ?? chart.domain[1]}
                    fill={wash(z.color)}
                    stroke="none"
                    ifOverflow="hidden"
                  />
                ))}

              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis
                dataKey="t"
                type="number"
                domain={["dataMin", "dataMax"]}
                ticks={hourly ? xTicks(xFrom, xTo, tickHours) : undefined}
                tickFormatter={(t) => fmtTick(range, t as number, timeZone)}
                tick={{ fontSize: 11, fill: C.axis }}
                axisLine={{ stroke: C.grid }}
                tickLine={false}
                minTickGap={28}
              />
              <YAxis
                domain={chart.domain}
                ticks={ticksFor(chart.domain)}
                tickFormatter={(v) => `${v}°F`}
                tick={{ fontSize: 11, fill: C.axis }}
                axisLine={false}
                tickLine={false}
                width={54}
              />
              <Tooltip
                labelFormatter={(t) =>
                  new Date(t as number).toLocaleString("en-US", {
                    timeZone,
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })
                }
                formatter={(v, name) => [
                  `${v}°F`,
                  name === "probeTempF" ? "From the duct" : isAC ? "In the room" : "Temperature",
                ]}
                contentStyle={{
                  borderRadius: 10,
                  border: "1px solid #e4e7ec",
                  fontSize: 12,
                  boxShadow: "0 4px 12px rgba(16,24,40,.08)",
                }}
              />

              {!isAC &&
                thresholds.map((th) => (
                  <ReferenceLine
                    key={th.label}
                    y={th.at}
                    stroke={th.color}
                    strokeDasharray="6 4"
                    ifOverflow="hidden"
                    label={{
                      value: th.label,
                      position: "insideTopLeft",
                      fill: th.color,
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  />
                ))}

              {isAC && showRoom && unit.alertMaxF !== null && (
                <ReferenceLine
                  y={unit.alertMaxF}
                  stroke={C.room}
                  strokeDasharray="6 4"
                  ifOverflow="hidden"
                  label={{
                    value: `Room ${unit.alertMaxF}°F`,
                    position: "insideTopRight",
                    fill: C.room,
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                />
              )}
              {isAC && showDuct && unit.probeMaxF !== null && (
                <ReferenceLine
                  y={unit.probeMaxF}
                  stroke={C.duct}
                  strokeDasharray="6 4"
                  ifOverflow="hidden"
                  label={{
                    value: `Duct ${unit.probeMaxF}°F`,
                    position: "insideBottomRight",
                    fill: C.duct,
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                />
              )}

              {showDuct && (
                <Area
                  type="monotone"
                  dataKey="probeTempF"
                  stroke={C.duct}
                  strokeWidth={2}
                  fill="url(#fillDuct)"
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              )}
              {showRoom && (
                <Area
                  type="monotone"
                  dataKey="tempF"
                  stroke={isAC ? C.room : C.alert}
                  strokeWidth={2}
                  fill={isAC ? "url(#fillRoom)" : "none"}
                  dot={false}
                  isAnimationActive={false}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* One control, not three loose buttons — the client asked for them joined up */}
      {isAC && points.length > 0 && (
        <div className="mt-3 flex overflow-hidden rounded-lg border border-line text-xs font-medium">
          {(
            [
              { key: "both", label: "Both", color: null },
              { key: "room", label: "Temperature in room", color: C.room },
              { key: "duct", label: "Temperature from duct", color: C.duct },
            ] as const
          ).map((s) => (
            <button
              key={s.key}
              onClick={() => setSeries(s.key)}
              className={`flex flex-1 items-center justify-center gap-1.5 px-3 py-2 transition-colors ${
                series === s.key ? "bg-offline-soft" : "bg-panel hover:bg-offline-soft/60"
              }`}
              style={s.color ? { color: s.color } : undefined}
            >
              {s.color && (
                <span aria-hidden className="h-0.5 w-4 rounded-full" style={{ background: s.color }} />
              )}
              <span className={s.color ? "" : "text-ink-soft"}>{s.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
