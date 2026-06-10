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
  Modal,
  ConfirmDialog,
  Input,
  Select,
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  Skeleton,
} from "@/components/ui";
import { MultiSelect } from "@/components/ui/MultiSelect";
import { useToastActions } from "@/components/ui";
import { FilterBar } from "@/components/filters";
import { TeamAdminEmptyState } from "@/components/admin/TeamAdminEmptyState";
import { formatNumber, displayRole, formatDate } from "@/lib/utils";
import { Val } from "@/components/ui";
import {
  useFetchTeams,
  useCreateTeam,
  useUpdateTeam,
  useDeleteTeam,
  useFetchTeamMembers,
  useAssignTeamMember,
  useUnassignTeamMember,
  useFetchTeamTrainings,
  useAssignTrainingToTeam,
  useUnassignTrainingFromTeam,
  useUsersList,
  useFilters,
  useFetchFilterOptions,
  useCurrentUserRole,
  useManagedTeams,
} from "@/hooks";
import { isOrgAdminOrAbove, isAnyAdmin } from "@/types";
import type { Team, TeamMemberItem, TeamTrainingItem } from "@/types";

export function AdminTeams() {
  const { data: teamsData, loading, refetch } = useFetchTeams();
  const { mutate: createTeam, loading: creating } = useCreateTeam();
  const { mutate: updateTeam, loading: updating } = useUpdateTeam();
  const { mutate: deleteTeam } = useDeleteTeam();
  const { mutate: fetchMembers } = useFetchTeamMembers();
  const { mutate: assignMember } = useAssignTeamMember();
  const { mutate: unassignMember } = useUnassignTeamMember();
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
  const [members, setMembers] = useState<TeamMemberItem[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersSearch, setMembersSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Team | null>(null);

  // Trainings modal state
  const { mutate: fetchTeamTrainings } = useFetchTeamTrainings();
  const { mutate: assignTrainingToTeam } = useAssignTrainingToTeam();
  const { mutate: unassignTrainingFromTeam } = useUnassignTrainingFromTeam();
  const [trainingsTeam, setTrainingsTeam] = useState<Team | null>(null);
  const [teamTrainings, setTeamTrainings] = useState<TeamTrainingItem[]>([]);
  const [trainingsLoading, setTrainingsLoading] = useState(false);
  const [trainingsSearch, setTrainingsSearch] = useState("");

  // Form state
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formLeadIds, setFormLeadIds] = useState<string[]>([]);

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
  // Only users who already hold an admin role (super_admin / admin / team_admin)
  // may be assigned as a team lead. Assigning a plain mapper as lead leaves them
  // in a broken half-state — lead of a team, but without the admin permissions to
  // act on it. Any user already assigned as a lead is kept selectable so the Edit
  // modal can still display (and let you remove) someone whose role changed after
  // they were assigned.
  const leadOptions = orgUsers
    .filter((u) => isAnyAdmin(u.role) || formLeadIds.includes(u.id))
    .map((u) => ({
      value: u.id,
      label: u.name || u.email,
    }));

  // Create handlers
  const openCreateModal = () => {
    setFormName("");
    setFormDescription("");
    setFormLeadIds([]);
    setShowCreateModal(true);
  };

  const handleCreate = async () => {
    if (!formName.trim()) {
      toast.error("Team name is required");
      return;
    }
    try {
      await createTeam({
        teamName: formName.trim(),
        teamDescription: formDescription.trim() || null,
        leadIds: formLeadIds,
      });
      toast.success("Team created");
      setShowCreateModal(false);
      refetch();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create team";
      toast.error(msg);
    }
  };

  // Edit handlers
  const openEditModal = (team: Team) => {
    setEditingTeam(team);
    setFormName(team.name);
    setFormDescription(team.description ?? "");
    setFormLeadIds(team.lead_ids ?? (team.lead_id ? [team.lead_id] : []));
  };

  const handleUpdate = async () => {
    if (!editingTeam) return;
    if (!formName.trim()) {
      toast.error("Team name is required");
      return;
    }
    try {
      await updateTeam({
        teamId: editingTeam.id,
        teamName: formName.trim(),
        teamDescription: formDescription.trim() || null,
        leadIds: formLeadIds,
      });
      toast.success("Team updated");
      setEditingTeam(null);
      refetch();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update team";
      toast.error(msg);
    }
  };

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

  // Members handlers
  const openMembersModal = async (team: Team) => {
    setMembersTeam(team);
    setMembersSearch("");
    setMembersLoading(true);
    try {
      const res = await fetchMembers({ teamId: team.id });
      setMembers(res?.users ?? []);
    } catch {
      toast.error("Failed to fetch team members");
      setMembers([]);
    } finally {
      setMembersLoading(false);
    }
  };

  const handleToggleMember = async (userId: string, currentStatus: string) => {
    if (!membersTeam) return;
    try {
      if (currentStatus === "Assigned") {
        await unassignMember({ teamId: membersTeam.id, userId });
      } else {
        await assignMember({ teamId: membersTeam.id, userId });
      }
      // Refresh members list
      const res = await fetchMembers({ teamId: membersTeam.id });
      setMembers(res?.users ?? []);
      refetch(); // Refresh team list for member count
    } catch {
      toast.error("Failed to update member assignment");
    }
  };

  const filteredMembers = members.filter(
    (m) =>
      m.name.toLowerCase().includes(membersSearch.toLowerCase()) ||
      m.email.toLowerCase().includes(membersSearch.toLowerCase()),
  );

  // Trainings handlers
  const openTrainingsModal = async (team: Team) => {
    setTrainingsTeam(team);
    setTrainingsSearch("");
    setTrainingsLoading(true);
    try {
      const res = await fetchTeamTrainings({ teamId: team.id });
      setTeamTrainings(res?.trainings ?? []);
    } catch {
      toast.error("Failed to fetch team trainings");
      setTeamTrainings([]);
    } finally {
      setTrainingsLoading(false);
    }
  };

  const handleToggleTraining = async (
    trainingId: number,
    currentStatus: string,
  ) => {
    if (!trainingsTeam) return;
    try {
      if (currentStatus === "Assigned") {
        await unassignTrainingFromTeam({
          teamId: trainingsTeam.id,
          trainingId,
        });
      } else {
        await assignTrainingToTeam({ teamId: trainingsTeam.id, trainingId });
      }
      const res = await fetchTeamTrainings({ teamId: trainingsTeam.id });
      setTeamTrainings(res?.trainings ?? []);
    } catch {
      toast.error("Failed to update training assignment");
    }
  };

  const filteredTrainings = teamTrainings.filter((t) =>
    t.title?.toLowerCase().includes(trainingsSearch.toLowerCase()),
  );

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
          <Button onClick={openCreateModal}>Create Team</Button>
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
                            onClick={() => openMembersModal(team)}
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
                              onClick={() => openEditModal(team)}
                            >
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openMembersModal(team)}
                            >
                              Members
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openTrainingsModal(team)}
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
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create Team"
        description="Create a new team to group users"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowCreateModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} isLoading={creating}>
              Create Team
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Team Name"
            placeholder="e.g. East Africa Mappers"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
          />
          <div>
            <label className="block text-sm font-medium mb-1">
              Description
            </label>
            <textarea
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              rows={3}
              placeholder="Optional team description..."
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
            />
          </div>
          <div>
            <MultiSelect
              label="Team Leads"
              value={formLeadIds}
              onChange={setFormLeadIds}
              options={leadOptions}
              placeholder="Select one or more leads"
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              Only users with an admin role (Super Admin, Org Admin, or Team
              Admin) appear here. A team lead needs admin permissions to manage
              the team — assign someone an admin role on the Users page first to
              make them eligible.
            </p>
          </div>
        </div>
      </Modal>

      {/* Edit Team Modal */}
      <Modal
        isOpen={!!editingTeam}
        onClose={() => setEditingTeam(null)}
        title="Edit Team"
        description={`Editing "${editingTeam?.name}"`}
        footer={
          <>
            <Button variant="outline" onClick={() => setEditingTeam(null)}>
              Cancel
            </Button>
            <Button onClick={handleUpdate} isLoading={updating}>
              Save Changes
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Team Name"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
          />
          <div>
            <label className="block text-sm font-medium mb-1">
              Description
            </label>
            <textarea
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              rows={3}
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
            />
          </div>
          <div>
            <MultiSelect
              label="Team Leads"
              value={formLeadIds}
              onChange={setFormLeadIds}
              options={leadOptions}
              placeholder="Select one or more leads"
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              Only users with an admin role (Super Admin, Org Admin, or Team
              Admin) appear here. A team lead needs admin permissions to manage
              the team — assign someone an admin role on the Users page first to
              make them eligible.
            </p>
          </div>
        </div>
      </Modal>

      {/* Members Modal */}
      <Modal
        isOpen={!!membersTeam}
        onClose={() => {
          setMembersTeam(null);
          setMembers([]);
        }}
        title={`Team Members — ${membersTeam?.name}`}
        description="Assign or remove users from this team"
        size="5xl"
        footer={
          <Button
            variant="outline"
            onClick={() => {
              setMembersTeam(null);
              setMembers([]);
            }}
          >
            Close
          </Button>
        }
      >
        <div className="space-y-4">
          <Input
            placeholder="Search users..."
            value={membersSearch}
            onChange={(e) => setMembersSearch(e.target.value)}
          />
          {membersLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filteredMembers.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              {membersSearch
                ? "No users match your search"
                : "No users in organization"}
            </p>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMembers.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">{user.name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {user.email}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {displayRole(user.role)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge
                          variant={
                            user.assigned === "Assigned"
                              ? "success"
                              : "secondary"
                          }
                        >
                          {user.assigned}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant={
                            user.assigned === "Assigned"
                              ? "destructive"
                              : "primary"
                          }
                          onClick={() =>
                            handleToggleMember(user.id, user.assigned)
                          }
                        >
                          {user.assigned === "Assigned" ? "Remove" : "Assign"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </Modal>

      {/* Trainings Modal */}
      <Modal
        isOpen={!!trainingsTeam}
        onClose={() => {
          setTrainingsTeam(null);
          setTeamTrainings([]);
        }}
        title={`Team Trainings — ${trainingsTeam?.name}`}
        description="Assign or remove trainings from this team"
        size="5xl"
        footer={
          <Button
            variant="outline"
            onClick={() => {
              setTrainingsTeam(null);
              setTeamTrainings([]);
            }}
          >
            Close
          </Button>
        }
      >
        <div className="space-y-4">
          <Input
            placeholder="Search trainings..."
            value={trainingsSearch}
            onChange={(e) => setTrainingsSearch(e.target.value)}
          />
          {trainingsLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filteredTrainings.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              {trainingsSearch
                ? "No trainings match your search"
                : "No trainings in organization"}
            </p>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Difficulty</TableHead>
                    <TableHead className="text-center">Points</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTrainings.map((training) => (
                    <TableRow key={training.id}>
                      <TableCell className="font-medium">
                        {training.title}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {training.training_type || "—"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {training.difficulty || "—"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Val>{formatNumber(training.point_value)}</Val>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge
                          variant={
                            training.assigned === "Assigned"
                              ? "success"
                              : "secondary"
                          }
                        >
                          {training.assigned}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant={
                            training.assigned === "Assigned"
                              ? "destructive"
                              : "primary"
                          }
                          onClick={() =>
                            handleToggleTraining(training.id, training.assigned)
                          }
                        >
                          {training.assigned === "Assigned"
                            ? "Remove"
                            : "Assign"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </Modal>

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
