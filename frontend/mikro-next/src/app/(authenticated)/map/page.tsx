"use client";

import dynamic from "next/dynamic";

const MapViewer = dynamic(() => import("@/components/pages/map/MapViewer"), {
  ssr: false,
  loading: () => (
    <div className="fullbleed-content flex items-center justify-center text-gray-400">
      Loading map…
    </div>
  ),
});

export default function MapPage() {
  return <MapViewer />;
}
