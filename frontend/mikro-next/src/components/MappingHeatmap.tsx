"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface MappingHeatmapProps {
  points: [number, number, number][];
  height?: string;
}

export default function MappingHeatmap({
  points,
  height = "400px",
}: MappingHeatmapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapRef.current) return;

    import("leaflet.heat").then(() => {
      if (!mapRef.current) return;

      if (!mapInstance.current) {
        mapInstance.current = L.map(mapRef.current).setView([0, 0], 2);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "&copy; OpenStreetMap contributors",
          maxZoom: 18,
        }).addTo(mapInstance.current);
      }

      const map = mapInstance.current;

      // Clear existing heat layers
      map.eachLayer((layer) => {
        if (!(layer instanceof L.TileLayer)) map.removeLayer(layer);
      });

      if (points.length === 0) return;

      const heat = (
        L as unknown as { heatLayer: typeof L.heatLayer }
      ).heatLayer(points, {
        radius: 12,
        blur: 8,
        maxZoom: 18,
        gradient: {
          0.4: "#2563eb",
          0.6: "#f59e0b",
          0.8: "#f97316",
          1.0: "#ef4444",
        },
      });
      heat.addTo(map);

      const bounds = L.latLngBounds(
        points.map(([lat, lon]) => [lat, lon] as L.LatLngTuple),
      );
      map.fitBounds(bounds, { padding: [20, 20] });
    });
  }, [points]);

  useEffect(() => {
    if (!mapRef.current || !mapInstance.current) return;
    const observer = new ResizeObserver(() => {
      mapInstance.current?.invalidateSize();
    });
    observer.observe(mapRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, []);

  return (
    <div
      ref={mapRef}
      style={{ height, width: "100%" }}
      className="rounded-lg"
    />
  );
}
