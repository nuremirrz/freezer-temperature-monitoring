"use client";

import { useMemo, useState } from "react";
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
import { Unit } from "@/data/types";
import { getHistory, ChartRange } from "@/data/history";

const RANGES: ChartRange[] = ["24H", "7D", "30D"];

function fmtTick(range: ChartRange, t: number): string {
  const d = new Date(t);
  if (range === "24H") {
    let h = d.getHours();
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return `${h} ${ampm}`;
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function buildTicks(range: ChartRange, data: { t: number }[]): number[] {
  const ticks: number[] = [];
  for (const p of data) {
    const d = new Date(p.t);
    if (range === "24H" && d.getHours() % 4 === 0 && d.getMinutes() === 0) ticks.push(p.t);
    if (range === "7D" && d.getHours() === 0) ticks.push(p.t);
    if (range === "30D" && d.getHours() < 6 && d.getDate() % 5 === 0) ticks.push(p.t);
  }
  return ticks;
}

export default function TempChart({ unit }: { unit: Unit }) {
  const [range, setRange] = useState<ChartRange>("24H");

  const data = useMemo(() => getHistory(unit, range), [unit, range]);
  const ticks = useMemo(() => buildTicks(range, data), [range, data]);

  const [yMin, yMax] = useMemo(() => {
    let lo = Math.min(...data.map((p) => p.temp), unit.rangeMin);
    let hi = Math.max(...data.map((p) => p.temp), unit.rangeMax);
    lo = Math.floor((lo - 4) / 5) * 5;
    hi = Math.ceil((hi + 4) / 5) * 5;
    return [lo, hi];
  }, [data, unit]);

  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold">Temperature (°F)</div>
        <div className="flex overflow-hidden rounded-lg border border-line text-xs font-medium">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1.5 transition-colors ${
                r === range ? "bg-primary text-white" : "bg-panel text-muted hover:text-ink"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
            <CartesianGrid stroke="#eaecf0" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              domain={["dataMin", "dataMax"]}
              ticks={ticks}
              tickFormatter={(t) => fmtTick(range, t as number)}
              tick={{ fontSize: 11, fill: "#98a2b3" }}
              axisLine={{ stroke: "#eaecf0" }}
              tickLine={false}
            />
            <YAxis
              domain={[yMin, yMax]}
              tick={{ fontSize: 11, fill: "#98a2b3" }}
              axisLine={false}
              tickLine={false}
              width={46}
            />
            <Tooltip
              labelFormatter={(t) =>
                new Date(t as number).toLocaleString("en-US", {
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
              y={unit.rangeMax}
              stroke="#e5484d"
              strokeDasharray="6 4"
              label={{
                value: `${unit.rangeMax}°F Threshold`,
                position: "insideTopRight",
                fill: "#e5484d",
                fontSize: 11,
              }}
            />
            <Line
              type="monotone"
              dataKey="temp"
              stroke="#2970ff"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
