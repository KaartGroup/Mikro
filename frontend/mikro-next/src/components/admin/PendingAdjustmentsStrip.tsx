"use client";

import { useEffect } from "react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useAdminPendingAdjustments } from "@/hooks";
import { formatDuration } from "@/lib/timeTracking";
import { formatDate } from "@/lib/utils";
import type { TimeEntry } from "@/types";

const ADJUSTMENT_PREFIX = "[ADJUSTMENT REQUESTED] ";

export interface PendingAdjustmentsStripProps {
  /** Optional team scope — passed through to the backend so this strip
   *  matches whatever the dashboard's Team scope dropdown is set to. */
  teamId?: number | null;
  /** Called when the admin clicks "Review & Edit" on a row. The page
   *  is expected to open its existing edit-entry modal with this entry. */
  onEdit: (entry: TimeEntry) => void;
}

/**
 * Sticky-ish "needs your attention" strip rendered above the active
 * sessions / history tables on /admin/time. Shows every pending
 * adjustment request in the admin's org (or in the selected team scope)
 * regardless of the page's current date filter, so requests can never
 * hide from the admin behind a date window or a pagination boundary.
 */
export function PendingAdjustmentsStrip({
  teamId,
  onEdit,
}: PendingAdjustmentsStripProps) {
  const { data, loading, refetch } = useAdminPendingAdjustments();

  // Re-fetch when the dashboard team scope changes, and whenever
  // anyone else on the page modifies an entry (so the row disappears
  // the moment the admin saves an adjustment).
  useEffect(() => {
    refetch(teamId ? { teamId } : undefined).catch(() => {});
  }, [teamId, refetch]);

  useEffect(() => {
    const handler = () => {
      // Small delay so the backend write commits before we re-pull.
      setTimeout(() => {
        refetch(teamId ? { teamId } : undefined).catch(() => {});
      }, 400);
    };
    window.addEventListener("clock-state-changed", handler);
    window.addEventListener("time-entry-updated", handler);
    return () => {
      window.removeEventListener("clock-state-changed", handler);
      window.removeEventListener("time-entry-updated", handler);
    };
  }, [teamId, refetch]);

  const entries = data?.entries ?? [];

  if (loading && entries.length === 0) {
    // Stay quiet during the initial fetch — most days there are zero
    // pending adjustments and rendering a loading skeleton would
    // create visual noise above the actual page content.
    return null;
  }

  if (entries.length === 0) {
    return null;
  }

  return (
    <Card
      id="pending-adjustments"
      className="border-destructive/50 bg-destructive/5 scroll-mt-20"
    >
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inset-0 rounded-full bg-red-500 opacity-75 animate-ping" />
            <span className="relative rounded-full bg-red-600 h-2.5 w-2.5" />
          </span>
          <h2 className="text-sm font-semibold">Pending adjustment requests</h2>
          <Badge variant="destructive" className="text-xs">
            {entries.length}
          </Badge>
        </div>

        <div className="space-y-2">
          {entries.map((entry) => {
            const reason = entry.notes?.startsWith(ADJUSTMENT_PREFIX)
              ? entry.notes.slice(ADJUSTMENT_PREFIX.length).trim()
              : "(no reason given)";
            return (
              <div
                key={entry.id}
                className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-background p-3 text-sm"
              >
                <div className="flex flex-col min-w-[140px]">
                  <span className="font-medium">{entry.userName || "—"}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(entry.clockIn)}
                  </span>
                </div>
                <div className="flex flex-col min-w-[140px]">
                  <span className="text-muted-foreground text-xs uppercase tracking-wide">
                    {entry.category || "—"}
                  </span>
                  <span className="text-xs">{entry.projectName || "—"}</span>
                </div>
                <div className="text-xs font-mono">
                  {formatDuration(entry.durationSeconds)}
                </div>
                <div className="flex-1 min-w-[200px] max-w-[480px] text-xs italic text-muted-foreground">
                  &ldquo;{reason}&rdquo;
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => onEdit(entry)}
                  className="ml-auto whitespace-nowrap"
                >
                  Review &amp; Edit
                </Button>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
