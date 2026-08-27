"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, AlertTriangle, CheckCircle2, MinusCircle } from "lucide-react";
import { LOCATIONS } from "@/data/locations";
import { locationStatus, shortAddress, LocationStatus } from "@/data/types";
import { StatusIcon } from "./StatusIcon";
import { useAppStore, SortMode } from "@/store/useAppStore";

const STATUS_ORDER: Record<LocationStatus, number> = { alert: 0, offline: 1, normal: 2 };

const SORT_LABEL: Record<SortMode, string> = {
  alerts: "Alerts first",
  name: "Name",
};

function SortDropdown() {
  const { sortMode, setSortMode } = useAppStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-sm text-muted transition-colors hover:text-ink"
      >
        Sort: <span className="font-medium text-ink-soft">{SORT_LABEL[sortMode]}</span>
        <ChevronDown size={15} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1.5 w-36 overflow-hidden rounded-lg border border-line bg-panel py-1 shadow-lg">
          {(Object.keys(SORT_LABEL) as SortMode[]).map((m) => (
            <button
              key={m}
              onClick={() => {
                setSortMode(m);
                setOpen(false);
              }}
              className={`block w-full px-3 py-1.5 text-left text-sm transition-colors hover:bg-page ${
                m === sortMode ? "font-medium text-ink" : "text-muted"
              }`}
            >
              {SORT_LABEL[m]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function LocationsList({ selectedId }: { selectedId?: string }) {
  const sortMode = useAppStore((s) => s.sortMode);

  const rows = useMemo(() => {
    const withStatus = LOCATIONS.map((loc) => ({ loc, status: locationStatus(loc) }));
    if (sortMode === "alerts") {
      withStatus.sort(
        (a, b) =>
          STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
          a.loc.storeNumber - b.loc.storeNumber,
      );
    } else {
      withStatus.sort((a, b) => a.loc.storeNumber - b.loc.storeNumber);
    }
    return withStatus;
  }, [sortMode]);

  const counts = useMemo(() => {
    const c = { alert: 0, offline: 0, normal: 0 };
    for (const loc of LOCATIONS) c[locationStatus(loc)]++;
    return c;
  }, []);

  return (
    <div className="z-10 flex w-[350px] shrink-0 flex-col border-r border-line bg-panel">
      <div className="flex items-center justify-between px-5 pt-5 pb-3">
        <h1 className="text-lg font-semibold">Locations</h1>
        <SortDropdown />
      </div>

      {/* Summary cards — counted from the real data */}
      <div className="grid grid-cols-3 gap-2.5 px-5 pb-4">
        <div className="rounded-xl border border-line bg-panel p-3">
          <AlertTriangle size={18} className="text-alert" />
          <div className="mt-1.5 text-xl font-semibold leading-none">{counts.alert}</div>
          <div className="mt-1 text-xs text-muted">Alerts</div>
        </div>
        <div className="rounded-xl border border-line bg-panel p-3">
          <MinusCircle size={18} className="text-offline" />
          <div className="mt-1.5 text-xl font-semibold leading-none">{counts.offline}</div>
          <div className="mt-1 text-xs text-muted">Offline</div>
        </div>
        <div className="rounded-xl border border-line bg-panel p-3">
          <CheckCircle2 size={18} className="text-ok" />
          <div className="mt-1.5 text-xl font-semibold leading-none">{counts.normal}</div>
          <div className="mt-1 text-xs text-muted">Normal</div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-line-soft">
        {rows.map(({ loc, status }) => (
          <Link
            key={loc.id}
            href={`/locations/${loc.id}`}
            className={`flex items-center gap-3 border-b border-line-soft px-5 py-3 transition-colors ${
              loc.id === selectedId ? "bg-page" : "hover:bg-page/60"
            }`}
          >
            <StatusIcon status={status} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{loc.name}</div>
              <div className="truncate text-xs text-muted">{shortAddress(loc)}</div>
            </div>
            <ChevronRight size={16} className="shrink-0 text-faint" />
          </Link>
        ))}
      </div>
    </div>
  );
}
