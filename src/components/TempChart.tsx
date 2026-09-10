"use client";

import { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { api, ChartRange, ReadingsResponse, UnitDetail } from "@/lib/api";
import { useLiveStore } from "@/store/useLiveStore";

const RANGES: ChartRange[] = ["24h", "7d", "30d"];
const RANGE_LABEL: Record<ChartRange, string> = { "24h": "24H", "7d": "7D", "30d": "30D" };

function fmtTick(range: ChartRange, t: number, timeZone: string): string {
  const d = new Date(t);
  if (range === "24h") {
    return d.toLocaleTimeString("en-US", { timeZone, hour: "numeric", hour12: true });
  }
  return d.toLocaleDateString("en-US", { timeZone, month: "short", day: "numeric" });
}

export default function TempChart({ unit, timeZone }: { unit: UnitDetail; timeZone: string }) {
  const [range, setRange] = useState<ChartRange>("24h");
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

  const points = (data?.points ?? []).map((p) => ({ t: new Date(p.t).getTime(), tempF: p.tempF }));
  const temps = points.map((p) => p.tempF);
  const lo = Math.floor((Math.min(unit.rangeMinF, ...temps) - 4) / 5) * 5;
  const hi = Math.ceil((Math.max(unit.rangeMaxF, ...temps) + 4) / 5) * 5;

  return (
    <div className="rounded-xl border border-line bg-panel p-3.5 md:p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
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
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1.5 transition-colors ${
                r === range ? "bg-primary text-white" : "bg-panel text-muted hover:text-ink"
              }`}
            >
              {RANGE_LABEL[r]}
            </button>
          ))}
        </div>
      </div>

      <div className="h-48 w-full sm:h-56">
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
            <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
              <CartesianGrid stroke="#eaecf0" vertical={false} />
              <XAxis
                dataKey="t"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(t) => fmtTick(range, t as number, timeZone)}
                tick={{ fontSize: 11, fill: "#98a2b3" }}
                axisLine={{ stroke: "#eaecf0" }}
                tickLine={false}
                minTickGap={40}
              />
              <YAxis
                domain={[lo, hi]}
                tick={{ fontSize: 11, fill: "#98a2b3" }}
                axisLine={false}
                tickLine={false}
                width={46}
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
                formatter={(v) => [`${v}°F`, "Temperature"]}
                contentStyle={{
                  borderRadius: 10,
                  border: "1px solid #e4e7ec",
                  fontSize: 12,
                  boxShadow: "0 4px 12px rgba(16,24,40,.08)",
                }}
              />
              <ReferenceLine
                y={unit.rangeMaxF}
                stroke="#e5484d"
                strokeDasharray="6 4"
                label={{
                  value: `${unit.rangeMaxF}°F Threshold`,
                  position: "insideTopRight",
                  fill: "#e5484d",
                  fontSize: 11,
                }}
              />
              <ReferenceLine y={unit.rangeMinF} stroke="#e5484d" strokeDasharray="6 4" opacity={0.5} />
              <Line
                type="monotone"
                dataKey="tempF"
                stroke="#2970ff"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
