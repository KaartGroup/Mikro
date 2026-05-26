"use client";

import { Card, CardContent, CardHeader, CardTitle, Val } from "@/components/ui";
import { formatNumber } from "@/lib/utils";
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
  heatmapSummary: { totalChangesets: number; totalChanges: number; usersWithData: number } | null;
}

export function ChangesetHeatmapCard({
  heatmapPoints,
  heatmapLoading,
  heatmapSummary,
}: ChangesetHeatmapCardProps) {
  return (
    <Card data-chart-export="Changeset Heatmap">
      <CardHeader className="pb-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Map of changeset centroids</CardTitle>
          {heatmapSummary && !heatmapLoading && (
            <span className="text-xs text-muted-foreground">
              {heatmapSummary.usersWithData} users &middot;{" "}
              <Val>{formatNumber(heatmapSummary.totalChangesets)}</Val> changesets
            </span>
          )}
        </div>
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
