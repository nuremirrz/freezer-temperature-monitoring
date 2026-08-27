"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
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
}: {
  loc: BKLocation;
  selectedUnitId?: string;
  compact?: boolean;
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
      className={`z-10 flex min-h-0 flex-col overflow-y-auto bg-page ${
        compact ? "w-[560px] shrink-0 border-r border-line" : "m-4 w-[600px] shrink-0 rounded-2xl shadow-lg"
      }`}
    >
      <div className="flex flex-col gap-3 p-5">
        <div>
          <h2 className="text-xl font-semibold">{loc.name}</h2>
          <div className="text-sm text-muted">{shortAddress(loc)}</div>
          <div className="mt-1 text-xs text-faint">{fullAddress(loc)}</div>
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

        {/* Units table */}
        <div className="overflow-hidden rounded-xl border border-line bg-panel">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="px-4 py-2.5 font-medium">Equipment</th>
                <th className="px-2 py-2.5 font-medium">Status</th>
                <th className="px-2 py-2.5 font-medium">Temperature</th>
                <th className="px-2 py-2.5 font-medium">Normal Range</th>
                <th className="px-2 py-2.5 font-medium">Duration</th>
                <th className="w-8 px-2 py-2.5" />
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
                    <td className="px-2 py-3 whitespace-nowrap text-muted">{formatRange(u)}</td>
                    <td className="px-2 py-3 tabular-nums text-muted">
                      {u.status === "alert" && u.alertSince
                        ? formatDuration(u.alertSince)
                        : "—"}
                    </td>
                    <td className="px-2 py-3">
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
