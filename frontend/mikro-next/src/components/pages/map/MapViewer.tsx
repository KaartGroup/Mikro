"use client";

import { MapProvider, useMapContext } from "./MapContext";
import Sidebar from "./_components/Sidebar";

function MapViewerInner() {
  const { mapContainer } = useMapContext();

  return (
    <div className="fullbleed-content flex">
      <div className="relative flex-1">
        <div ref={mapContainer} className="absolute inset-0 h-full w-full" />
      </div>

      <Sidebar />
    </div>
  );
}

export default function MapViewer() {
  return (
    <MapProvider>
      <MapViewerInner />
    </MapProvider>
  );
}
