"use client";

import { useEffect, useState } from "react";
import { Puck, Render, type Data } from "@measured/puck";
import "@measured/puck/puck.css";
import { Button } from "@/components/ui/Button";
import { useFetchReportLayout, useSaveReportLayout } from "@/hooks/useApi";
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
 * Phase 3: layouts persist server-side, per team. The backend resolves which
 * team's layout applies from the viewer (team lead → their team; org admin →
 * org-level default); a team picker for org admins is a later refinement.
 */
export function ReportsV2() {
  const reportsData = useReportsData();
  const { granularity, setGranularity, loading } = reportsData;

  const { mutate: fetchLayout } = useFetchReportLayout();
  const { mutate: saveLayout, loading: saving } = useSaveReportLayout();

  const [editing, setEditing] = useState(false);
  const [layout, setLayout] = useState<Data>(defaultReportsLayout);
  const [hydrated, setHydrated] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Load the saved layout for this viewer's team (falls back to the starter
  // layout when none is saved yet). setState happens in the async callback,
  // not synchronously in the effect body.
  useEffect(() => {
    let cancelled = false;
    fetchLayout({})
      .then((res) => {
        if (cancelled) return;
        const cfg = res?.layout?.config;
        if (cfg && typeof cfg === "object" && "content" in cfg) {
          setLayout(cfg as unknown as Data);
        }
      })
      .catch(() => {
        // Non-fatal — the starter layout is shown.
      })
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
    // fetchLayout is a non-stable mutation hook; run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePublish = async (data: Data) => {
    setSaveError(null);
    try {
      await saveLayout({ config: data });
      setLayout(data);
      setEditing(false);
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to save layout",
      );
    }
  };

  // Edit mode: the Puck builder. iframe disabled so the preview inherits our
  // Tailwind/theme styles. Wrapped in the data provider so live-data blocks
  // render inside the editor preview too.
  if (editing) {
    return (
      <div className="h-[calc(100vh-4rem)]">
        <ReportsDataProvider value={reportsData}>
          <Puck
            config={reportsConfig}
            data={layout}
            iframe={{ enabled: false }}
            headerTitle="Reports v2 — Layout Builder"
            onPublish={handlePublish}
          />
        </ReportsDataProvider>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          <strong>Reports v2</strong> is under active development. The current
          Reports page is unaffected — use it for day-to-day reporting.
        </div>
        <Button
          variant="primary"
          onClick={() => setEditing(true)}
          disabled={!hydrated || saving}
        >
          {saving ? "Saving…" : "Edit layout"}
        </Button>
      </div>

      {saveError && <p className="text-sm text-red-600">{saveError}</p>}

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
        <Render config={reportsConfig} data={layout} />
      </ReportsDataProvider>
    </div>
  );
}
