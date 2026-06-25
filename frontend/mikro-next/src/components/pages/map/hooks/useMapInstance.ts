import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { EMPTY_FC } from "../types";

/**
 * Creates and tears down the MapLibre instance and sets up the shared `cursors`
 * source + render layers.
 */
export function useMapInstance() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    if (!mapContainer.current) return;
    const m = new maplibregl.Map({
      container: mapContainer.current,
      style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
      center: [0, 20],
      zoom: 2,
    });
    m.addControl(new maplibregl.NavigationControl(), "top-right");
    m.on("load", () => {
      m.addSource("cursors", { type: "geojson", data: EMPTY_FC });
      m.addLayer({
        id: "cursor-dots",
        type: "circle",
        source: "cursors",
        paint: {
          "circle-color": ["get", "color"],
          "circle-radius": 8,
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 2,
        },
      });
      m.addLayer({
        id: "cursor-labels",
        type: "symbol",
        source: "cursors",
        layout: {
          "text-field": ["get", "label"],
          "text-offset": [0, 1.5],
          "text-size": 11,
          "text-anchor": "top",
        },
        paint: {
          "text-color": ["get", "color"],
          "text-halo-color": "#111827",
          "text-halo-width": 1,
        },
      });
      setMapReady(true);
    });
    map.current = m;

    // MapLibre sizes its canvas from the container's dimensions at init. If the
    // container isn't measurable yet (late layout, hot-reload, sidebar toggle),
    // the map renders blank. A ResizeObserver re-measures whenever the container
    // gains or changes size, so the canvas always fills it.
    const ro = new ResizeObserver(() => m.resize());
    ro.observe(mapContainer.current);

    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
      setMapReady(false);
    };
  }, []);

  return { mapContainer, map, mapReady };
}
