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
    if (!mapRef.current || points.length === 0) return;

    // Dynamically import leaflet.heat (only works client-side)
    import("leaflet.heat").then(() => {
      if (!mapRef.current) return;

      // Initialize map if not already
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

      // Add heat layer
      const heat = (
        L as unknown as { heatLayer: typeof L.heatLayer }
      ).heatLayer(points, {
        radius: 25,
        blur: 15,
        maxZoom: 10,
        gradient: {
          0.4: "#2563eb",
          0.6: "#f59e0b",
          0.8: "#f97316",
          1.0: "#ef4444",
        },
      });
      heat.addTo(map);

      // Fit bounds to points
      if (points.length > 0) {
        const bounds = L.latLngBounds(
          points.map(([lat, lon]) => [lat, lon] as L.LatLngTuple),
        );
        map.fitBounds(bounds, { padding: [20, 20] });
      }
    });
  }, [points]);

  useEffect(() => {
    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, []);

  if (points.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        No geographic data available for this period.
      </p>
    );
  }

  return (
    <div
      ref={mapRef}
      style={{ height, width: "100%" }}
      className="rounded-lg"
    />
  );
}
