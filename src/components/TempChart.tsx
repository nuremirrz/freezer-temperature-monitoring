"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
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
import { api, CHART_RANGES, ChartRange, ReadingsQuery, ReadingsResponse, UnitDetail } from "@/lib/api";
import { useLiveStore } from "@/store/useLiveStore";
import { axisTicks, breakGaps, maxGapMs, sampleAt, tickLabel, windowLabel } from "@/lib/chart-axis";
import { fromLocalInput, toLocalInput, tzAbbrev } from "@/lib/tz";
import { PRESET_HOURS } from "@/lib/readings/window";

// The calendar and its library arrive only when someone presses Custom
const RangePicker = dynamic(() => import("./RangePicker"), { ssr: false });

/* ------------------------------------------------------------------ */
/* Palette — from globals.css, so the chart matches the rest of the app */
/* ------------------------------------------------------------------ */

/** Water freezes at 32 °F — above it a freezer's contents start to thaw, whatever the range says. */
const MELTING_POINT_F = 32;

const C = {
  ok: "#16a34a",
  warn: "#d97706",
  alert: "#e5484d",
  freeze: "#2970ff",
  grid: "#eaecf0",
  axis: "#98a2b3",
  melt: "#667085",
  room: "#e5484d",
  duct: "#2970ff",
  /** The air outside: yellow, as the client asked, so it is never taken for a reading of ours */
  outside: "#eab308",
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
        // The line sits at the bottom of the normal band, so it has to say "below" — at 33
        // itself a cooler is fine; it is 32 and under that puts produce at risk.
        { at: freezeAt, label: `Freeze Risk below ${freezeAt}°F`, color: C.freeze },
        { at: normalMax, label: `Normal ${normalMax}°F`, color: C.ok },
        { at: warnAt, label: `Warning ${warnAt}°F`, color: C.alert },
      ],
    };
  }

  // Freezers, and anything else judged by a single probe
  const isFreezer = u.type === "freezer" || u.type === "walk_in_freezer";
  return {
    zones: [
      { from: null, to: normalMax, color: C.ok },
      { from: normalMax, to: warnAt, color: C.warn },
      { from: warnAt, to: null, color: C.alert },
    ],
    thresholds: [
      { at: normalMax, label: `Normal ${normalMax}°F`, color: C.ok },
      { at: warnAt, label: `Warning ${warnAt}°F`, color: C.alert },
      // Not a rule of ours — a fact about water. The reference marks it because a freezer
      // past it is not merely warm, it is thawing.
      ...(isFreezer && warnAt < MELTING_POINT_F
        ? [{ at: MELTING_POINT_F, label: `Melting point ${MELTING_POINT_F}°F`, color: C.melt }]
        : []),
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
 *
 * The base is used exactly as given — rounding it to the tick step would undo a deliberate
 * choice like the cooler's 25…55, which then ticks 25 / 35 / 45 / 55. Only the stretch
 * rounds, so a stray reading still lands on a whole step.
 */
function yDomain(base: [number, number], values: number[], step = 10): [number, number] {
  if (!values.length) return base;
  const dataLo = Math.min(...values);
  const dataHi = Math.max(...values);
  return [
    dataLo < base[0] ? floorTo(dataLo, step) : base[0],
    dataHi > base[1] ? ceilTo(dataHi, step) : base[1],
  ];
}

function ticksFor([lo, hi]: [number, number], step = 10): number[] {
  const out: number[] = [];
  for (let v = lo; v <= hi; v += step) out.push(v);
  return out;
}

/* ------------------------------------------------------------------ */
/* The window: which stretch of time is shown                          */
/* ------------------------------------------------------------------ */

type Window = { range: ChartRange } | { range: "custom"; from: number; to: number };

const DEFAULT_RANGE: ChartRange = "1d";

/**
 * The address carries the window — `?range=1w`, or `?from=2026-09-25T14:00&to=…` on the
 * restaurant's clock — so a chart can be sent to someone as a link, and reloading keeps it.
 */
function windowFromUrl(q: URLSearchParams, tz: string): Window {
  const from = fromLocalInput(q.get("from") ?? "", tz);
  const to = fromLocalInput(q.get("to") ?? "", tz);
  if (from !== null && to !== null && to > from) return { range: "custom", from, to };
  const range = q.get("range");
  return { range: range && range in PRESET_HOURS ? (range as ChartRange) : DEFAULT_RANGE };
}

function writeWindowToUrl(w: Window, tz: string) {
  const url = new URL(window.location.href);
  url.searchParams.delete("range");
  url.searchParams.delete("from");
  url.searchParams.delete("to");
  if (w.range === "custom") {
    url.searchParams.set("from", toLocalInput(w.from, tz));
    url.searchParams.set("to", toLocalInput(w.to, tz));
  } else if (w.range !== DEFAULT_RANGE) {
    url.searchParams.set("range", w.range);
  }
  window.history.replaceState(null, "", url);
}

const queryFor = (w: Window): ReadingsQuery =>
  w.range === "custom" ? { from: new Date(w.from).toISOString(), to: new Date(w.to).toISOString() } : { range: w.range };

/**
 * Which of an AC's lines are on. Each button is its own switch; the room and the duct start
 * on, the air outside starts off, and a reload goes back to that (the client's spec).
 */
type Shown = { room: boolean; duct: boolean; outside: boolean };
const DEFAULT_SHOWN: Shown = { room: true, duct: true, outside: false };

/* ------------------------------------------------------------------ */

export default function TempChart({ unit, timeZone }: { unit: UnitDetail; timeZone: string }) {
  // The address is the one source of truth for the window; choosing one rewrites the address
  const params = useSearchParams();
  const win = useMemo(() => windowFromUrl(params, timeZone), [params, timeZone]);
  // The instant the picker was opened, or null while it is closed
  const [picking, setPicking] = useState<number | null>(null);
  const [shown, setShown] = useState<Shown>(DEFAULT_SHOWN);
  const [state, setState] = useState<{
    data: ReadingsResponse | null;
    error: string | null;
    loading: boolean;
  }>({ data: null, error: null, loading: true });
  const readingTick = useLiveStore((s) => s.readingTick);
  // A chosen period is fixed: a new uplink cannot land inside it, so it never refetches
  const liveTick = win.range !== "custom" ? readingTick : 0;

  const choose = useCallback(
    (w: Window) => {
      setPicking(null);
      writeWindowToUrl(w, timeZone);
    },
    [timeZone],
  );

  useEffect(() => {
    const controller = new AbortController();
    // One state write per outcome keeps this a subscription, not a render cascade
    api
      .readings(unit.id, queryFor(win), controller.signal)
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
    // liveTick pulls fresh points in when a new uplink lands — for a window that ends now
  }, [unit.id, win, liveTick]);

  const { data, error, loading } = state;
  const isAC = unit.type === "ac";

  const bucketed = !!data?.bucketMinutes;
  const points = useMemo(() => {
    if (!data) return [];
    const raw = data.points.map((p) => ({
      t: new Date(p.t).getTime(),
      tempF: p.tempF,
      probeTempF: p.probeTempF ?? null,
      // The spread inside an averaged bucket, drawn as a band behind the line
      band: p.min !== undefined && p.max !== undefined ? [p.min, p.max] : null,
    }));
    // The air outside joins the readings rather than standing beside them: it has its own
    // timestamps (a quarter hour apart live, an hour apart in the backfilled past), and a series
    // of its own would be paired with the readings by position, which is to say by accident.
    // Samples only spread out further when a bucket of an hour or more makes them.
    const weatherBucket = data.bucketMinutes !== null && data.bucketMinutes >= 60 ? data.bucketMinutes : null;
    const outside = sampleAt(
      raw.map((p) => p.t),
      (data.weather ?? []).map((p) => ({ t: new Date(p.t).getTime(), v: p.tempF })),
      maxGapMs(weatherBucket, 3600),
    );
    return breakGaps(raw.map((p, i) => ({ ...p, outsideF: outside[i] })), maxGapMs(data.bucketMinutes, data.intervalSec));
  }, [data]);
  const hasPoints = data ? data.points.length > 0 : false;
  const hasWeather = (data?.weather?.length ?? 0) > 0;

  const { zones, thresholds } = useMemo(() => bandsFor(unit), [unit]);

  const chart = useMemo(() => {
    const real = points.filter((p): p is Exclude<typeof p, { gap: true }> => !("gap" in p));
    const rooms = real.flatMap((p) => p.band ?? [p.tempF]);
    const ducts = real.map((p) => p.probeTempF).filter((v): v is number => v !== null);
    const outs = isAC && shown.outside ? real.flatMap((p) => (p.outsideF !== null ? [p.outsideF] : [])) : [];

    if (isAC) {
      // The client's rule: a little air below the duct, a little more above the room — on whole
      // tens, or the ticks come out as 43.57 / 53.57 and the axis labels are cut to "3.57°F".
      const base: [number, number] = [
        ducts.length ? floorTo(Math.min(...ducts) - 5, 10) : 30,
        rooms.length ? ceilTo(Math.max(...rooms) + 7, 10) : 90,
      ];
      return { domain: yDomain(base, [...rooms, ...ducts, ...outs]) };
    }
    const base: [number, number] = unit.type === "walk_in_cooler" ? [25, 55] : [0, 40];
    return { domain: yDomain(base, rooms) };
  }, [points, shown.outside, isAC, unit.type]);

  // The axis spans the window asked for, not the points found: an outage at the end shows as
  // empty space, which is the truth of it
  const xFrom = data ? new Date(data.from).getTime() : 0;
  const xTo = data ? new Date(data.to).getTime() : 0;
  const ticks = useMemo(() => (data ? axisTicks(xFrom, xTo, timeZone, isAC) : null), [data, xFrom, xTo, timeZone, isAC]);
  const custom = win.range === "custom" ? win : null;

  const showRoom = !isAC || shown.room;
  const showDuct = isAC && shown.duct;
  const showOutside = isAC && shown.outside && hasWeather;

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
          {custom && (
            <div className="text-xs font-normal text-muted">
              {windowLabel(custom.from, custom.to, timeZone)}
              <span className="text-faint"> · {tzAbbrev(custom.to, timeZone)}</span>
            </div>
          )}
        </div>
        <div className="relative">
          <div className="flex overflow-hidden rounded-lg border border-line text-xs font-medium">
            {CHART_RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => choose({ range: r.key })}
                className={`px-3 py-1.5 transition-colors ${
                  win.range === r.key ? "bg-primary text-white" : "bg-panel text-muted hover:text-ink"
                }`}
              >
                {r.label}
              </button>
            ))}
            <button
              onClick={() => setPicking((v) => (v === null ? Date.now() : null))}
              aria-expanded={picking !== null}
              className={`px-3 py-1.5 transition-colors ${
                custom ? "bg-primary text-white" : "bg-panel text-muted hover:text-ink"
              }`}
            >
              Custom
            </button>
          </div>
          {picking !== null && (
            <RangePicker
              timeZone={timeZone}
              now={picking}
              initial={custom ? { from: custom.from, to: custom.to } : undefined}
              onApply={(from, to) => choose({ range: "custom", from, to })}
              onClose={() => setPicking(null)}
            />
          )}
        </div>
      </div>

      <div className="h-56 w-full sm:h-64">
        {loading && !data && <div className="h-full animate-pulse rounded-lg bg-page" />}

        {error && !loading && (
          <div className="flex h-full items-center justify-center text-sm text-alert">{error}</div>
        )}

        {!loading && !error && data && !hasPoints && (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
            <div className="text-sm text-muted">No readings in this period</div>
            <div className="text-xs text-faint">
              {custom ? "Nothing was recorded between these times" : "The chart fills in as uplinks arrive"}
            </div>
          </div>
        )}

        {hasPoints && (
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
                <linearGradient id="fillOutside" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.outside} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={C.outside} stopOpacity={0.02} />
                </linearGradient>
                {/* Kept lighter than the AC fills: cold storage already has coloured zones
                    behind the line, and a heavy wash on top of them turns to mud. */}
                <linearGradient id="fillCold" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.alert} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={C.alert} stopOpacity={0.02} />
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
                domain={[xFrom, xTo]}
                allowDataOverflow
                ticks={ticks?.values}
                tickFormatter={(t) => (ticks ? tickLabel(ticks.mode, t as number, timeZone) : "")}
                tick={{ fontSize: 11, fill: C.axis }}
                axisLine={{ stroke: C.grid }}
                tickLine={false}
                minTickGap={28}
              />
              <YAxis
                domain={chart.domain}
                ticks={ticksFor(chart.domain)}
                tickFormatter={(v) => `${Math.round(v)}°F`}
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
                formatter={(v, name) => {
                  if (name === "band") {
                    const [lo, hi] = v as [number, number];
                    return [`${lo}°F – ${hi}°F`, "Low – high"];
                  }
                  if (name === "outsideF") return [`${v}°F`, "Outside"];
                  const what = name === "probeTempF" ? "From the duct" : isAC ? "In the room" : "Temperature";
                  return [`${v}°F`, bucketed ? `${what} (average)` : what];
                }}
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

              {/* The spread inside each bucket — how far the unit wandered, not only where it sat */}
              {bucketed && showRoom && (
                <Area
                  type="monotone"
                  dataKey="band"
                  stroke="none"
                  fill={isAC ? C.room : C.alert}
                  fillOpacity={0.12}
                  dot={false}
                  activeDot={false}
                  isAnimationActive={false}
                />
              )}
              {showOutside && (
                <Area
                  type="monotone"
                  dataKey="outsideF"
                  stroke={C.outside}
                  strokeWidth={1.25}
                  fill="url(#fillOutside)"
                  dot={false}
                  isAnimationActive={false}
                />
              )}
              {showDuct && (
                <Area
                  type="monotone"
                  dataKey="probeTempF"
                  stroke={C.duct}
                  strokeWidth={1.25}
                  fill="url(#fillDuct)"
                  dot={false}
                  isAnimationActive={false}
                />
              )}
              {showRoom && (
                <Area
                  type="monotone"
                  dataKey="tempF"
                  stroke={isAC ? C.room : C.alert}
                  strokeWidth={1.25}
                  fill={isAC ? "url(#fillRoom)" : "url(#fillCold)"}
                  dot={false}
                  isAnimationActive={false}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* One control, not three loose buttons — the client asked for them joined up. Each is
          a switch of its own: what is pressed is drawn, what is not is taken off the chart. */}
      {isAC && hasPoints && (
        <div className="mt-3 flex overflow-hidden rounded-lg border border-line text-xs font-medium">
          {(
            [
              { key: "room", label: "Room", color: C.room, available: true },
              { key: "duct", label: "Duct", color: C.duct, available: true },
              { key: "outside", label: "Outside", color: C.outside, available: hasWeather },
            ] as const
          ).map((s) => {
            const on = shown[s.key];
            return (
              <button
                key={s.key}
                onClick={() => setShown((v) => ({ ...v, [s.key]: !v[s.key] }))}
                aria-pressed={on}
                disabled={!s.available}
                title={s.available ? undefined : "No outdoor temperature recorded for this period"}
                className={`flex flex-1 items-center justify-center gap-1.5 px-2 py-2 transition-colors disabled:opacity-40 ${
                  on ? "bg-offline-soft" : "bg-panel text-muted hover:bg-offline-soft/60"
                }`}
                style={on ? { color: s.color } : undefined}
              >
                <span
                  aria-hidden
                  className={`h-0.5 w-4 rounded-full ${on ? "" : "opacity-40"}`}
                  style={{ background: s.color }}
                />
                <span>{s.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
