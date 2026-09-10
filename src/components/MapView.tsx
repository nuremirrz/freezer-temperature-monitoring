"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { MapContainer, TileLayer, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { LocationStatus } from "@/lib/api";
import { useLiveStore } from "@/store/useLiveStore";

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
  offline: '<path d="M4.5 9h9" stroke="white" stroke-width="2.2" stroke-linecap="round"/>',
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

/** Leaflet renders blank when its container was hidden while sizing. */
function AutoResize() {
  const map = useMap();
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map]);
  return null;
}

function FlyToSelected({ selectedId }: { selectedId?: string }) {
  const map = useMap();
  const locations = useLiveStore((s) => s.locations);
  useEffect(() => {
    const loc = locations.find((l) => l.id === selectedId);
    if (!loc) return;
    // Offset the centre so the marker clears the floating panel on wide viewports
    const zoom = Math.max(map.getZoom(), 12);
    const offset = map.getSize().x >= 768 ? 230 : 0;
    const point = map.project([loc.lat, loc.lng], zoom).subtract(L.point(offset, 0));
    map.flyTo(map.unproject(point, zoom), zoom, { duration: 0.8 });
  }, [selectedId, locations, map]);
  return null;
}

/** Fits all pins on first load, so any set of locations is visible without panning. */
function FitAll({ enabled }: { enabled: boolean }) {
  const map = useMap();
  const locations = useLiveStore((s) => s.locations);
  useEffect(() => {
    if (!enabled || locations.length === 0) return;
    const bounds = L.latLngBounds(locations.map((l) => [l.lat, l.lng] as [number, number]));
    map.fitBounds(bounds, { padding: [70, 70], maxZoom: 12 });
  }, [enabled, locations, map]);
  return null;
}

export default function MapView({ selectedId }: { selectedId?: string }) {
  const router = useRouter();
  const locations = useLiveStore((s) => s.locations);

  return (
    <div className="absolute inset-0 z-0">
      <MapContainer
        center={[40.8, -74.09]}
        zoom={11}
        zoomControl
        attributionControl={false}
        className="h-full w-full"
      >
        {/* Positron-style light basemap: Esri Light Gray Canvas, free and key-less */}
        <TileLayer
          url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
          maxNativeZoom={16}
          maxZoom={18}
        />
        <TileLayer
          url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}"
          maxNativeZoom={16}
          maxZoom={18}
        />
        <FitAll enabled={!selectedId} />
        <FlyToSelected selectedId={selectedId} />
        <AutoResize />

        {locations.map((loc) => (
          <Marker
            key={loc.id}
            position={[loc.lat, loc.lng]}
            icon={markerIcon(loc.status, loc.id === selectedId)}
            zIndexOffset={loc.status === "alert" ? 200 : loc.status === "offline" ? 100 : 0}
            eventHandlers={{ click: () => router.push(`/locations/${loc.id}`) }}
          />
        ))}
      </MapContainer>

      {/* Legend — top-right on phones so it clears the map/list toggle */}
      <div className="absolute top-4 right-4 z-[1000] rounded-xl bg-panel/95 px-3 py-2 shadow-md md:top-auto md:bottom-4 md:px-4 md:py-3">
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
