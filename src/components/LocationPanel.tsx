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
import { BKLocation, Unit, UnitType, fullAddress, shortAddress, formatRange } from "@/data/types";
import { fetchWeather, describeWeather, WeatherInfo } from "@/data/weather";
import { useAppStore, formatDuration } from "@/store/useAppStore";
import { StatusDot, STATUS_LABEL } from "./StatusIcon";

/* ---------------------------- helpers ---------------------------- */

const TYPE_ICON: Record<UnitType, React.ComponentType<{ size?: number; className?: string }>> = {
  freezer: Refrigerator,
  "walk-in-cooler": Snowflake,
  "walk-in-freezer": Snowflake,
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

type TabKey = "all" | "freezer" | "ac" | "walkin";

function tabOf(u: Unit): Exclude<TabKey, "all"> {
  if (u.type === "ac") return "ac";
  if (u.type === "freezer") return "freezer";
  return "walkin";
}

/* ---------------------------- cards ---------------------------- */

function StatusCard({ loc }: { loc: BKLocation }) {
  const alertCount = loc.units.filter((u) => u.status === "alert").length;
  const offlineCount = loc.units.filter((u) => u.status === "offline").length;

  if (alertCount > 0) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-alert/25 bg-alert-soft p-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-alert/10">
          <Thermometer size={20} className="text-alert" />
        </div>
        <div>
          <div className="text-sm font-semibold text-ink">Temperature Alert</div>
          <div className="text-xs text-muted">
            {alertCount > 1
              ? "Multiple temperature deviations detected"
              : "1 temperature deviation detected"}
          </div>
        </div>
      </div>
    );
  }

  if (offlineCount > 0) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-line bg-offline-soft p-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-offline/15">
          <WifiOff size={20} className="text-offline" />
        </div>
        <div>
          <div className="text-sm font-semibold text-ink">Offline Units</div>
          <div className="text-xs text-muted">Some units are not reporting</div>
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

function WeatherCard({ loc }: { loc: BKLocation }) {
  const [weather, setWeather] = useState<WeatherInfo | null | "loading">("loading");

  useEffect(() => {
    let alive = true;
    setWeather("loading");
    fetchWeather(loc.lat, loc.lng).then((w) => alive && setWeather(w));
    const id = setInterval(
      () => fetchWeather(loc.lat, loc.lng).then((w) => alive && setWeather(w)),
      13 * 60_000,
    );
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [loc.id, loc.lat, loc.lng]);

  if (weather === null) return null; // hide the card on error, as per spec

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
      <div className="text-2xl font-semibold">
        {weather === "loading" ? "…" : `${weather.temp}°F`}
      </div>
    </div>
  );
}

/* ---------------------------- main panel ---------------------------- */

export default function LocationPanel({
  loc,
  selectedUnitId,
  compact = false,
  className = "flex",
}: {
  loc: BKLocation;
  selectedUnitId?: string;
  compact?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("all");
  const temps = useAppStore((s) => s.temps);
  const minuteTick = useAppStore((s) => s.minuteTick);

  const counts = useMemo(() => {
    const c = { all: loc.units.length, freezer: 0, ac: 0, walkin: 0 };
    for (const u of loc.units) c[tabOf(u)]++;
    return c;
  }, [loc]);

  const visible = tab === "all" ? loc.units : loc.units.filter((u) => tabOf(u) === tab);

  const TABS: { key: TabKey; label: string }[] = [
    { key: "all", label: `All Equipment (${counts.all})` },
    { key: "freezer", label: `Freezers (${counts.freezer})` },
    { key: "ac", label: `AC Units (${counts.ac})` },
    { key: "walkin", label: `Walk-ins (${counts.walkin})` },
  ];

  return (
    <div
      className={`@container z-10 min-h-0 w-full min-w-0 flex-1 flex-col overflow-y-auto bg-page md:flex-none ${
        compact
          ? "md:w-[400px] md:shrink-0 md:border-r md:border-line xl:w-[460px] 2xl:w-[560px]"
          : "md:m-4 md:w-[420px] md:shrink-0 md:rounded-2xl md:shadow-lg lg:w-[520px] xl:w-[600px]"
      } ${className}`}
    >
      <div className="flex flex-col gap-3 p-4 md:p-5">
        <div className="flex items-start gap-2">
          {/* The list is off-screen below lg — give it a way back */}
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
        <WeatherCard loc={loc} />

        {/* View tabs */}
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

        {/* Units, as stacked cards on phones — six columns never fit */}
        <div className="overflow-hidden rounded-xl border border-line bg-panel @md:hidden">
          {visible.map((u) => {
            const Icon = TYPE_ICON[u.type];
            const temp = temps[u.id];
            void minuteTick;
            return (
              <button
                key={u.id}
                onClick={() => router.push(`/locations/${loc.id}/units/${u.id}`)}
                className="flex w-full items-center gap-3 border-b border-line-soft px-4 py-3 text-left last:border-0"
              >
                <Icon size={18} className="shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{u.name}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                    <StatusDot status={u.status} />
                    <span
                      className={
                        u.status === "alert"
                          ? "text-alert"
                          : u.status === "offline"
                            ? "text-offline"
                            : ""
                      }
                    >
                      {STATUS_LABEL[u.status]}
                    </span>
                    <span className="text-faint">·</span>
                    <span className="whitespace-nowrap">{formatRange(u)}</span>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div
                    className={`text-sm font-semibold tabular-nums ${
                      u.status === "alert" ? "text-alert" : ""
                    }`}
                  >
                    {u.status === "offline" ? "—" : `${Math.round(temp)}°F`}
                  </div>
                  {u.status === "alert" && u.alertSince && (
                    <div className="text-xs tabular-nums text-muted">
                      {formatDuration(u.alertSince)}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Units table */}
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
                const temp = temps[u.id];
                void minuteTick; // re-render durations every minute
                return (
                  <tr
                    key={u.id}
                    onClick={() => router.push(`/locations/${loc.id}/units/${u.id}`)}
                    className={`cursor-pointer border-b border-line-soft last:border-0 transition-colors ${
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
                    <td
                      className={`px-2 py-3 font-semibold tabular-nums ${
                        u.status === "alert" ? "text-alert" : ""
                      }`}
                    >
                      {u.status === "offline" ? "—" : `${Math.round(temp)}°F`}
                    </td>
                    <td className="hidden px-2 py-3 whitespace-nowrap text-muted @lg:table-cell">
                      {formatRange(u)}
                    </td>
                    <td className="px-2 py-3 tabular-nums text-muted">
                      {u.status === "alert" && u.alertSince
                        ? formatDuration(u.alertSince)
                        : "—"}
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
        <div className="text-center text-xs text-faint">All times shown in local time</div>
      </div>
    </div>
  );
}
