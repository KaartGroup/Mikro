import { Layer, OnlineUser } from "../types";

interface LayersPanelProps {
  layers: Layer[];
  onlineUsers: OnlineUser[];
  userName: string;
  userColor: string;
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
}

export default function LayersPanel({
  layers,
  onlineUsers,
  userName,
  userColor,
  onToggle,
  onDelete,
}: LayersPanelProps) {
  return (
    <div className="absolute top-2.5 left-2.5 z-10 w-64 max-h-[calc(100%-20px)] flex flex-col rounded-lg bg-gray-900/95 text-white shadow-lg border border-gray-700 backdrop-blur">
      <div className="p-3 border-b border-gray-700 flex justify-between items-center">
        <h1 className="text-sm font-semibold">Map Viewer</h1>
        <div className="flex items-center gap-1">
          {onlineUsers.map((u, i) => (
            <div
              key={i}
              title={u.name}
              className="w-2.5 h-2.5 rounded-full border border-gray-600"
              style={{
                background: u.color,
                borderColor: u.name === userName ? "#fff" : undefined,
              }}
            />
          ))}
          <span className="text-[11px] text-gray-500 ml-1">
            {onlineUsers.length} online
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {layers.length === 0 ? (
          <p className="text-gray-500 text-sm p-4">No layers yet.</p>
        ) : (
          layers.map((layer) => (
            <div
              key={layer.id}
              className="px-4 py-2 border-b border-gray-800 flex items-center gap-2.5"
            >
              <button
                onClick={() => onToggle(layer.id)}
                title={layer.visible ? "Hide" : "Show"}
                className="w-3.5 h-3.5 rounded-sm shrink-0 cursor-pointer border-2"
                style={{
                  borderColor: layer.color,
                  background: layer.visible ? layer.color : "transparent",
                }}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{layer.name}</div>
                <div className="text-[11px] text-gray-500">
                  {layer.feature_count.toLocaleString()} features
                </div>
              </div>
              <button
                onClick={() => onDelete(layer.id)}
                title="Delete"
                className="text-gray-600 hover:text-red-400 text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>

      <div className="p-3 border-t border-gray-700">
        <p className="text-[11px] text-gray-500">
          <span style={{ color: userColor }}>●</span> {userName}
        </p>
      </div>
    </div>
  );
}
