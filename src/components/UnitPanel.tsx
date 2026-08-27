"use client";

/* eslint-disable @next/next/no-img-element */

import { useMemo } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  DoorOpen,
  Wrench,
  Fan,
  CalendarClock,
  TrendingUp,
  MoveRight,
  X,
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
    <div className="@container z-10 flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-y-auto bg-page">
      <div className="mx-auto w-full max-w-3xl p-4 md:p-5">
        {/* Overview tab bar — single item, others will come later */}
        <div className="mb-4 flex items-center justify-between border-b border-line">
          <span className="inline-block border-b-2 border-primary px-1 pb-2 text-sm font-semibold text-ink">
            Overview
          </span>
          <Link
            href={`/locations/${loc.id}`}
            title="Close"
            className="mb-1 flex size-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-offline-soft hover:text-ink"
          >
            <X size={16} />
          </Link>
        </div>

        {/* Unit description */}
        <div className="mb-4 flex items-start justify-between gap-4 rounded-xl border border-line bg-panel p-4 md:p-5">
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
            className="h-20 w-20 shrink-0 rounded-lg border border-line-soft bg-page object-contain p-2 @sm:h-32 @sm:w-32"
          />
        </div>

        {/* Current State */}
        <div className="mb-4">
          <div className="mb-2 text-sm font-semibold">Current State</div>
          <div className="grid grid-cols-2 gap-2.5 @3xl:grid-cols-4 md:gap-3">
            <div className="rounded-xl border border-line bg-panel p-3.5 md:p-4">
              <div className="text-xs text-muted">Current Temp</div>
              <div
                className={`mt-1 text-xl font-semibold tabular-nums @xs:text-2xl ${
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

            <div className="rounded-xl border border-line bg-panel p-3.5 md:p-4">
              <div className="text-xs text-muted">Normal Range</div>
              <div className="mt-1.5 text-base font-semibold whitespace-nowrap tabular-nums @xs:text-lg @md:text-xl">
                {formatRange(unit)}
              </div>
            </div>

            <div className="rounded-xl border border-line bg-panel p-3.5 md:p-4">
              <div className="text-xs text-muted">In this state</div>
              <div className="mt-1.5 text-lg font-semibold tabular-nums @xs:text-xl">
                {formatDuration(since)}
              </div>
            </div>

            <div className="rounded-xl border border-line bg-panel p-3.5 md:p-4">
              <div className="text-xs text-muted">Trend</div>
              {isOffline ? (
                <div className="mt-1.5 text-lg font-semibold text-offline @xs:text-xl">—</div>
              ) : isAlert ? (
                <div className="mt-1.5 flex items-center gap-1.5 text-lg font-semibold @xs:text-xl text-alert">
                  Rising <TrendingUp size={18} />
                </div>
              ) : (
                <div className="mt-1.5 flex items-center gap-1.5 text-lg font-semibold @xs:text-xl text-ok">
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
          <div className="mt-4 rounded-xl border border-line bg-panel p-4 md:p-5">
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
