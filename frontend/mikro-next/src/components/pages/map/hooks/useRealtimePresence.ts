import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { useUser } from "@auth0/nextjs-auth0/client";
import { supabase } from "@/lib/supabase";
import { COLORS, CursorInfo, OnlineUser } from "../types";

/**
 * Owns Supabase realtime: a DB-change channel that triggers `onLayerChanged`,
 * presence (online users), and broadcasting/rendering live cursors.
 */
export function useRealtimePresence(
  map: React.RefObject<maplibregl.Map | null>,
  mapReady: boolean,
  onLayerChanged: () => void,
) {
  const { user } = useUser();
  const userName = user?.name ?? user?.email ?? "Anonymous";
  // Lazy initializer runs once per mount, giving a stable per-session color.
  const [userColor] = useState(
    () => COLORS[Math.floor(Math.random() * COLORS.length)],
  );
  // Unique per-tab identity so multiple tabs of the same user are distinct
  // presences/cursors (and a tab never echoes its own cursor back to itself).
  const [clientId] = useState(() => crypto.randomUUID());
  const roomChannel = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [cursors, setCursors] = useState<Record<string, CursorInfo>>({});

  useEffect(() => {
    const dbChannel = supabase
      .channel("db-layers")
      .on("broadcast", { event: "layer-changed" }, () => {
        onLayerChanged();
      })
      .subscribe();

    const room = supabase.channel("map-room");
    roomChannel.current = room;

    room
      .on("presence", { event: "sync" }, () => {
        const state = room.presenceState();
        const presences = Object.values(state).flat() as Record<
          string,
          string
        >[];
        setOnlineUsers(
          presences.map((p) => ({ name: p.name, color: p.color })),
        );
        // Drop cursors for tabs that are no longer present.
        const activeIds = new Set(presences.map((p) => p.id));
        setCursors((prev) => {
          const next = { ...prev };
          for (const id of Object.keys(next)) {
            if (!activeIds.has(id)) delete next[id];
          }
          return next;
        });
      })
      .on("broadcast", { event: "cursor" }, ({ payload }) => {
        if (!payload || payload.id === clientId) return;
        setCursors((prev) => ({
          ...prev,
          [payload.id]: payload as CursorInfo,
        }));
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await room.track({
            id: clientId,
            name: userName,
            color: userColor,
            online_at: new Date().toISOString(),
          });
        }
      });

    return () => {
      supabase.removeChannel(dbChannel);
      supabase.removeChannel(room);
      roomChannel.current = null;
    };
  }, [clientId, userName, userColor, onLayerChanged]);

  // Broadcast cursor (~20fps)
  useEffect(() => {
    const m = map.current;
    if (!m || !mapReady) return;
    let lastSend = 0;
    const onMouseMove = (e: maplibregl.MapMouseEvent) => {
      const now = Date.now();
      if (now - lastSend < 50) return;
      lastSend = now;
      roomChannel.current?.send({
        type: "broadcast",
        event: "cursor",
        payload: {
          id: clientId,
          name: userName,
          color: userColor,
          lng: e.lngLat.lng,
          lat: e.lngLat.lat,
        },
      });
    };
    m.on("mousemove", onMouseMove);
    return () => {
      m.off("mousemove", onMouseMove);
    };
  }, [mapReady, clientId, userName, userColor, map]);

  // Render remote cursors
  useEffect(() => {
    const m = map.current;
    if (!m || !mapReady) return;
    const src = m.getSource("cursors") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData({
      type: "FeatureCollection",
      features: Object.values(cursors).map((c) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [c.lng, c.lat] },
        properties: { color: c.color, label: c.name.split(" ")[0] },
      })),
    });
  }, [cursors, mapReady, map]);

  return { userName, userColor, onlineUsers };
}
