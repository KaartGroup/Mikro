"use client";

import type { Config, Data } from "@measured/puck";
import { useReportsDataContext } from "../ReportsDataContext";
import { TaskHoursByCategoryCard } from "../../_components/TaskHoursByCategoryCard";
import { TeamActivityCard } from "../../_components/TeamActivityCard";
import { CommunityOutreachCard } from "../../_components/CommunityOutreachCard";

/**
 * Reports v2 block registry.
 *
 * Each entry wraps an existing report widget (or a primitive) as a Puck
 * component. Data-driven blocks read the shared dataset from
 * ReportsDataContext instead of taking data via props, so a team lead just
 * places the block and it renders live data. New widgets are added here by
 * the same pattern (they already share the { data, granularity } prop shape).
 */

function BlockEmpty({ label }: { label: string }) {
  return (
    <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
      {label} — no data for the selected period.
    </div>
  );
}

function TaskHoursBlock() {
  const { timekeeping, granularity } = useReportsDataContext();
  if (!timekeeping) return <BlockEmpty label="Task Hours by Category" />;
  return <TaskHoursByCategoryCard data={timekeeping} granularity={granularity} />;
}

function TeamActivityBlock() {
  const { timekeeping, granularity } = useReportsDataContext();
  if (!timekeeping) return <BlockEmpty label="Team Activity" />;
  return <TeamActivityCard data={timekeeping} granularity={granularity} />;
}

function CommunityOutreachBlock() {
  const { timekeeping, granularity } = useReportsDataContext();
  if (!timekeeping) return <BlockEmpty label="Community Outreach" />;
  return <CommunityOutreachCard data={timekeeping} granularity={granularity} />;
}

export type ReportsBlockProps = {
  Heading: { text: string; level: "h2" | "h3" };
  Text: { text: string };
  TaskHoursByCategory: Record<string, never>;
  TeamActivity: Record<string, never>;
  CommunityOutreach: Record<string, never>;
};

export const reportsConfig: Config<ReportsBlockProps> = {
  components: {
    Heading: {
      label: "Heading",
      fields: {
        text: { type: "text" },
        level: {
          type: "select",
          options: [
            { label: "H2", value: "h2" },
            { label: "H3", value: "h3" },
          ],
        },
      },
      defaultProps: { text: "Section heading", level: "h2" },
      render: ({ text, level }) =>
        level === "h3" ? (
          <h3 className="text-base font-semibold text-foreground mt-2">
            {text}
          </h3>
        ) : (
          <h2 className="text-xl font-semibold text-foreground mt-2">{text}</h2>
        ),
    },
    Text: {
      label: "Text",
      fields: { text: { type: "textarea" } },
      defaultProps: { text: "Add a note…" },
      render: ({ text }) => (
        <p className="text-sm text-muted-foreground whitespace-pre-wrap">
          {text}
        </p>
      ),
    },
    TaskHoursByCategory: {
      label: "Task Hours by Category",
      render: () => <TaskHoursBlock />,
    },
    TeamActivity: {
      label: "Team Activity",
      render: () => <TeamActivityBlock />,
    },
    CommunityOutreach: {
      label: "Community Outreach",
      render: () => <CommunityOutreachBlock />,
    },
  },
};

/** Hardcoded starter layout (Phase 1). Replaced by per-team saved layouts in Phase 3. */
export const defaultReportsLayout: Data = {
  root: { props: {} },
  content: [
    { type: "Heading", props: { id: "h-intro", text: "Team Report", level: "h2" } },
    { type: "TaskHoursByCategory", props: { id: "blk-task-hours" } },
    { type: "TeamActivity", props: { id: "blk-team-activity" } },
    { type: "CommunityOutreach", props: { id: "blk-community" } },
  ],
};
