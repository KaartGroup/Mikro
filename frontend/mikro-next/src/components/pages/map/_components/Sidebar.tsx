import { useState } from "react";
import { Layer } from "../types";
import { useMapContext } from "../MapContext";
import UploadModal from "@/components/modals/map/uploadModal";

export default function Sidebar() {
  const { layers, onlineUsers, userName } = useMapContext();
  const [showUpload, setShowUpload] = useState(false);
  const openUpload = () => setShowUpload(true);

  return (
    <aside className="w-80 shrink-0 border-l border-gray-200 bg-white flex flex-col">
      <div className="flex items-center gap-1.5 border-b border-gray-200 px-4 py-3">
        <div className="flex items-center -space-x-1">
          {onlineUsers.map((u, i) => (
            <div
              key={i}
              title={u.name}
              className="h-2.5 w-2.5 rounded-full ring-2 ring-white shadow-sm"
              style={{
                background: u.color,
                outline: u.name === userName ? "1.5px solid #111827" : undefined,
                outlineOffset: u.name === userName ? "1px" : undefined,
              }}
            />
          ))}
        </div>
        <span className="ml-1 text-[11px] font-medium text-gray-500">
          {onlineUsers.length} online
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {layers.length === 0 ? (
          <NoLayers onAdd={openUpload} />
        ) : (
          <>
            <ExistingLayers layers={layers} />
            <div className="p-4">
              <AddDataButton onClick={openUpload} />
            </div>
          </>
        )}
      </div>

      <UploadModal isOpen={showUpload} onClose={() => setShowUpload(false)} />
    </aside>
  );
}

function AddDataButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 shadow-sm hover:bg-gray-100 hover:border-gray-400 cursor-pointer transition-colors"
    >
      <PlusIcon />
      Add data
    </button>
  );
}

function ExistingLayers({ layers }: { layers: Layer[] }) {
  const { toggleLayer, deleteLayer } = useMapContext();
  return (
    <>
      {layers.map((layer) => (
        <div
          key={layer.id}
          className="group flex items-center gap-2.5 border-b border-gray-100 px-4 py-2.5 hover:bg-gray-50 transition-colors"
        >
          <button
            onClick={() => toggleLayer(layer.id)}
            title={layer.visible ? "Hide layer" : "Show layer"}
            aria-label={layer.visible ? "Hide layer" : "Show layer"}
            className="h-4 w-4 shrink-0 cursor-pointer rounded-[4px] border-2 transition-all hover:scale-110"
            style={{
              borderColor: layer.color,
              background: layer.visible ? layer.color : "transparent",
            }}
          />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-gray-800 truncate">
              {layer.name}
            </div>
            <div className="text-[11px] text-gray-500">
              {layer.feature_count.toLocaleString()} features
            </div>
          </div>
          <button
            onClick={() => deleteLayer(layer.id)}
            title="Delete layer"
            aria-label="Delete layer"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 opacity-0 transition-colors hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 focus-visible:opacity-100 cursor-pointer"
          >
            <TrashIcon />
          </button>
        </div>
      ))}
    </>
  );
}

function NoLayers({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 p-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-400">
        <LayersIcon />
      </div>
      <div className="space-y-1">
        <h1 className="text-sm font-semibold text-gray-700">No layers yet</h1>
        <p className="text-xs text-gray-500">
          Add your first layer to get started.
        </p>
      </div>
      <AddDataButton onClick={onAdd} />
    </div>
  );
}

function TrashIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function LayersIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  );
}
