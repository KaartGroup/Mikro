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
}

export function ChangesetHeatmapCard({
  heatmapPoints,
  heatmapLoading,
}: ChangesetHeatmapCardProps) {
  return (
    <Card data-chart-export="Changeset Heatmap">
      <CardHeader className="pb-0">
        <CardTitle className="text-base">
          Map of changeset centroids
        </CardTitle>
      </CardHeader>
      <CardContent>
        {heatmapLoading ? (
          <div className="w-full h-48 flex items-center justify-center gap-2">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-kaart-orange" />
            <span className="text-sm text-muted-foreground">
              Fetching changesets from OSM...
            </span>
          </div>
        ) : (
          <MappingHeatmap points={heatmapPoints} height="300px" />
        )}
      </CardContent>
    </Card>
  );
}
