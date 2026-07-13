"use client";

import { Render } from "@measured/puck";
import "@measured/puck/puck.css";
import { useReportsData } from "./useReportsData";
import { ReportsDataProvider } from "./ReportsDataContext";
import { reportsConfig, defaultReportsLayout } from "./blocks/registry";

/**
 * Reports v2 — configurable/builder reports page.
 *
 * The existing /reports page (AdminReports) is intentionally UNTOUCHED and
 * remains the live page until v2 is validated by both teams
 * (see .claude/reports-v2-configurable-ui-plan.md).
 *
 * Phase 1: renders a hardcoded layout of real report widgets through Puck's
 * <Render>, driven by the shared useReportsData() dataset + granularity
 * toggle. The drag-and-drop builder (edit mode) and per-team saved layouts
 * arrive in Phases 2–3.
 */
export function ReportsV2() {
  const reportsData = useReportsData();
  const { granularity, setGranularity, loading } = reportsData;

  return (
    <div className="p-4 space-y-4">
      <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
        <strong>Reports v2</strong> is under active development. The current
        Reports page is unaffected — use it for day-to-day reporting.
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">View:</span>
        <div className="inline-flex rounded-md border border-input overflow-hidden">
          {(["weekly", "daily"] as const).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGranularity(g)}
              className={
                "px-3 py-1 text-sm " +
                (granularity === g
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-foreground hover:bg-accent")
              }
            >
              {g === "weekly" ? "Weekly" : "Daily"}
            </button>
          ))}
        </div>
        {loading && (
          <span className="text-xs text-muted-foreground">Loading…</span>
        )}
      </div>

      <ReportsDataProvider value={reportsData}>
        <Render config={reportsConfig} data={defaultReportsLayout} />
      </ReportsDataProvider>
    </div>
  );
}
