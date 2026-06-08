"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import dynamic from "next/dynamic";

const MappingHeatmap = dynamic(() => import("@/components/MappingHeatmap"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-48 bg-muted rounded-lg animate-pulse flex items-center justify-center">
      <p className="text-sm text-muted-foreground">Loading map...</p>
    </div>
  ),
});

interface ChangesetHeatmapCardProps {
  heatmapPoints: [number, number, number][];
  heatmapLoading: boolean;
  className?: string;
}

export function ChangesetHeatmapCard({
  heatmapPoints,
  heatmapLoading,
  className,
}: ChangesetHeatmapCardProps) {
  return (
    <Card
      data-chart-export="Changeset Heatmap"
      className={`flex flex-col isolate ${className ?? ""}`}
    >
      <CardHeader className="pb-0 flex-shrink-0">
        <CardTitle className="text-base">
          Map of changeset centroids
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 relative p-0 min-h-0">
        {heatmapLoading ? (
          <div className="absolute inset-0 flex items-center justify-center gap-2">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-kaart-orange" />
            <span className="text-sm text-muted-foreground">
              Fetching changesets from OSM...
            </span>
          </div>
        ) : (
          <div className="absolute inset-0">
            <MappingHeatmap points={heatmapPoints} height="100%" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
