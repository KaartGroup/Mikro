export const COLORS = [
  "#3b82f6",
  "#ef4444",
  "#22c55e",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#f97316",
];

export const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

export interface Layer {
  id: number;
  name: string;
  created_at: string | null;
  feature_count: number;
  visible: boolean;
  color: string;
}

export interface CursorInfo {
  id: string;
  lng: number;
  lat: number;
  color: string;
  name: string;
}

export interface OnlineUser {
  name: string;
  color: string;
}
