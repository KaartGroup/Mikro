"use client";

import { useEffect, useState } from "react";
import { Puck, Render, type Data } from "@measured/puck";
import "@measured/puck/puck.css";
import { Button } from "@/components/ui/Button";
import { useReportsData } from "./useReportsData";
import { ReportsDataProvider } from "./ReportsDataContext";
import { reportsConfig, defaultReportsLayout } from "./blocks/registry";
import { loadLayout, saveLayout } from "./layoutStorage";

/**
 * Reports v2 — configurable/builder reports page.
 *
 * The existing /reports page (AdminReports) is intentionally UNTOUCHED and
 * remains the live page until v2 is validated by both teams
 * (see .claude/reports-v2-configurable-ui-plan.md).
 *
 * Phase 2: a team lead can toggle into an edit mode (Puck drag-and-drop
 * builder), arrange blocks, and publish — the layout is persisted to
 * localStorage. Read mode renders the saved layout via <Render>.
 * Per-team server persistence and edit-rights scoping arrive in Phase 3;
 * for now any admin who can reach the page may edit (the page is already
 * gated to admins by RoleGate).
 */
export function ReportsV2() {
  const reportsData = useReportsData();
  const { granularity, setGranularity, loading } = reportsData;

  const [editing, setEditing] = useState(false);
  const [layout, setLayout] = useState<Data>(defaultReportsLayout);
  const [hydrated, setHydrated] = useState(false);

  // Load any saved layout after mount. localStorage is client-only, so
  // hydration must happen after first render (matches the app's existing
  // AdminDashboard pattern); the setState-in-effect here is intentional.
  useEffect(() => {
    const saved = loadLayout();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved) setLayout(saved);
    setHydrated(true);
  }, []);

  const handlePublish = (data: Data) => {
    saveLayout(data);
    setLayout(data);
    setEditing(false);
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
          disabled={!hydrated}
        >
          Edit layout
        </Button>
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
        <Render config={reportsConfig} data={layout} />
      </ReportsDataProvider>
    </div>
  );
}
