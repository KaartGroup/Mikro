"use client";

import { useMemo } from "react";
import { Select } from "@/components/ui";
import { useFetchTeams, useManagedTeams } from "@/hooks";

export interface TeamScopeSelectorProps {
  /** Currently selected team id, or null for "All teams". */
  value: number | null;
  onChange: (teamId: number | null) => void;
  /** Disabled while parent is loading / refetching. */
  disabled?: boolean;
  className?: string;
  /**
   * When true, limits the dropdown to teams managed by the current
   * user (team_admin viewers). Hides the "All teams" option since
   * that would expose org-wide data. Used by /admin/dashboard and
   * /admin/time when the viewer is team_admin.
   */
  managedOnly?: boolean;
}

const ALL_TEAMS_VALUE = "__all__";

/**
 * Team picker used on the admin dashboard to scope every time-related
 * panel to a single team. "All teams" is the no-filter default. Uses
 * the same styled Select primitive as RegionFilter so the dashboard
 * toolbar reads as one cohesive filter row.
 *
 * When `managedOnly` is true (team_admin), the picker shows only
 * teams the user leads and "All teams" is hidden — there's no
 * legitimate cross-team scope for that role tier.
 */
export function TeamScopeSelector({
  value,
  onChange,
  disabled = false,
  className,
  managedOnly = false,
}: TeamScopeSelectorProps) {
  const { data, loading } = useFetchTeams();
  const { teams: managedTeams, loading: managedLoading } = useManagedTeams();

  const options = useMemo(() => {
    if (managedOnly) {
      const teams = managedTeams.slice().sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      return teams.map((t) => ({ value: String(t.id), label: t.name }));
    }
    const teams = (data?.teams ?? []).slice().sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    return [
      { value: ALL_TEAMS_VALUE, label: "All teams" },
      ...teams.map((t) => ({ value: String(t.id), label: t.name })),
    ];
  }, [data, managedTeams, managedOnly]);

  const selected = value == null ? ALL_TEAMS_VALUE : String(value);

  return (
    <Select
      label="Team"
      options={options}
      value={selected}
      onChange={(v) => onChange(v === ALL_TEAMS_VALUE ? null : Number(v))}
      disabled={disabled || loading || (managedOnly && managedLoading)}
      searchable
      className={className}
    />
  );
}
