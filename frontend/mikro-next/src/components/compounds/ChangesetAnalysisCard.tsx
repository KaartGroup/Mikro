"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Card, CardContent, CardHeader, CardTitle, StatCard } from "@/components/ui";
import { ChangesetTable } from "@/components/molecules/ChangesetTable";
import { HashtagSummary } from "@/components/molecules/HashtagSummary";
import { formatDateTime } from "@/lib/utils";
import type { Changeset, ChangesetSummary } from "@/types";

const MappingHeatmap = dynamic(() => import("@/components/MappingHeatmap"), {
  ssr: false,
  loading: () => (
    <div className="h-[400px] bg-muted rounded-lg animate-pulse flex items-center justify-center">
      <p className="text-sm text-muted-foreground">Loading map...</p>
    </div>
  ),
});

interface ChangesetAnalysisCardProps {
  changesets: Changeset[];
  changesetSummary: ChangesetSummary | null;
  hashtagSummary: Record<string, number>;
  changesetsLoading: boolean;
  changesetsError: string | null;
  heatmapPoints: [number, number, number][];
  osmUsername: string | undefined;
  dateLabel: string;
}

export function ChangesetAnalysisCard({
  changesets,
  changesetSummary,
  hashtagSummary,
  changesetsLoading,
  changesetsError,
  heatmapPoints,
  osmUsername,
  dateLabel,
}: ChangesetAnalysisCardProps) {
  const [changesetPage, setChangesetPage] = useState(1);
  const [followInJosm, setFollowInJosm] = useState(false);
  const [lastFollowedId, setLastFollowedId] = useState<number | null>(null);

  const exportCSV = () => {
    const header =
      "Changeset ID,Date,Changes,Added,Modified,Deleted,Comment,Hashtags\n";
    const rows = changesets
      .map(
        (c) =>
          `${c.id},"${formatDateTime(c.createdAt ?? "")}",${c.changesCount},${c.added ?? ""},${c.modified ?? ""},${c.deleted ?? ""},"${(c.comment || "").replace(/"/g, '""')}","${c.hashtags.join("; ")}"`,
      )
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${osmUsername || "user"}_changesets.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle>Changeset Analysis</CardTitle>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-muted-foreground select-none cursor-pointer">
              <input
                type="checkbox"
                checked={followInJosm}
                onChange={(e) => {
                  setFollowInJosm(e.target.checked);
                  if (!e.target.checked) setLastFollowedId(null);
                }}
                className="rounded border-input"
                title="When on, each row click zooms your running JOSM instance to that changeset"
              />
              <span>Follow in JOSM</span>
            </label>
            {changesets.length > 0 && (
              <button
                onClick={exportCSV}
                className="px-3 py-1.5 bg-muted text-muted-foreground hover:bg-muted/80 rounded-lg text-sm font-medium transition-colors"
              >
                Export CSV
              </button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {changesetsLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-kaart-orange" />
            Loading changeset data from OSM...
          </div>
        )}

        {changesetsError && !changesetsLoading && (
          <p className="text-sm text-muted-foreground text-center py-4">
            {changesetsError}
          </p>
        )}

        {changesetSummary && !changesetsLoading && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
            <StatCard
              label="Changesets"
              value={changesetSummary.totalChangesets}
            />
            <StatCard
              label="Total Changes"
              value={changesetSummary.totalChanges}
            />
            <StatCard
              label="Added"
              value={changesetSummary.totalAdded}
              sub="+ created"
            />
            <StatCard
              label="Modified"
              value={changesetSummary.totalModified}
              sub="~ edited"
            />
            <StatCard
              label="Deleted"
              value={changesetSummary.totalDeleted}
              sub="- removed"
            />
            <StatCard
              label="Nodes"
              value={changesetSummary.totalNodes}
              sub="points"
            />
            <StatCard
              label="Ways"
              value={changesetSummary.totalWays}
              sub="lines/areas"
            />
            <StatCard
              label="Relations"
              value={changesetSummary.totalRelations}
              sub="groups"
            />
          </div>
        )}

        <ChangesetTable
          changesets={changesets}
          page={changesetPage}
          setPage={setChangesetPage}
          followInJosm={followInJosm}
          lastFollowedId={lastFollowedId}
          setLastFollowedId={setLastFollowedId}
        />

        {!changesetsLoading &&
          !changesetsError &&
          changesets.length === 0 &&
          dateLabel && (
            <p className="text-sm text-muted-foreground text-center py-4">
              No changesets found for this period.
            </p>
          )}

        <HashtagSummary hashtags={hashtagSummary} />
      </CardContent>
    </Card>
  );
}

export function GeographicActivityCard({
  heatmapPoints,
  changesetsLoading,
}: {
  heatmapPoints: [number, number, number][];
  changesetsLoading: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Geographic Activity</CardTitle>
      </CardHeader>
      <CardContent>
        {changesetsLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-kaart-orange" />
            Loading geographic data...
          </div>
        ) : (
          <MappingHeatmap points={heatmapPoints} height="400px" />
        )}
      </CardContent>
    </Card>
  );
}
