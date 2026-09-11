"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { StandaloneFilter } from "@/components/admin/StandaloneFilter";
import type { FilterOptionsResponse } from "@/types";

export type CompletionFilter =
  | "not-started"
  | "in-progress"
  | "almost-done"
  | "complete";
export type CommunityFilter = "community" | "internal";
// Task source. "tm4" means "not MapRoulette" server-side, so projects whose
// source column predates its server_default are still matched.
export type SourceFilter = "mr" | "tm4";
export type PriorityFilter = "High" | "Medium" | "Low";
// Projects still missing a setup link: a location, a team, or either.
export type MissingAssignmentFilter = "location" | "team" | "any";

export interface ProjectFiltersValue {
  search: string;
  regionId: string | null;
  countryId: string | null;
  teamId: string | null;
  showMyProjects: boolean;
  completionFilter: CompletionFilter | null;
  communityFilter: CommunityFilter | null;
  priorityFilter: PriorityFilter | null;
  missingAssignment: MissingAssignmentFilter | null;
  sourceFilter: SourceFilter | null;
}

export const DEFAULT_FILTERS: ProjectFiltersValue = {
  search: "",
  regionId: null,
  countryId: null,
  teamId: null,
  showMyProjects: false,
  completionFilter: null,
  communityFilter: null,
  priorityFilter: null,
  missingAssignment: null,
  sourceFilter: null,
};

// Colours match the row tint and source badge on the projects table, so the
// selected button and the rows it produces read as the same thing.
const SOURCE_OPTIONS: {
  value: SourceFilter | null;
  label: string;
  title: string;
  activeClass: string;
}[] = [
  {
    value: null,
    label: "All",
    title: "All sources",
    activeClass: "bg-secondary text-secondary-foreground",
  },
  {
    value: "mr",
    label: "MR",
    title: "MapRoulette",
    activeClass: "bg-blue-500 text-white",
  },
  {
    value: "tm4",
    label: "TM4",
    title: "Tasking Manager",
    activeClass: "bg-amber-500 text-white",
  },
];

const PRIORITY_OPTIONS: { value: PriorityFilter; label: string }[] = [
  { value: "High", label: "High" },
  { value: "Medium", label: "Medium" },
  { value: "Low", label: "Low" },
];

const COMMUNITY_OPTIONS: { value: CommunityFilter; label: string }[] = [
  { value: "community", label: "Community" },
  { value: "internal", label: "Internal" },
];

const COMPLETION_OPTIONS: { value: CompletionFilter; label: string }[] = [
  { value: "not-started", label: "Not started (0%)" },
  { value: "in-progress", label: "In progress (1–49%)" },
  { value: "almost-done", label: "Almost done (50–99%)" },
  { value: "complete", label: "Complete (100%)" },
];

const MISSING_ASSIGNMENT_OPTIONS: {
  value: MissingAssignmentFilter;
  label: string;
}[] = [
  { value: "any", label: "Missing location or team" },
  { value: "location", label: "Missing location" },
  { value: "team", label: "Missing team" },
];

interface ProjectFiltersProps {
  filterOptions: FilterOptionsResponse | null;
  onChange: (filters: ProjectFiltersValue) => void;
  withTeam?: boolean;
  withMyProjects?: boolean;
  withCompletion?: boolean;
  withMissingAssignment?: boolean;
  withSource?: boolean;
}

export function ProjectFilters({
  filterOptions,
  onChange,
  withTeam,
  withMyProjects,
  withCompletion,
  withMissingAssignment,
  withSource,
}: ProjectFiltersProps) {
  const [filters, setFilters] = useState<ProjectFiltersValue>(DEFAULT_FILTERS);

  const update = (patch: Partial<ProjectFiltersValue>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    onChange(next);
  };

  return (
    /*
     * One dense row that cannot wrap.
     *
     * The stacked per-control labels are gone: each dropdown's "All …" option
     * already names its dimension, and the wrapper's title keeps it
     * discoverable on hover once a value is selected.
     *
     * Fixed widths plus flex-wrap were the problem -- at ~1200px of content
     * the last two controls dropped onto a second 40px row. The dropdowns now
     * share the leftover space (flex-1 min-w-0) instead of claiming a fixed
     * amount, so the row stays one line at any width and the controls shrink
     * together. Select truncates its value, so shrinking clips to an ellipsis
     * rather than spilling. Only the source group and the Mine toggle are
     * fixed, since neither has anything to clip.
     */
    <div className="flex items-center gap-2">
      {withSource && (
        <div
          role="group"
          aria-label="Filter by task source"
          title="Task source"
          className="flex h-10 shrink-0 items-center gap-1 rounded-lg border border-input bg-background p-1"
        >
          {SOURCE_OPTIONS.map((option) => {
            const active = filters.sourceFilter === option.value;
            return (
              <button
                key={option.label}
                type="button"
                aria-pressed={active}
                title={option.title}
                onClick={() => update({ sourceFilter: option.value })}
                className={`h-8 whitespace-nowrap rounded-md px-2.5 text-sm transition-colors ${
                  active
                    ? option.activeClass
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      )}
      <input
        type="text"
        placeholder="Search projects..."
        title="Search"
        aria-label="Search projects"
        className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
        value={filters.search}
        onChange={(e) => update({ search: e.target.value })}
      />
      <div className="min-w-0 flex-1" title="Region">
        <StandaloneFilter
          hideLabel
          label="Region"
          allLabel="All regions"
          options={(filterOptions?.dimensions?.region ?? []).map((v) =>
            typeof v === "string"
              ? { value: v, label: v }
              : { value: String(v.id ?? v.name), label: v.name },
          )}
          value={filters.regionId}
          onChange={(v) => update({ regionId: v })}
        />
      </div>
      <div className="min-w-0 flex-1" title="Country">
        <StandaloneFilter
          hideLabel
          label="Country"
          allLabel="All countries"
          options={(filterOptions?.dimensions?.country ?? []).map((v) =>
            typeof v === "string"
              ? { value: v, label: v }
              : { value: String(v.id ?? v.name), label: v.name },
          )}
          value={filters.countryId}
          onChange={(v) => update({ countryId: v })}
        />
      </div>
      <div className="min-w-0 flex-1" title="Type">
        <StandaloneFilter
          hideLabel
          label="Type"
          allLabel="All types"
          options={COMMUNITY_OPTIONS}
          value={filters.communityFilter}
          onChange={(v) =>
            update({ communityFilter: v as CommunityFilter | null })
          }
        />
      </div>
      <div className="min-w-0 flex-1" title="Priority">
        <StandaloneFilter
          hideLabel
          label="Priority"
          allLabel="All priorities"
          options={PRIORITY_OPTIONS}
          value={filters.priorityFilter}
          onChange={(v) =>
            update({ priorityFilter: v as PriorityFilter | null })
          }
        />
      </div>
      {withCompletion && (
        <div className="min-w-0 flex-1" title="Completion">
          <StandaloneFilter
            hideLabel
            label="Completion"
            allLabel="All completions"
            options={COMPLETION_OPTIONS}
            value={filters.completionFilter}
            onChange={(v) =>
              update({ completionFilter: v as CompletionFilter | null })
            }
          />
        </div>
      )}
      {withTeam && (
        <div className="min-w-0 flex-1" title="Team">
          <StandaloneFilter
            hideLabel
            label="Team"
            allLabel="All teams"
            options={(filterOptions?.dimensions?.team ?? []).map((v) =>
              typeof v === "string"
                ? { value: v, label: v }
                : { value: String(v.id ?? v.name), label: v.name },
            )}
            value={filters.teamId}
            onChange={(v) => update({ teamId: v })}
          />
        </div>
      )}
      {withMissingAssignment && (
        <div className="min-w-0 flex-1" title="Needs setup">
          <StandaloneFilter
            hideLabel
            label="Needs setup"
            allLabel="Any setup"
            options={MISSING_ASSIGNMENT_OPTIONS}
            value={filters.missingAssignment}
            onChange={(v) =>
              update({
                missingAssignment: v as MissingAssignmentFilter | null,
              })
            }
          />
        </div>
      )}
      {withMyProjects && (
        <Button
          className="shrink-0"
          title="Only projects I created"
          variant={filters.showMyProjects ? "primary" : "outline"}
          size="sm"
          onClick={() => update({ showMyProjects: !filters.showMyProjects })}
        >
          Mine
        </Button>
      )}
    </div>
  );
}
