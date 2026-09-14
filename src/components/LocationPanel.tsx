"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Thermometer,
  CheckCircle2,
  WifiOff,
  EllipsisVertical,
  Refrigerator,
  Snowflake,
  AirVent,
  Sun,
  CloudSun,
  Cloud,
  CloudFog,
  CloudDrizzle,
  CloudRain,
  CloudSnow,
  CloudLightning,
} from "lucide-react";
import {
  LocationDetail,
  UnitDetail,
  UnitType,
  STATUS_LABEL,
  shortAddress,
  fullAddress,
  formatRange,
  formatTemp,
  isOutOfRange,
  formatDuration,
  formatAge,
} from "@/lib/api";
import { fetchWeather, describeWeather, WeatherInfo } from "@/data/weather";
import { useLiveStore } from "@/store/useLiveStore";
import { StatusDot } from "./StatusIcon";

const TYPE_ICON: Record<UnitType, React.ComponentType<{ size?: number; className?: string }>> = {
  freezer: Refrigerator,
  walk_in_cooler: Snowflake,
  walk_in_freezer: Snowflake,
  ac: AirVent,
};

const WEATHER_ICON = {
  sun: Sun,
  "sun-cloud": CloudSun,
  cloud: Cloud,
  fog: CloudFog,
  drizzle: CloudDrizzle,
  rain: CloudRain,
  snow: CloudSnow,
  storm: CloudLightning,
} as const;

type TabKey = "all" | "ac" | "walkin";

/**
 * A standalone `freezer` had its own tab, which read as a lie at BK6816: the restaurant has a
 * walk-in freezer, so "Freezers (0)" looked like a fault rather than a category nobody there
 * uses. Both walk-ins now sit under one tab.
 */
function tabOf(u: UnitDetail): Exclude<TabKey, "all"> {
  return u.type === "ac" ? "ac" : "walkin";
}

function StatusCard({ loc }: { loc: LocationDetail }) {
  const alerts = loc.units.filter((u) => u.status === "alert").length;
  const offline = loc.units.filter((u) => u.status === "offline").length;

  if (alerts > 0) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-alert/25 bg-alert-soft p-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-alert/10">
          <Thermometer size={20} className="text-alert" />
        </div>
        <div>
          <div className="text-sm font-semibold text-ink">Temperature Alert</div>
          <div className="text-xs text-muted">
            {alerts > 1 ? "Multiple temperature deviations detected" : "1 temperature deviation detected"}
          </div>
        </div>
      </div>
    );
  }

  if (offline > 0) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-line bg-offline-soft p-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-offline/15">
          <WifiOff size={20} className="text-offline" />
        </div>
        <div>
          <div className="text-sm font-semibold text-ink">Offline Units</div>
          <div className="text-xs text-muted">
            {offline === loc.units.length
              ? "No sensor at this location is reporting"
              : "Some units are not reporting"}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-xl border border-ok/25 bg-ok-soft p-4">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-ok/10">
        <CheckCircle2 size={20} className="text-ok" />
      </div>
      <div>
        <div className="text-sm font-semibold text-ink">All Systems Normal</div>
        <div className="text-xs text-muted">All equipment operating within range</div>
      </div>
    </div>
  );
}

function WeatherCard({ loc }: { loc: LocationDetail }) {
  const [weather, setWeather] = useState<WeatherInfo | null | "loading">("loading");

  useEffect(() => {
    let alive = true;
    fetchWeather(loc.lat, loc.lng).then((w) => alive && setWeather(w));
    const id = setInterval(
      () => fetchWeather(loc.lat, loc.lng).then((w) => alive && setWeather(w)),
      13 * 60_000,
    );
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [loc.lat, loc.lng]);

  if (weather === null) return null; // hide on error rather than show a broken card

  const desc = weather !== "loading" ? describeWeather(weather.code) : null;
  const Icon = desc ? WEATHER_ICON[desc.icon] : Cloud;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-panel p-4">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent/10">
        <Icon size={20} className="text-accent" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted">Outdoor Temperature</div>
        <div className="text-sm font-semibold text-ink">
          {desc ? desc.label : "—"} · {loc.city}
        </div>
      </div>
      <div className="text-2xl font-semibold">{weather === "loading" ? "…" : `${weather.temp}°F`}</div>
    </div>
  );
}

function UnitTemp({ u }: { u: UnitDetail }) {
  if (!u.lastReading) return <span className="text-offline">—</span>;
  const bad = isOutOfRange(u.lastReading.tempF, u);
  return <span className={bad ? "text-alert" : ""}>{formatTemp(u.lastReading.tempF)}</span>;
}

export default function LocationPanel({
  loc,
  selectedUnitId,
  compact = false,
  className = "flex",
}: {
  loc: LocationDetail;
  selectedUnitId?: string;
  compact?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("all");
  const minuteTick = useLiveStore((s) => s.minuteTick);
  void minuteTick; // re-render durations and "x min ago" every minute

  const counts = useMemo(() => {
    const c = { all: loc.units.length, ac: 0, walkin: 0 };
    for (const u of loc.units) c[tabOf(u)]++;
    return c;
  }, [loc]);

  const visible = tab === "all" ? loc.units : loc.units.filter((u) => tabOf(u) === tab);

  const TABS: { key: TabKey; label: string }[] = [
    { key: "all", label: `All Equipment (${counts.all})` },
    { key: "walkin", label: `Walk-ins (${counts.walkin})` },
    { key: "ac", label: `AC Units (${counts.ac})` },
  ];

  const openUnit = (id: string) => router.push(`/locations/${loc.id}/units/${id}`);

  return (
    <div
      className={`@container z-10 min-h-0 w-full min-w-0 flex-1 flex-col overflow-y-auto bg-page md:flex-none ${
        compact
          ? "md:w-[400px] md:shrink-0 md:border-r md:border-line 2xl:w-[560px]"
          : "md:m-4 md:w-[420px] md:shrink-0 md:rounded-2xl md:shadow-lg lg:w-[520px] xl:w-[600px]"
      } ${className}`}
    >
      <div className="flex flex-col gap-3 p-4 md:p-5">
        <div className="flex items-start gap-2">
          <Link
            href="/locations"
            title="Back to locations"
            className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-offline-soft hover:text-ink lg:hidden"
          >
            <ArrowLeft size={18} />
          </Link>
          <div className="min-w-0">
            <h2 className="text-xl font-semibold">{loc.name}</h2>
            <div className="text-sm text-muted">{shortAddress(loc)}</div>
            <div className="mt-1 text-xs text-faint">{fullAddress(loc)}</div>
          </div>
        </div>

        <StatusCard loc={loc} />
        <WeatherCard key={loc.id} loc={loc} />

        <div className="mt-1 flex flex-wrap gap-1.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === t.key
                  ? "bg-primary text-white"
                  : "border border-line bg-panel text-muted hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Units, as stacked cards on narrow panels — six columns never fit */}
        <div className="overflow-hidden rounded-xl border border-line bg-panel @md:hidden">
          {visible.map((u) => {
            const Icon = TYPE_ICON[u.type];
            return (
              <button
                key={u.id}
                onClick={() => openUnit(u.id)}
                className="flex w-full items-center gap-3 border-b border-line-soft px-4 py-3 text-left last:border-0"
              >
                <Icon size={18} className="shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{u.name}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                    <StatusDot status={u.status} />
                    <span
                      className={
                        u.status === "alert" ? "text-alert" : u.status === "offline" ? "text-offline" : ""
                      }
                    >
                      {STATUS_LABEL[u.status]}
                    </span>
                    <span className="text-faint">·</span>
                    <span className="whitespace-nowrap">{formatRange(u)}</span>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-semibold tabular-nums">
                    <UnitTemp u={u} />
                  </div>
                  {u.activeAlert && (
                    <div className="text-xs tabular-nums text-muted">
                      {formatDuration(u.activeAlert.openedAt)}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Units table when there is room */}
        <div className="hidden overflow-hidden rounded-xl border border-line bg-panel @md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="px-4 py-2.5 font-medium">Equipment</th>
                <th className="px-2 py-2.5 font-medium">Status</th>
                <th className="px-2 py-2.5 font-medium">Temperature</th>
                <th className="hidden px-2 py-2.5 font-medium @lg:table-cell">Normal Range</th>
                <th className="px-2 py-2.5 font-medium">Duration</th>
                <th className="hidden w-8 px-2 py-2.5 @xl:table-cell" />
              </tr>
            </thead>
            <tbody>
              {visible.map((u) => {
                const Icon = TYPE_ICON[u.type];
                return (
                  <tr
                    key={u.id}
                    onClick={() => openUnit(u.id)}
                    className={`cursor-pointer border-b border-line-soft transition-colors last:border-0 ${
                      u.id === selectedUnitId ? "bg-page" : "hover:bg-page/60"
                    }`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Icon size={17} className="shrink-0 text-muted" />
                        <span className="font-medium">{u.name}</span>
                      </div>
                    </td>
                    <td className="px-2 py-3">
                      <div className="flex items-center gap-1.5">
                        <StatusDot status={u.status} />
                        <span
                          className={
                            u.status === "alert"
                              ? "text-alert"
                              : u.status === "offline"
                                ? "text-offline"
                                : "text-ink-soft"
                          }
                        >
                          {STATUS_LABEL[u.status]}
                        </span>
                      </div>
                    </td>
                    <td className="px-2 py-3 font-semibold tabular-nums">
                      <UnitTemp u={u} />
                    </td>
                    <td className="hidden px-2 py-3 whitespace-nowrap text-muted @lg:table-cell">
                      {formatRange(u)}
                    </td>
                    <td className="px-2 py-3 tabular-nums text-muted">
                      {u.activeAlert ? formatDuration(u.activeAlert.openedAt) : "—"}
                    </td>
                    <td className="hidden px-2 py-3 @xl:table-cell">
                      <EllipsisVertical size={15} className="text-faint" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <LastUpdate loc={loc} />
      </div>
    </div>
  );
}

/** Honest footer: when the freshest reading at this location arrived. */
function LastUpdate({ loc }: { loc: LocationDetail }) {
  const minuteTick = useLiveStore((s) => s.minuteTick);
  void minuteTick;

  const latest = loc.units
    .map((u) => u.lastReading?.measuredAt)
    .filter(Boolean)
    .sort()
    .at(-1);

  return (
    <div className="text-center text-xs text-faint">
      {latest ? `Last reading ${formatAge(latest)} · times in local time` : "No readings yet"}
    </div>
  );
}
