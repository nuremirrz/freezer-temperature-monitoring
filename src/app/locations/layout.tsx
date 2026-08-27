"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useSelectedLayoutSegments } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import LocationsList from "@/components/LocationsList";
import LocationPanel from "@/components/LocationPanel";
import UnitPanel from "@/components/UnitPanel";
import { getLocation, getUnit } from "@/data/locations";
import { useAppStore } from "@/store/useAppStore";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

export default function LocationsLayout({ children }: { children: React.ReactNode }) {
  const segments = useSelectedLayoutSegments();
  const locationId = segments[0];
  const unitId = segments[1] === "units" ? segments[2] : undefined;

  const loc = locationId ? getLocation(locationId) : undefined;
  const unit = loc && unitId ? getUnit(loc.id, unitId) : undefined;

  const startSimulation = useAppStore((s) => s.startSimulation);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    startSimulation();
  }, [startSimulation]);

  if (!mounted) return <div className="h-screen bg-page" />;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <LocationsList selectedId={loc?.id} />

      <div className="relative flex min-w-0 flex-1">
        {/* Map stays as the background; it is hidden when a unit is open */}
        {!unit && <MapView selectedId={loc?.id} />}

        {loc && (
          <LocationPanel loc={loc} selectedUnitId={unit?.id} compact={Boolean(unit)} />
        )}
        {loc && unit && <UnitPanel loc={loc} unit={unit} />}
      </div>

      {children}
    </div>
  );
}
