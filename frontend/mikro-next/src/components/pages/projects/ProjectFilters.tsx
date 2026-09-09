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
  activeClass: string;
}[] = [
  {
    value: null,
    label: "All",
    activeClass: "bg-secondary text-secondary-foreground",
  },
  { value: "mr", label: "MapRoulette", activeClass: "bg-blue-500 text-white" },
  {
    value: "tm4",
    label: "Tasking Manager",
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
  /**
   * Totals shown against the MapRoulette / Tasking Manager buttons.
   *
   * These come from the stats endpoint, which deliberately ignores the source
   * filter, so both numbers stay put when a source is selected instead of one
   * of them dropping to zero.
   */
  mrCount?: number;
  tm4Count?: number;
}

export function ProjectFilters({
  filterOptions,
  onChange,
  withTeam,
  withMyProjects,
  withCompletion,
  withMissingAssignment,
  withSource,
  mrCount,
  tm4Count,
}: ProjectFiltersProps) {
  const [filters, setFilters] = useState<ProjectFiltersValue>(DEFAULT_FILTERS);

  const update = (patch: Partial<ProjectFiltersValue>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    onChange(next);
  };

  const sourceCount = (value: SourceFilter | null) =>
    value === "mr" ? mrCount : value === "tm4" ? tm4Count : undefined;

  return (
    <div className="flex flex-wrap items-end gap-3">
      {withSource && (
        <div className="flex flex-col">
          <label className="mb-1.5 block text-sm font-medium text-foreground">
            Source
          </label>
          <div
            role="group"
            aria-label="Filter by task source"
            className="flex h-10 items-center gap-1 rounded-lg border border-input bg-background p-1"
          >
            {SOURCE_OPTIONS.map((option) => {
              const active = filters.sourceFilter === option.value;
              const count = sourceCount(option.value);
              return (
                <button
                  key={option.label}
                  type="button"
                  aria-pressed={active}
                  onClick={() => update({ sourceFilter: option.value })}
                  className={`h-8 whitespace-nowrap rounded-md px-3 text-sm transition-colors ${
                    active
                      ? option.activeClass
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {option.label}
                  {count !== undefined && (
                    <span className="ml-1.5 opacity-70">{count}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="flex flex-col">
        <label className="mb-1.5 block text-sm font-medium text-foreground">
          Search
        </label>
        <input
          type="text"
          placeholder="Search projects..."
          className="h-10 rounded-lg border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring w-48"
          value={filters.search}
          onChange={(e) => update({ search: e.target.value })}
        />
      </div>
      <div className="w-44">
        <StandaloneFilter
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
      <div className="w-44">
        <StandaloneFilter
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
      <div className="w-40">
        <StandaloneFilter
          label="Type"
          allLabel="All types"
          options={COMMUNITY_OPTIONS}
          value={filters.communityFilter}
          onChange={(v) =>
            update({ communityFilter: v as CommunityFilter | null })
          }
        />
      </div>
      <div className="w-36">
        <StandaloneFilter
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
        <div className="w-48">
          <StandaloneFilter
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
        <div className="w-44">
          <StandaloneFilter
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
        <div className="w-52">
          <StandaloneFilter
            label="Needs setup"
            allLabel="All projects"
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
        <div className="ml-auto">
          <Button
            variant={filters.showMyProjects ? "primary" : "outline"}
            size="sm"
            onClick={() => update({ showMyProjects: !filters.showMyProjects })}
          >
            My Projects
          </Button>
        </div>
      )}
    </div>
  );
}
