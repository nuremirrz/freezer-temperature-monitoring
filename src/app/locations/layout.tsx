"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { useSelectedLayoutSegments } from "next/navigation";
import { Map as MapIcon, List as ListIcon } from "lucide-react";
import Sidebar from "@/components/Sidebar";
import LocationsList from "@/components/LocationsList";
import LocationPanel from "@/components/LocationPanel";
import UnitPanel from "@/components/UnitPanel";
import { getLocation, getUnit } from "@/data/locations";
import { useAppStore } from "@/store/useAppStore";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

const subscribeNoop = () => () => {};

export default function LocationsLayout({ children }: { children: React.ReactNode }) {
  const segments = useSelectedLayoutSegments();
  const locationId = segments[0];
  const unitId = segments[1] === "units" ? segments[2] : undefined;

  const loc = locationId ? getLocation(locationId) : undefined;
  const unit = loc && unitId ? getUnit(loc.id, unitId) : undefined;

  const startSimulation = useAppStore((s) => s.startSimulation);
  // false during SSR/hydration, true once on the client
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const [mobileMap, setMobileMap] = useState(false);

  useEffect(() => {
    startSimulation();
  }, [startSimulation]);

  if (!mounted) return <div className="h-screen bg-page" />;

  // Narrow viewports show one pane at a time; each breakpoint brings back the
  // pane to its left once there is room for both.
  const listClass = unit
    ? "hidden xl:flex"
    : loc
      ? "hidden lg:flex"
      : mobileMap
        ? "hidden md:flex"
        : "flex";

  const contentClass = !loc && !mobileMap ? "hidden md:flex" : "flex";

  return (
    <div className="flex h-screen flex-col overflow-hidden md:flex-row">
      <Sidebar />

      <div className="flex min-h-0 flex-1 md:contents">
        <LocationsList selectedId={loc?.id} className={listClass} />

        <div className={`relative min-w-0 flex-1 ${contentClass}`}>
          {!unit && <MapView selectedId={loc?.id} />}

          {loc && (
            <LocationPanel
              loc={loc}
              selectedUnitId={unit?.id}
              compact={Boolean(unit)}
              className={unit ? "hidden xl:flex" : "flex"}
            />
          )}
          {loc && unit && <UnitPanel loc={loc} unit={unit} />}
        </div>
      </div>

      {/* Phones can't fit list and map side by side — swap between them */}
      {!loc && (
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
