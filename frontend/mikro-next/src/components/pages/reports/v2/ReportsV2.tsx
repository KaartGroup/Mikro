"use client";

import { Render, type Config, type Data } from "@measured/puck";
import "@measured/puck/puck.css";

/**
 * Reports v2 — configurable/builder reports page (Phase 0 scaffold).
 *
 * This is the new parallel reports experience. The existing /reports page
 * (AdminReports) is intentionally UNTOUCHED and remains the live page until
 * v2 is validated by both teams (see .claude/reports-v2-configurable-ui-plan.md).
 *
 * Phase 0 only proves the Puck integration builds under React 19 / Next 16 by
 * rendering a trivial config through <Render>. The real block registry (our
 * report widgets), the builder/edit mode, and per-team persistence arrive in
 * Phases 1–3.
 */

type ReportComponents = {
  HeadingBlock: { title: string };
};

const config: Config<ReportComponents> = {
  components: {
    HeadingBlock: {
      fields: { title: { type: "text" } },
      defaultProps: { title: "Heading" },
      render: ({ title }) => (
        <h2 className="text-xl font-semibold text-foreground">{title}</h2>
      ),
    },
  },
};

const placeholderData: Data = {
  content: [
    {
      type: "HeadingBlock",
      props: {
        id: "intro",
        title: "Reports v2 — configurable reports (in development)",
      },
    },
  ],
  root: { props: {} },
};

export function ReportsV2() {
  return (
    <div className="p-4 space-y-4">
      <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
        <strong>Reports v2</strong> is under active development. The current
        Reports page is unaffected — use it for day-to-day reporting.
      </div>
      <Render config={config} data={placeholderData} />
    </div>
  );
}
