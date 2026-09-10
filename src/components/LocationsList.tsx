"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, AlertTriangle, CheckCircle2, MinusCircle } from "lucide-react";
import { shortAddress } from "@/lib/api";
import { StatusIcon } from "./StatusIcon";
import QimbyMark from "./QimbyMark";
import { useLiveStore, sortLocations, SortMode } from "@/store/useLiveStore";

const SORT_LABEL: Record<SortMode, string> = {
  alerts: "Alerts first",
  name: "Name",
};

function SortDropdown() {
  const sortMode = useLiveStore((s) => s.sortMode);
  const setSortMode = useLiveStore((s) => s.setSortMode);
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

function SummaryCard({
  icon,
  count,
  label,
}: {
  icon: React.ReactNode;
  count: number;
  label: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-panel p-3">
      {icon}
      <div className="mt-1.5 text-xl font-semibold leading-none tabular-nums">{count}</div>
      <div className="mt-1 text-xs text-muted">{label}</div>
    </div>
  );
}

export default function LocationsList({
  selectedId,
  className = "flex",
}: {
  selectedId?: string;
  className?: string;
}) {
  const sortMode = useLiveStore((s) => s.sortMode);
  const locations = useLiveStore((s) => s.locations);
  const summary = useLiveStore((s) => s.summary);
  const listLoaded = useLiveStore((s) => s.listLoaded);
  const listError = useLiveStore((s) => s.listError);
  const connection = useLiveStore((s) => s.connection);

  const rows = useMemo(() => sortLocations(locations, sortMode), [locations, sortMode]);

  return (
    <div
      className={`z-10 w-full min-w-0 flex-col bg-panel md:w-[320px] md:shrink-0 md:border-r md:border-line xl:w-[350px] ${className}`}
    >
      <div className="flex items-center justify-between px-4 pt-4 pb-3 md:px-5 md:pt-5">
        <div className="flex items-center gap-2.5">
          <QimbyMark size={28} className="md:hidden" />
          <h1 className="text-lg font-semibold">Locations</h1>
          {connection === "polling" && (
            <span
              title="Live updates unavailable — refreshing every 60 s"
              className="size-1.5 rounded-full bg-warn"
            />
          )}
        </div>
        <SortDropdown />
      </div>

      <div className="grid grid-cols-3 gap-2.5 px-4 pb-4 md:px-5">
        <SummaryCard icon={<AlertTriangle size={18} className="text-alert" />} count={summary.alert} label="Alerts" />
        <SummaryCard icon={<MinusCircle size={18} className="text-offline" />} count={summary.offline} label="Offline" />
        <SummaryCard icon={<CheckCircle2 size={18} className="text-ok" />} count={summary.normal} label="Normal" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-line-soft">
        {!listLoaded && (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-page" />
            ))}
          </div>
        )}

        {listLoaded && listError && (
          <div className="p-5 text-sm text-alert">
            {listError}
            <button
              onClick={() => void useLiveStore.getState().loadLocations()}
              className="mt-2 block text-accent hover:underline"
            >
              Try again
            </button>
          </div>
        )}

        {listLoaded && !listError && rows.length === 0 && (
          <div className="p-5 text-sm text-muted">
            No locations yet. Run the seed script to add them.
          </div>
        )}

        {rows.map((loc) => (
          <Link
            key={loc.id}
            href={`/locations/${loc.id}`}
            className={`flex items-center gap-3 border-b border-line-soft px-4 py-3.5 transition-colors md:px-5 md:py-3 ${
              loc.id === selectedId ? "bg-page" : "hover:bg-page/60"
            }`}
          >
            <StatusIcon status={loc.status} />
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
