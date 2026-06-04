"use client";

import { Button, Tooltip } from "@/components/ui";
import { RegionFilter } from "@/components/admin/RegionFilter";
import { TeamScopeSelector } from "@/components/admin/TeamScopeSelector";

export interface DashboardFilterToolbarProps {
  teamId: number | null;
  onTeamIdChange: (id: number | null) => void;
  regionCountryId: number | null;
  onRegionCountryIdChange: (id: number | null) => void;
  isTeamAdmin: boolean;
  syncing: boolean;
  syncProgress: string | null;
  onSyncAllTasks: () => void;
}

export function DashboardFilterToolbar({
  teamId,
  onTeamIdChange,
  regionCountryId,
  onRegionCountryIdChange,
  isTeamAdmin,
  syncing,
  syncProgress,
  onSyncAllTasks,
}: DashboardFilterToolbarProps) {
  return (
    <>
      <div className="flex items-end justify-end gap-3">
        <div className="w-48">
          <RegionFilter
            value={regionCountryId}
            onChange={onRegionCountryIdChange}
          />
        </div>
        <div className="w-48">
          <TeamScopeSelector
            value={teamId}
            onChange={onTeamIdChange}
            managedOnly={isTeamAdmin}
          />
        </div>
        {syncing && syncProgress && (
          <span className="text-sm text-muted-foreground">{syncProgress}</span>
        )}
        <Tooltip
          content="Pull latest task data from Tasking Manager and MapRoulette"
          position="bottom"
        >
          <Button
            variant="outline"
            size="sm"
            onClick={onSyncAllTasks}
            disabled={syncing}
          >
            {syncing ? "Syncing..." : "Sync All Tasks"}
          </Button>
        </Tooltip>
      </div>
      {teamId !== null && (
        <div className="text-xs text-muted-foreground italic -mt-2">
          Time stats below are scoped to the selected team. Project counts and
          payment totals remain org-wide.
        </div>
      )}
    </>
  );
}
