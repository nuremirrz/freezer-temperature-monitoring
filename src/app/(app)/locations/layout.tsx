"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { useSelectedLayoutSegments } from "next/navigation";
import { Map as MapIcon, List as ListIcon } from "lucide-react";
import Sidebar from "@/components/Sidebar";
import LocationsList from "@/components/LocationsList";
import LocationPanel from "@/components/LocationPanel";
import UnitPanel from "@/components/UnitPanel";
import { useLiveStore } from "@/store/useLiveStore";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

const subscribeNoop = () => () => {};

export default function LocationsLayout({ children }: { children: React.ReactNode }) {
  const segments = useSelectedLayoutSegments();
  const locationId = segments[0];
  const unitId = segments[1] === "units" ? segments[2] : undefined;

  const start = useLiveStore((s) => s.start);
  const loadLocation = useLiveStore((s) => s.loadLocation);
  const detail = useLiveStore((s) => (locationId ? s.details[locationId] : undefined));
  const detailError = useLiveStore((s) => (locationId ? s.detailError[locationId] : undefined));

  // false during SSR/hydration, true once on the client
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const [mobileMap, setMobileMap] = useState(false);

  useEffect(() => {
    start();
  }, [start]);

  useEffect(() => {
    if (locationId) void loadLocation(locationId);
  }, [locationId, loadLocation]);

  if (!mounted) return <div className="h-screen bg-page" />;

  const unit = detail?.units.find((u) => u.id === unitId);

  // Narrow viewports show one pane at a time; each breakpoint brings back the
  // pane to its left once there is room for both.
  const listClass = unitId
    ? "hidden xl:flex"
    : locationId
      ? "hidden lg:flex"
      : mobileMap
        ? "hidden md:flex"
        : "flex";

  const contentClass = !locationId && !mobileMap ? "hidden md:flex" : "flex";

  return (
    <div className="flex h-screen flex-col overflow-hidden md:flex-row">
      <Sidebar />

      <div className="flex min-h-0 flex-1 md:contents">
        <LocationsList selectedId={locationId} className={listClass} />

        <div className={`relative min-w-0 flex-1 ${contentClass}`}>
          {!unitId && <MapView selectedId={locationId} />}

          {locationId && !detail && !detailError && (
            <div className="z-10 m-4 w-full max-w-md rounded-2xl bg-page p-5">
              <div className="h-6 w-48 animate-pulse rounded bg-panel" />
              <div className="mt-4 h-20 animate-pulse rounded-xl bg-panel" />
              <div className="mt-3 h-20 animate-pulse rounded-xl bg-panel" />
            </div>
          )}

          {locationId && detailError && (
            <div className="z-10 m-4 rounded-2xl bg-panel p-5 text-sm text-alert shadow-lg">
              {detailError}
              <button
                onClick={() => void loadLocation(locationId)}
                className="mt-2 block text-accent hover:underline"
              >
                Try again
              </button>
            </div>
          )}

          {detail && (
            <LocationPanel
              loc={detail}
              selectedUnitId={unit?.id}
              compact={Boolean(unit)}
              className={unit ? "hidden xl:flex" : "flex"}
            />
          )}
          {detail && unit && <UnitPanel loc={detail} unit={unit} />}
        </div>
      </div>

      {/* Phones can't fit list and map side by side — swap between them */}
      {!locationId && (
        <button
          onClick={() => setMobileMap((m) => !m)}
          className="fixed right-4 bottom-20 z-30 flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-medium text-white shadow-lg md:hidden"
        >
          {mobileMap ? <ListIcon size={16} /> : <MapIcon size={16} />}
          {mobileMap ? "List" : "Map"}
        </button>
      )}

      {children}
    </div>
  );
}
