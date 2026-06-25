import maplibregl from "maplibre-gl";
import { EMPTY_FC, Layer } from "./types";

/**
 * Reconcile the map's data layers/sources with the current `layers` list.
 * Removes stale `data-*` layers and `layer-*` sources, then (re)adds a source
 * per layer and, for visible layers, the fill/line/point render layers.
 */
export function syncMapLayers(
  map: maplibregl.Map,
  currentLayers: Layer[],
  geojsonCache: Map<number, GeoJSON.FeatureCollection>,
) {
  map
    .getStyle()
    ?.layers?.filter((l) => l.id.startsWith("data-"))
    .forEach((l) => map.removeLayer(l.id));

  const activeIds = new Set(currentLayers.map((l) => `layer-${l.id}`));
  const style = map.getStyle();
  if (style?.sources) {
    Object.keys(style.sources)
      .filter((id) => id.startsWith("layer-") && !activeIds.has(id))
      .forEach((id) => map.removeSource(id));
  }

  currentLayers.forEach((layer) => {
    const sourceId = `layer-${layer.id}`;
    const data = geojsonCache.get(layer.id) ?? EMPTY_FC;

    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, { type: "geojson", data });
    } else {
      (map.getSource(sourceId) as maplibregl.GeoJSONSource).setData(data);
    }

    if (!layer.visible) return;
    const c = layer.color;
    const f = (expr: unknown) =>
      expr as unknown as maplibregl.FilterSpecification;
    const isPoly = f([
      "match",
      ["geometry-type"],
      ["Polygon", "MultiPolygon"],
      true,
      false,
    ]);
    const isLine = f([
      "match",
      ["geometry-type"],
      ["LineString", "MultiLineString"],
      true,
      false,
    ]);
    const isPoint = f([
      "match",
      ["geometry-type"],
      ["Point", "MultiPoint"],
      true,
      false,
    ]);

    map.addLayer({
      id: `data-polygon-${layer.id}`,
      type: "fill",
      source: sourceId,
      filter: isPoly,
      paint: { "fill-color": c, "fill-opacity": 0.35 },
    });
    map.addLayer({
      id: `data-polygon-outline-${layer.id}`,
      type: "line",
      source: sourceId,
      filter: isPoly,
      paint: { "line-color": c, "line-width": 1.5 },
    });
    map.addLayer({
      id: `data-line-${layer.id}`,
      type: "line",
      source: sourceId,
      filter: isLine,
      paint: { "line-color": c, "line-width": 2.5 },
    });
    map.addLayer({
      id: `data-point-${layer.id}`,
      type: "circle",
      source: sourceId,
      filter: isPoint,
      paint: {
        "circle-color": c,
        "circle-radius": 5,
        "circle-stroke-color": "#fff",
        "circle-stroke-width": 1.5,
      },
    });
  });
}
