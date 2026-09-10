"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import {
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  MoveRight,
  WifiOff,
  X,
  BatteryMedium,
  Radio,
  Wind,
} from "lucide-react";
import {
  LocationDetail,
  UnitDetail,
  UNIT_IMAGE,
  UNIT_TYPE_LABEL,
  formatRange,
  formatTemp,
  isOutOfRange,
  formatDuration,
  formatAge,
  formatLocalTime,
} from "@/lib/api";
import { useLiveStore } from "@/store/useLiveStore";
import TempChart from "./TempChart";
import ServiceHistory from "./ServiceHistory";

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-3.5 md:p-4">
      <div className="text-xs text-muted">{label}</div>
      {children}
    </div>
  );
}

/** Which direction the temperature is heading, from the alert peak or the range midpoint. */
function Trend({ unit }: { unit: UnitDetail }) {
  if (!unit.lastReading) {
    return <div className="mt-1.5 text-xl font-semibold text-offline">—</div>;
  }
  if (isOutOfRange(unit.lastReading.tempF, unit)) {
    const above = unit.lastReading.tempF > unit.rangeMaxF;
    return (
      <div className="mt-1.5 flex items-center gap-1.5 text-lg font-semibold text-alert @xs:text-xl">
        {above ? "Rising" : "Falling"}
        {above ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
      </div>
    );
  }
  return (
    <div className="mt-1.5 flex items-center gap-1.5 text-lg font-semibold text-ok @xs:text-xl">
      Stable <MoveRight size={18} />
    </div>
  );
}

export default function UnitPanel({ loc, unit }: { loc: LocationDetail; unit: UnitDetail }) {
  const minuteTick = useLiveStore((s) => s.minuteTick);
  void minuteTick; // durations and "x min ago" refresh every minute

  const isAlert = unit.status === "alert";
  const isOffline = unit.status === "offline";
  const sensor = unit.sensor;
  const outOfRange = unit.lastReading ? isOutOfRange(unit.lastReading.tempF, unit) : false;

  return (
    <div className="@container z-10 flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-y-auto bg-page">
      <div className="mx-auto w-full max-w-3xl p-4 md:p-5">
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
            <h3 className="text-lg font-semibold">{unit.name}</h3>
            <div className="mb-4 text-sm text-muted">
              {loc.name} · {UNIT_TYPE_LABEL[unit.type]}
            </div>
            <dl className="space-y-1.5 text-sm">
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-muted">Model:</dt>
                <dd className="font-medium">{unit.model ?? "—"}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-muted">Serial N:</dt>
                <dd className="font-medium">{unit.serial ?? "—"}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-muted">Year:</dt>
                <dd className="font-medium">{unit.year ?? "—"}</dd>
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
            <Tile label="Current Temp">
              <div
                className={`mt-1 text-xl font-semibold tabular-nums @xs:text-2xl ${
                  outOfRange ? "text-alert" : ""
                }`}
              >
                {unit.lastReading ? formatTemp(unit.lastReading.tempF) : "—"}
              </div>
              {isAlert && (
                <div className="mt-1 flex items-center gap-1 text-xs font-medium text-alert">
                  <AlertTriangle size={12} /> Needs attention
                </div>
              )}
              {outOfRange && !isAlert && (
                <div className="mt-1 text-xs font-medium text-warn">Out of range, confirming</div>
              )}
              {unit.lastReading && !isAlert && !outOfRange && (
                <div className="mt-1 text-xs text-faint">{formatAge(unit.lastReading.measuredAt)}</div>
              )}
              {isOffline && (
                <div className="mt-1 flex items-center gap-1 text-xs font-medium text-offline">
                  <WifiOff size={12} /> Not reporting
                </div>
              )}
            </Tile>

            <Tile label="Normal Range">
              <div className="mt-1.5 text-base font-semibold whitespace-nowrap tabular-nums @xs:text-lg @md:text-xl">
                {formatRange(unit)}
              </div>
            </Tile>

            <Tile label={unit.activeAlert ? "In this state" : "Last reading"}>
              <div className="mt-1.5 text-lg font-semibold tabular-nums @xs:text-xl">
                {unit.activeAlert
                  ? formatDuration(unit.activeAlert.openedAt)
                  : unit.lastReading
                    ? formatAge(unit.lastReading.measuredAt)
                    : "—"}
              </div>
            </Tile>

            <Tile label="Trend">
              <Trend unit={unit} />
            </Tile>
          </div>
        </div>

        <TempChart unit={unit} timeZone={loc.timezone} />

        {/* Sensor health — real hardware telemetry, only when a sensor is mapped */}
        {sensor && (
          <div className="mt-4 rounded-xl border border-line bg-panel p-4 md:p-5">
            <div className="mb-3 text-sm font-semibold">Sensor</div>
            <div className="grid gap-3 text-sm @lg:grid-cols-2">
              <div className="flex items-center gap-2.5">
                <Radio size={16} className="shrink-0 text-muted" />
                <span className="text-muted">Device</span>
                <span className="ml-auto font-medium tabular-nums">
                  {sensor.devEui}
                  {sensor.nodeType ? ` · ${sensor.nodeType}` : ""} · ch{sensor.channel}
                </span>
              </div>
              <div className="flex items-center gap-2.5">
                <BatteryMedium size={16} className="shrink-0 text-muted" />
                <span className="text-muted">Battery</span>
                <span className="ml-auto font-medium tabular-nums">
                  {sensor.batteryV ? `${sensor.batteryV} V` : "—"}
                  {sensor.batteryPct !== null ? ` · ${sensor.batteryPct}%` : ""}
                  {sensor.batStatus ? ` · ${sensor.batStatus}` : ""}
                </span>
              </div>
              <div className="flex items-center gap-2.5">
                <Radio size={16} className="shrink-0 text-muted" />
                <span className="text-muted">Signal</span>
                <span className="ml-auto font-medium tabular-nums">
                  {sensor.lastRssi !== null ? `${sensor.lastRssi} dBm` : "—"}
                  {sensor.lastSnr !== null ? ` · SNR ${sensor.lastSnr}` : ""}
                </span>
              </div>
              <div className="flex items-center gap-2.5">
                <span className="text-muted">Last seen</span>
                <span className="ml-auto font-medium tabular-nums">
                  {sensor.lastSeenAt ? formatLocalTime(sensor.lastSeenAt, loc.timezone) : "never"}
                </span>
              </div>
              {sensor.ambientTempF !== null && (
                <div className="flex items-center gap-2.5">
                  <Wind size={16} className="shrink-0 text-muted" />
                  <span className="text-muted">Air around the device</span>
                  <span className="ml-auto font-medium tabular-nums">
                    {Math.round(sensor.ambientTempF)}°F
                    {sensor.ambientHum !== null ? ` · ${Math.round(sensor.ambientHum)}%` : ""}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        <ServiceHistory unit={unit} />
      </div>
    </div>
  );
}
