"use client";

import { useRef, useEffect, useState } from "react";
import { ElementActivityChart } from "./ElementActivityChart";
import { formatDateTime } from "./reportUtils";
import type { ElementAnalysisCategory } from "@/types";
import { OsmClassificationPieChart } from "./OsmClassificationPieChart";

interface ElementActivitySectionProps {
  elementCategories: ElementAnalysisCategory[];
  elementLastUpdated: string | null;
  elementLoading: boolean;
  elementRefreshing: boolean;
  elementProgress: string | null;
  showRefreshModal: boolean;
  setShowRefreshModal: (v: boolean) => void;
  showBackfillModal: boolean;
  setShowBackfillModal: (v: boolean) => void;
  onStartAnalysis: () => void;
  onStartBackfill: () => void;
  granularity: "weekly" | "daily";
  extraContent?: React.ReactNode;
}

export function ElementActivitySection({
  elementCategories,
  elementLastUpdated,
  elementLoading,
  elementRefreshing,
  elementProgress,
  showRefreshModal,
  setShowRefreshModal,
  showBackfillModal,
  setShowBackfillModal,
  onStartAnalysis,
  onStartBackfill,
  granularity,
  extraContent,
}: ElementActivitySectionProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showDropdown) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showDropdown]);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-lg font-semibold">
            Editing Activity by Element Type
          </h3>
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
            <span className="text-xs text-muted-foreground">
              {elementProgress}
            </span>
          )}

          {/* Split button: main action + dropdown chevron */}
          <div ref={dropdownRef} className="relative flex">
            <button
              onClick={() => setShowRefreshModal(true)}
              disabled={elementRefreshing}
              className="inline-flex items-center px-3 py-1.5 rounded-l-lg bg-muted text-foreground text-sm font-medium hover:bg-muted/80 transition-colors disabled:opacity-50 border-r border-background"
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
            <button
              onClick={() => setShowDropdown((v) => !v)}
              disabled={elementRefreshing}
              aria-label="More analysis options"
              className="inline-flex items-center px-2 py-1.5 rounded-r-lg bg-muted text-foreground hover:bg-muted/80 transition-colors disabled:opacity-50"
            >
              <svg
                className="h-3 w-3"
                viewBox="0 0 10 6"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M0 0l5 6 5-6H0z" />
              </svg>
            </button>

            {showDropdown && (
              <div className="absolute right-0 top-full mt-1 bg-card border border-border rounded-lg shadow-lg z-10 min-w-[160px] py-1">
                <button
                  onClick={() => {
                    setShowDropdown(false);
                    setShowRefreshModal(true);
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-foreground hover:bg-muted transition-colors"
                >
                  Refresh Analysis
                </button>
                <button
                  onClick={() => {
                    setShowDropdown(false);
                    setShowBackfillModal(true);
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-foreground hover:bg-muted transition-colors"
                >
                  Run Backfill
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-row w-full gap-6">
      {elementLoading ? (
        <div className="flex flex-1 items-center justify-center h-32 gap-2">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-kaart-orange" />
          <span className="text-sm text-muted-foreground">
            Loading cached data...
          </span>
        </div>
      ) : (
        <div className="flex-1 min-w-0">
          <ElementActivityChart
            categories={elementCategories}
            granularity={granularity}
          />
        </div>
      )}
      <div className="w-72 flex-shrink-0 self-stretch">
        <OsmClassificationPieChart categories={elementCategories} />
      </div>
      </div>

      {showRefreshModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card border border-border rounded-xl shadow-xl max-w-md mx-4 p-6">
            <h3 className="text-lg font-semibold text-foreground mb-3">
              Refresh Element Analysis
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              This will re-analyze all changesets from the OSM API for the last
              4 weeks. The process runs in the background and typically takes
              2-5 minutes depending on the number of active mappers and their
              changeset volume.
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

      {showBackfillModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card border border-border rounded-xl shadow-xl max-w-md mx-4 p-6">
            <h3 className="text-lg font-semibold text-foreground mb-3">
              Run Element Analysis Backfill
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              This will fetch and analyze all changesets from the beginning of
              the project up to the latest data already stored. Use this to fill
              in gaps or rebuild historical data.
            </p>
            <p className="text-sm text-muted-foreground mb-6">
              The job runs in the background in 2-day windows and may take
              several minutes depending on the volume of historical changesets.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowBackfillModal(false)}
                className="px-4 py-2 rounded-lg bg-muted text-foreground text-sm font-medium hover:bg-muted/80 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={onStartBackfill}
                className="px-4 py-2 rounded-lg bg-kaart-orange text-white text-sm font-medium hover:bg-kaart-orange-dark transition-colors"
              >
                Start Backfill
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
