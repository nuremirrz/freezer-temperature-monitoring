"use client";

/* eslint-disable @next/next/no-img-element */

import { useMemo } from "react";
import {
  AlertTriangle,
  DoorOpen,
  Wrench,
  Fan,
  CalendarClock,
  TrendingUp,
  MoveRight,
} from "lucide-react";
import { BKLocation, Unit, UNIT_IMAGE, UNIT_TYPE_LABEL, formatRange } from "@/data/types";
import { hashString } from "@/data/rng";
import { useAppStore, formatDuration } from "@/store/useAppStore";
import TempChart from "./TempChart";

// Pseudo "state started" moments for non-alert units, stable for the session
const stateSinceCache = new Map<string, number>();
function stateSince(unit: Unit): number {
  if (unit.status === "alert" && unit.alertSince) return unit.alertSince;
  const hit = stateSinceCache.get(unit.id);
  if (hit) return hit;
  const minutes = 180 + (hashString(unit.id) % (60 * 46)); // 3h .. ~2d
  const since = Date.now() - minutes * 60_000;
  stateSinceCache.set(unit.id, since);
  return since;
}

const RECOMMENDATIONS = [
  { icon: DoorOpen, text: "Check if door was left open" },
  { icon: Wrench, text: "Inspect door gasket" },
  { icon: Fan, text: "Verify evaporator fan operation" },
  { icon: CalendarClock, text: "Schedule technician if trend continues" },
];

export default function UnitPanel({ loc, unit }: { loc: BKLocation; unit: Unit }) {
  const temp = useAppStore((s) => s.temps[unit.id]);
  const minuteTick = useAppStore((s) => s.minuteTick);

  const isAlert = unit.status === "alert";
  const isOffline = unit.status === "offline";

  const since = useMemo(() => stateSince(unit), [unit]);
  void minuteTick; // refresh "In this state" every minute

  return (
    <div className="z-10 flex min-h-0 flex-1 flex-col overflow-y-auto bg-page">
      <div className="mx-auto w-full max-w-3xl p-5">
        {/* Overview tab bar — single item, others will come later */}
        <div className="mb-4 border-b border-line">
          <span className="inline-block border-b-2 border-primary px-1 pb-2 text-sm font-semibold text-ink">
            Overview
          </span>
        </div>

        {/* Unit description */}
        <div className="mb-4 flex items-start justify-between gap-4 rounded-xl border border-line bg-panel p-5">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold">{unit.systemName}</h3>
            <div className="mb-4 text-sm text-muted">
              {loc.name} · {unit.area}
            </div>
            <dl className="space-y-1.5 text-sm">
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-muted">Model:</dt>
                <dd className="font-medium">{unit.model}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-muted">Serial N:</dt>
                <dd className="font-medium">{unit.serial}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-muted">Year:</dt>
                <dd className="font-medium">{unit.year}</dd>
              </div>
            </dl>
          </div>
          <img
            src={UNIT_IMAGE[unit.type]}
            alt={UNIT_TYPE_LABEL[unit.type]}
            className="h-32 w-32 shrink-0 rounded-lg border border-line-soft bg-page object-contain p-2"
          />
        </div>

        {/* Current State */}
        <div className="mb-4">
          <div className="mb-2 text-sm font-semibold">Current State</div>
          <div className="grid grid-cols-2 gap-3 min-[1700px]:grid-cols-4">
            <div className="rounded-xl border border-line bg-panel p-4">
              <div className="text-xs text-muted">Current Temp</div>
              <div
                className={`mt-1 text-2xl font-semibold tabular-nums ${
                  isAlert ? "text-alert" : ""
                }`}
              >
                {isOffline ? "—" : `${Math.round(temp)}°F`}
              </div>
              {isAlert && (
                <div className="mt-1 flex items-center gap-1 text-xs font-medium text-alert">
                  <AlertTriangle size={12} /> Needs attention
                </div>
              )}
            </div>

            <div className="rounded-xl border border-line bg-panel p-4">
              <div className="text-xs text-muted">Normal Range</div>
              <div className="mt-1.5 text-xl font-semibold whitespace-nowrap tabular-nums">
                {formatRange(unit)}
              </div>
            </div>

            <div className="rounded-xl border border-line bg-panel p-4">
              <div className="text-xs text-muted">In this state</div>
              <div className="mt-1.5 text-xl font-semibold tabular-nums">
                {formatDuration(since)}
              </div>
            </div>

            <div className="rounded-xl border border-line bg-panel p-4">
              <div className="text-xs text-muted">Trend</div>
              {isOffline ? (
                <div className="mt-1.5 text-xl font-semibold text-offline">—</div>
              ) : isAlert ? (
                <div className="mt-1.5 flex items-center gap-1.5 text-xl font-semibold text-alert">
                  Rising <TrendingUp size={18} />
                </div>
              ) : (
                <div className="mt-1.5 flex items-center gap-1.5 text-xl font-semibold text-ok">
                  Stable <MoveRight size={18} />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Chart */}
        <TempChart unit={unit} />

        {/* Recommendations — alert units only */}
        {isAlert && (
          <div className="mt-4 rounded-xl border border-line bg-panel p-5">
            <div className="mb-3 text-sm font-semibold">Recommendations</div>
            <ul className="space-y-2.5">
              {RECOMMENDATIONS.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-center gap-3 text-sm text-ink-soft">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-alert-soft">
                    <Icon size={16} className="text-alert" />
                  </span>
                  {text}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
