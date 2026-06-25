"use client";

import { useMapInstance } from "./hooks/useMapInstance";
import { useLayers } from "./hooks/useLayers";
import { useRealtimePresence } from "./hooks/useRealtimePresence";
import LayersPanel from "./_components/LayersPanel";
import UploadButton from "./_components/UploadButton";

export default function MapViewer() {
  const { mapContainer, map, mapReady } = useMapInstance();
  const {
    layers,
    uploading,
    fileInput,
    refetchLayers,
    handleUpload,
    toggleLayer,
    deleteLayer,
  } = useLayers(map, mapReady);
  const { userName, userColor, onlineUsers } = useRealtimePresence(
    map,
    mapReady,
    refetchLayers,
  );

  return (
    <div className="fullbleed-content">
      <div ref={mapContainer} className="absolute inset-0 h-full w-full" />

      <LayersPanel
        layers={layers}
        onlineUsers={onlineUsers}
        userName={userName}
        userColor={userColor}
        onToggle={toggleLayer}
        onDelete={deleteLayer}
      />

      <UploadButton
        uploading={uploading}
        fileInput={fileInput}
        onUpload={handleUpload}
      />
    </div>
  );
}
