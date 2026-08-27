"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { MapContainer, TileLayer, Marker } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { LOCATIONS } from "@/data/locations";
import { locationStatus, LocationStatus } from "@/data/types";

const STATUS_COLOR: Record<LocationStatus, string> = {
  normal: "#16a34a",
  alert: "#e5484d",
  offline: "#98a2b3",
};

const GLYPH: Record<LocationStatus, string> = {
  normal:
    '<path d="M4.5 9.5l3 3 6-6.5" stroke="white" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  alert:
    '<path d="M9 4.5v5.5" stroke="white" stroke-width="2.2" stroke-linecap="round"/><circle cx="9" cy="13" r="1.4" fill="white"/>',
  offline:
    '<path d="M4.5 9h9" stroke="white" stroke-width="2.2" stroke-linecap="round"/>',
};

function markerIcon(status: LocationStatus, selected: boolean) {
  const size = selected ? 34 : 26;
  const color = STATUS_COLOR[status];
  const ring = selected
    ? `box-shadow:0 0 0 4px ${color}33, 0 2px 6px rgba(16,24,40,.35);`
    : "box-shadow:0 2px 6px rgba(16,24,40,.3);";
  return L.divIcon({
    className: "map-marker",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${color};border:2.5px solid #fff;${ring}display:flex;align-items:center;justify-content:center;">
      <svg width="${size * 0.62}" height="${size * 0.62}" viewBox="0 0 18 18">${GLYPH[status]}</svg>
    </div>`,
  });
}

export default function MapView({ selectedId }: { selectedId?: string }) {
  const router = useRouter();

  const markers = useMemo(
    () =>
      LOCATIONS.map((loc) => ({
        loc,
        status: locationStatus(loc),
      })),
    [],
  );

  return (
    <div className="absolute inset-0 z-0">
      <MapContainer
        center={[40.8, -74.09]}
        zoom={11}
        zoomControl={true}
        attributionControl={false}
        className="h-full w-full"
      >
        {/* CARTO Positron-style light basemap; Stadia serves it keyless on localhost */}
        <TileLayer url="https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png" />
        {markers.map(({ loc, status }) => (
          <Marker
            key={loc.id}
            position={[loc.lat, loc.lng]}
            icon={markerIcon(status, loc.id === selectedId)}
            zIndexOffset={status === "alert" ? 200 : status === "offline" ? 100 : 0}
            eventHandlers={{ click: () => router.push(`/locations/${loc.id}`) }}
          />
        ))}
      </MapContainer>

      {/* Legend */}
      <div className="absolute right-4 bottom-4 z-[1000] rounded-xl bg-panel/95 px-4 py-3 shadow-md">
        <div className="flex flex-col gap-2 text-xs font-medium text-ink-soft">
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-ok" /> Normal
          </div>
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-alert" /> Alert
          </div>
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-offline" /> Offline
          </div>
        </div>
      </div>
    </div>
  );
}
