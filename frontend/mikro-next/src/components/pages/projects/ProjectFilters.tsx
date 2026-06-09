"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { StandaloneFilter } from "@/components/admin/StandaloneFilter";
import type { FilterOptionsResponse } from "@/types";

export type CompletionFilter = "not-started" | "in-progress" | "almost-done" | "complete";
export type CommunityFilter = "community" | "internal";
export type PriorityFilter = "High" | "Medium" | "Low";

export interface ProjectFiltersValue {
  search: string;
  regionId: string | null;
  countryId: string | null;
  teamId: string | null;
  showMyProjects: boolean;
  completionFilter: CompletionFilter | null;
  communityFilter: CommunityFilter | null;
  priorityFilter: PriorityFilter | null;
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
};

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

interface ProjectFiltersProps {
  filterOptions: FilterOptionsResponse | null;
  onChange: (filters: ProjectFiltersValue) => void;
  withTeam?: boolean;
  withMyProjects?: boolean;
  withCompletion?: boolean;
}

export function ProjectFilters({
  filterOptions,
  onChange,
  withTeam,
  withMyProjects,
  withCompletion,
}: ProjectFiltersProps) {
  const [filters, setFilters] = useState<ProjectFiltersValue>(DEFAULT_FILTERS);

  const update = (patch: Partial<ProjectFiltersValue>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    onChange(next);
  };

  return (
    <div className="flex flex-wrap items-end gap-3">
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
          onChange={(v) => update({ communityFilter: v as CommunityFilter | null })}
        />
      </div>
      <div className="w-36">
        <StandaloneFilter
          label="Priority"
          allLabel="All priorities"
          options={PRIORITY_OPTIONS}
          value={filters.priorityFilter}
          onChange={(v) => update({ priorityFilter: v as PriorityFilter | null })}
        />
      </div>
      {withCompletion && (
        <div className="w-48">
          <StandaloneFilter
            label="Completion"
            allLabel="All completions"
            options={COMPLETION_OPTIONS}
            value={filters.completionFilter}
            onChange={(v) => update({ completionFilter: v as CompletionFilter | null })}
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
