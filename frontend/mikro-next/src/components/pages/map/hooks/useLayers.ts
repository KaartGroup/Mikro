import { useCallback, useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { supabase } from "@/lib/supabase";
import { COLORS, Layer } from "../types";
import { syncMapLayers } from "../mapLayers";

/**
 * Owns the layer list, the per-layer GeoJSON cache, and all layer mutations
 * (upload / delete / toggle). Renders layers onto the map whenever the list or
 * map readiness changes.
 */
export function useLayers(
  map: React.RefObject<maplibregl.Map | null>,
  mapReady: boolean,
) {
  const colorMap = useRef<Map<number, string>>(new Map());
  const geojsonCache = useRef<Map<number, GeoJSON.FeatureCollection>>(
    new Map(),
  );
  const [layers, setLayers] = useState<Layer[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const assignColor = useCallback((id: number) => {
    if (!colorMap.current.has(id)) {
      colorMap.current.set(id, COLORS[colorMap.current.size % COLORS.length]);
    }
    return colorMap.current.get(id)!;
  }, []);

  const fetchLayerGeoJSON = useCallback(async (layerId: number) => {
    const res = await fetch(`/backend/layers/${layerId}/geojson`);
    if (!res.ok) return;
    const data = await res.json();
    geojsonCache.current.set(layerId, data);
  }, []);

  const fetchLayers = useCallback(async () => {
    try {
      const res = await fetch("/backend/layers/list");
      if (!res.ok) return;
      const data: Omit<Layer, "visible" | "color">[] = await res.json();

      await Promise.all(
        data
          .filter((l) => !geojsonCache.current.has(l.id))
          .map((l) => fetchLayerGeoJSON(l.id)),
      );

      const currentIds = new Set(data.map((l) => l.id));
      for (const id of geojsonCache.current.keys()) {
        if (!currentIds.has(id)) geojsonCache.current.delete(id);
      }

      setLayers((prev) =>
        data.map((l) => ({
          ...l,
          visible: prev.find((p) => p.id === l.id)?.visible ?? true,
          color: assignColor(l.id),
        })),
      );
    } catch {
      /* backend may not be running */
    }
  }, [assignColor, fetchLayerGeoJSON]);

  // Clear the cache and re-fetch — used when a realtime layer-changed event fires.
  const refetchLayers = useCallback(async () => {
    geojsonCache.current.clear();
    await fetchLayers();
  }, [fetchLayers]);

  useEffect(() => {
    fetchLayers();
  }, [fetchLayers]);

  useEffect(() => {
    if (mapReady && map.current)
      syncMapLayers(map.current, layers, geojsonCache.current);
  }, [layers, mapReady, map]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const name = file.name.replace(/\.(geojson|json)$/i, "");
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch(
        `/backend/layers/upload?name=${encodeURIComponent(name)}`,
        {
          method: "POST",
          body: form,
        },
      );
      if (!res.ok) {
        const err = await res.json();
        alert(err.message ?? "Upload failed");
        return;
      }
      const created = await res.json();
      await fetchLayerGeoJSON(created.id);
      await fetchLayers();
      supabase
        .channel("db-layers")
        .send({ type: "broadcast", event: "layer-changed", payload: {} });
    } catch {
      alert("Upload failed – is the backend running?");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const toggleLayer = (id: number) =>
    setLayers((prev) =>
      prev.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)),
    );

  const deleteLayer = async (id: number) => {
    await fetch(`/backend/layers/${id}`, { method: "DELETE" });
    geojsonCache.current.delete(id);
    setLayers((prev) => prev.filter((l) => l.id !== id));
    supabase
      .channel("db-layers")
      .send({ type: "broadcast", event: "layer-changed", payload: {} });
  };

  return {
    layers,
    uploading,
    fileInput,
    refetchLayers,
    handleUpload,
    toggleLayer,
    deleteLayer,
  };
}
