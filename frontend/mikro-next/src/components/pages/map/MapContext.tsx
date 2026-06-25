"use client";

import { createContext, useContext } from "react";
import { useMapInstance } from "./hooks/useMapInstance";
import { useLayers } from "./hooks/useLayers";
import { useRealtimePresence } from "./hooks/useRealtimePresence";

/**
 * Runs all map state hooks once and exposes their values via context so any
 * descendant can read what it needs without prop drilling. `mapContainer` is
 * still rendered by the consumer (MapViewer) since it owns the layout.
 */
type MapContextValue = ReturnType<typeof useMapInstance> &
  ReturnType<typeof useLayers> &
  ReturnType<typeof useRealtimePresence>;

const MapContext = createContext<MapContextValue | null>(null);

export function MapProvider({ children }: { children: React.ReactNode }) {
  const instance = useMapInstance();
  const layers = useLayers(instance.map, instance.mapReady);
  const presence = useRealtimePresence(
    instance.map,
    instance.mapReady,
    layers.refetchLayers,
  );

  return (
    <MapContext.Provider value={{ ...instance, ...layers, ...presence }}>
      {children}
    </MapContext.Provider>
  );
}

export function useMapContext() {
  const ctx = useContext(MapContext);
  if (!ctx) throw new Error("useMapContext must be used within a MapProvider");
  return ctx;
}
