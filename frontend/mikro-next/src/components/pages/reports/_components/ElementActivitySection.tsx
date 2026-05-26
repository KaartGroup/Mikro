"use client";

import { ElementActivityChart } from "./ElementActivityChart";
import { formatDateTime } from "./reportUtils";
import type { ElementAnalysisCategory } from "@/types";

interface ElementActivitySectionProps {
  elementCategories: ElementAnalysisCategory[];
  elementLastUpdated: string | null;
  elementLoading: boolean;
  elementRefreshing: boolean;
  elementProgress: string | null;
  showRefreshModal: boolean;
  setShowRefreshModal: (v: boolean) => void;
  onStartAnalysis: () => void;
  granularity: "weekly" | "daily";
}

export function ElementActivitySection({
  elementCategories,
  elementLastUpdated,
  elementLoading,
  elementRefreshing,
  elementProgress,
  showRefreshModal,
  setShowRefreshModal,
  onStartAnalysis,
  granularity,
}: ElementActivitySectionProps) {

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-lg font-semibold">Editing Activity by Element Type</h3>
          {elementLastUpdated && (
            <p className="text-xs text-muted-foreground">
              Last updated: {formatDateTime(elementLastUpdated)}
            </p>
          )}
          {!elementLastUpdated && !elementLoading && (
            <p className="text-xs text-muted-foreground">
              No cached data yet — click Refresh to run analysis
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {elementRefreshing && elementProgress && (
            <span className="text-xs text-muted-foreground">{elementProgress}</span>
          )}
          <button
            onClick={() => setShowRefreshModal(true)}
            disabled={elementRefreshing}
            className="inline-flex items-center px-3 py-1.5 rounded-lg bg-muted text-foreground text-sm font-medium hover:bg-muted/80 transition-colors disabled:opacity-50"
          >
            {elementRefreshing ? (
              <>
                <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-kaart-orange mr-2" />
                Analyzing...
              </>
            ) : (
              "Refresh Analysis"
            )}
          </button>
        </div>
      </div>

      {elementLoading ? (
        <div className="flex items-center justify-center h-32 gap-2">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-kaart-orange" />
          <span className="text-sm text-muted-foreground">Loading cached data...</span>
        </div>
      ) : (
        <ElementActivityChart categories={elementCategories} granularity={granularity} />
      )}

      {showRefreshModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card border border-border rounded-xl shadow-xl max-w-md mx-4 p-6">
            <h3 className="text-lg font-semibold text-foreground mb-3">
              Refresh Element Analysis
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              This will re-analyze all changesets from the OSM API for the last 4 weeks. The
              process runs in the background and typically takes 2-5 minutes depending on the
              number of active mappers and their changeset volume.
            </p>
            <p className="text-sm text-muted-foreground mb-6">
              This analysis also runs automatically every night at midnight MST.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowRefreshModal(false)}
                className="px-4 py-2 rounded-lg bg-muted text-foreground text-sm font-medium hover:bg-muted/80 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={onStartAnalysis}
                className="px-4 py-2 rounded-lg bg-kaart-orange text-white text-sm font-medium hover:bg-kaart-orange-dark transition-colors"
              >
                Start Analysis
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
