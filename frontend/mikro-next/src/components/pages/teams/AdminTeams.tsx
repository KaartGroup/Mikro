"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  ConfirmDialog,
  Input,
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  Skeleton,
} from "@/components/ui";
import { CreateTeamModal } from "@/components/modals/team/CreateTeamModal";
import { EditTeamModal } from "@/components/modals/team/EditTeamModal";
import { TeamMembersModal } from "@/components/modals/team/TeamMembersModal";
import { TeamTrainingsModal } from "@/components/modals/training/TeamTrainingsModal";
import { useToastActions } from "@/components/ui";
import { FilterBar } from "@/components/filters";
import { TeamAdminEmptyState } from "@/components/admin/TeamAdminEmptyState";
import { formatNumber, formatDate } from "@/lib/utils";
import { Val } from "@/components/ui";
import {
  useFetchTeams,
  useDeleteTeam,
  useUsersList,
  useFilters,
  useFetchFilterOptions,
  useCurrentUserRole,
  useManagedTeams,
} from "@/hooks";
import { isOrgAdminOrAbove, isAnyAdmin } from "@/types";
import type { Team } from "@/types";

export function AdminTeams() {
  const { data: teamsData, loading, refetch } = useFetchTeams();
  const { mutate: deleteTeam } = useDeleteTeam();
  const { data: usersData } = useUsersList();
  const toast = useToastActions();
  const { activeFilters, setActiveFilters, filtersBody } = useFilters();
  const { data: filterOptions, loading: filterOptionsLoading } =
    useFetchFilterOptions();

  // Role-aware UI (F3 Phase 3.4):
  // - team_admin: can manage their managed teams; cannot create/delete teams.
  // - admin/super_admin: full management.
  const { role: viewerRole } = useCurrentUserRole();
  const { teams: managedTeams, loading: managedTeamsLoading } =
    useManagedTeams();
  const isTeamAdmin = viewerRole === "team_admin";
  const canCreateOrDeleteTeams = isOrgAdminOrAbove(viewerRole);

  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const ROWS_PER_PAGE = 20;
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [membersTeam, setMembersTeam] = useState<Team | null>(null);
  const [trainingsTeam, setTrainingsTeam] = useState<Team | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Team | null>(null);

  // Re-fetch teams when server-side filters change
  useEffect(() => {
    if (filtersBody) {
      refetch({ filters: filtersBody });
    } else {
      refetch();
    }
  }, [filtersBody]);

  const teams = teamsData?.teams ?? [];
  const filteredTeams = teams.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase()),
  );

  const orgUsers = usersData?.users ?? [];

  // Lead options for CreateTeamModal: only admin users may be leads.
  const leadOptions = orgUsers
    .filter((u) => isAnyAdmin(u.role))
    .map((u) => ({
      value: u.id,
      label: u.name || u.email,
    }));

  // Delete handlers
  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteTeam({ teamId: deleteTarget.id });
      toast.success("Team deleted");
      setDeleteTarget(null);
      refetch();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to delete team";
      toast.error(msg);
    }
  };

  if (loading && !teamsData) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-10 w-32" />
        </div>
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // team_admin with no managed teams → empty state, no create UI.
  if (isTeamAdmin && !managedTeamsLoading && managedTeams.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Teams</h1>
        <TeamAdminEmptyState context="team" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Teams</h1>
          <p className="text-muted-foreground">
            Manage teams and member assignments
          </p>
        </div>
        {canCreateOrDeleteTeams && (
          <Button onClick={() => setShowCreateModal(true)}>Create Team</Button>
        )}
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Teams</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              <Val>{formatNumber(teams.length)}</Val>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Total Members Assigned
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              <Val>
                {formatNumber(
                  teams.reduce((sum, t) => sum + t.member_count, 0),
                )}
              </Val>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Teams with Lead
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              <Val>
                {formatNumber(
                  teams.filter(
                    (t) => (t.lead_ids?.length ?? (t.lead_id ? 1 : 0)) > 0,
                  ).length,
                )}
              </Val>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <FilterBar
        dimensions={
          filterOptions?.dimensions
            ? Object.entries(filterOptions.dimensions).map(([key, values]) => ({
                key,
                label: key.charAt(0).toUpperCase() + key.slice(1),
                options: Array.isArray(values)
                  ? values.map((v) =>
                      typeof v === "string"
                        ? { value: v, label: v }
                        : { value: String(v.id ?? v.name), label: v.name },
                    )
                  : [],
              }))
            : []
        }
        activeFilters={activeFilters}
        onChange={setActiveFilters}
        loading={filterOptionsLoading}
      />

      {/* Search + Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-4">
            <Input
              placeholder="Search teams..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCurrentPage(1);
              }}
              className="max-w-sm"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Lead</TableHead>
                <TableHead className="text-center">Members</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(() => {
                const filtered = filteredTeams;
                const totalPages = Math.ceil(filtered.length / ROWS_PER_PAGE);
                const paginated = filtered.slice(
                  (currentPage - 1) * ROWS_PER_PAGE,
                  currentPage * ROWS_PER_PAGE,
                );
                const showingStart =
                  filtered.length === 0
                    ? 0
                    : (currentPage - 1) * ROWS_PER_PAGE + 1;
                const showingEnd = Math.min(
                  currentPage * ROWS_PER_PAGE,
                  filtered.length,
                );
                return (
                  <>
                    {paginated.map((team) => (
                      <TableRow key={team.id}>
                        <TableCell>
                          <Link
                            href={`/teams/${team.id}`}
                            className="font-medium text-kaart-orange hover:underline"
                            title="View team details"
                          >
                            {team.name}
                          </Link>
                        </TableCell>
                        <TableCell
                          className="text-muted-foreground max-w-xs truncate"
                          title={team.description || ""}
                        >
                          {team.description || "—"}
                        </TableCell>
                        <TableCell>
                          {team.lead_names && team.lead_names.length > 0
                            ? team.lead_names.join(", ")
                            : team.lead_name || (
                                <span className="text-muted-foreground">
                                  None
                                </span>
                              )}
                        </TableCell>
                        <TableCell className="text-center">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setMembersTeam(team)}
                          >
                            <Badge variant="secondary">
                              <Val>{formatNumber(team.member_count)}</Val>
                            </Badge>
                          </Button>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {team.created_at ? formatDate(team.created_at) : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setEditingTeam(team)}
                            >
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setMembersTeam(team)}
                            >
                              Members
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setTrainingsTeam(team)}
                            >
                              Trainings
                            </Button>
                            {canCreateOrDeleteTeams && (
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => setDeleteTarget(team)}
                              >
                                Delete
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {filtered.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={6}
                          className="text-center py-8 text-muted-foreground"
                        >
                          {search
                            ? "No teams match your search"
                            : "No teams yet. Create one to get started."}
                        </TableCell>
                      </TableRow>
                    )}
                    {filtered.length > ROWS_PER_PAGE && (
                      <TableRow>
                        <TableCell colSpan={6}>
                          <div className="flex items-center justify-between mt-4 px-2 py-3">
                            <span className="text-sm text-muted-foreground">
                              Showing {showingStart}–{showingEnd} of{" "}
                              {filtered.length}
                            </span>
                            <div className="flex items-center gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={currentPage === 1}
                                onClick={() => setCurrentPage((p) => p - 1)}
                              >
                                Previous
                              </Button>
                              <span className="text-sm text-muted-foreground">
                                Page {currentPage} of {totalPages}
                              </span>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={currentPage >= totalPages}
                                onClick={() => setCurrentPage((p) => p + 1)}
                              >
                                Next
                              </Button>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                );
              })()}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create Team Modal */}
      <CreateTeamModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        leadOptions={leadOptions}
        onCreated={() => refetch()}
      />

      {/* Edit Team Modal */}
      <EditTeamModal
        isOpen={!!editingTeam}
        onClose={() => setEditingTeam(null)}
        team={editingTeam}
        orgUsers={orgUsers}
        onSaved={() => refetch()}
      />

      {/* Members Modal */}
      <TeamMembersModal
        team={membersTeam}
        onClose={() => setMembersTeam(null)}
        onMembersChanged={() => refetch()}
      />

      {/* Trainings Modal */}
      <TeamTrainingsModal
        team={trainingsTeam}
        onClose={() => setTrainingsTeam(null)}
      />

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Team"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? All member assignments will be removed.`}
        confirmText="Delete"
        variant="destructive"
      />
    </div>
  );
}
