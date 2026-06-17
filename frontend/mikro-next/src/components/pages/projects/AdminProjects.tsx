"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  ConfirmDialog,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  Skeleton,
} from "@/components/ui";
import { useToastActions } from "@/components/ui";
import {
  useOrgProjectsPaged,
  useOrgProjectStats,
  useDeleteProject,
  useSyncProject,
  useCheckSyncStatus,
  useFetchFilterOptions,
  useCurrentUserRole,
  useManagedTeams,
} from "@/hooks";
import { AddProjectModal } from "@/components/modals/project/AddProjectModal";
import { EditProjectModal } from "@/components/modals/project/EditProjectModal";
import { DeletedProjectsModal } from "@/components/modals/project/DeletedProjectsModal";
import { ProjectFilters, DEFAULT_FILTERS } from "./ProjectFilters";
import type { ProjectFiltersValue } from "./ProjectFilters";
import { TeamAdminEmptyState } from "@/components/admin/TeamAdminEmptyState";
import { TablePaginator } from "@/components/tables/TablePaginator";
import { projectDisplayName } from "@/lib/sortProjects";
import Link from "next/link";
import {
  formatNumber,
  formatCurrency,
  getProjectExternalUrl,
} from "@/lib/utils";
import { Val } from "@/components/ui";
import { isAnyAdmin } from "@/types";
import type {
  Project,
  ProjectsPagedResponse,
  ProjectStatsResponse,
} from "@/types";

export function AdminProjects() {
  const { mutate: fetchProjectsPage } = useOrgProjectsPaged();
  const { mutate: fetchProjectStats } = useOrgProjectStats();
  const { data: filterOptions } = useFetchFilterOptions();
  const { mutate: deleteProject, loading: deleting } = useDeleteProject();
  const { mutate: syncProject } = useSyncProject();
  const { mutate: checkSyncStatus } = useCheckSyncStatus();
  const [syncingProjectId, setSyncingProjectId] = useState<number | null>(null);
  const toast = useToastActions();


  // Role-aware UI (F3 Phase 3.4):
  // - team_admin: list is server-scoped to managed teams' projects.
  //   No create/delete buttons.
  // - admin/super_admin: full management.
  const { role: viewerRole } = useCurrentUserRole();
  const { teams: managedTeams, loading: managedTeamsLoading } =
    useManagedTeams();
  const isTeamAdmin = viewerRole === "team_admin";
  // team_admin can now create AND edit projects (delete is still org_admin only).
  const canCreateOrEditOrDelete = isAnyAdmin(viewerRole);

  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showDeletedModal, setShowDeletedModal] = useState(false);
  const [filters, setFilters] = useState<ProjectFiltersValue>(DEFAULT_FILTERS);
  // Debounced mirror of the search box → drives the server query (one request
  // after typing settles, not per keystroke).
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"active" | "inactive">("active");
  const [activePageNum, setActivePageNum] = useState(1);
  const [inactivePageNum, setInactivePageNum] = useState(1);
  const [projSortKey, setProjSortKey] = useState<string>("name");
  const [projSortDir, setProjSortDir] = useState<"asc" | "desc">("asc");
  const ROWS_PER_PAGE = 20;

  // Server-driven data: one page for the current tab + aggregate stat counts.
  const [listResp, setListResp] = useState<ProjectsPagedResponse | null>(null);
  const [stats, setStats] = useState<ProjectStatsResponse | null>(null);
  const [listLoading, setListLoading] = useState(true);

  const currentPageNum =
    activeTab === "active" ? activePageNum : inactivePageNum;
  const setCurrentPageNum =
    activeTab === "active" ? setActivePageNum : setInactivePageNum;

  // Debounce the search box.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(filters.search.trim()), 300);
    return () => clearTimeout(t);
  }, [filters.search]);

  // Filter dimensions shared by the list + stats requests. Depends on the
  // individual filter fields (NOT the whole `filters` object) so it doesn't
  // change on every search keystroke — only the debounced search feeds it.
  const buildFilterBody = useCallback((): Record<string, unknown> => {
    const body: Record<string, unknown> = {};
    if (debouncedSearch) body.search = debouncedSearch;
    if (filters.showMyProjects) body.created_by_me = true;
    if (filters.countryId) body.country_id = Number(filters.countryId);
    if (filters.regionId) body.region_id = Number(filters.regionId);
    if (filters.teamId) body.team_id = Number(filters.teamId);
    if (filters.communityFilter)
      body.community = filters.communityFilter === "community";
    if (filters.priorityFilter) body.priority = filters.priorityFilter;
    return body;
  }, [
    debouncedSearch,
    filters.showMyProjects,
    filters.countryId,
    filters.regionId,
    filters.teamId,
    filters.communityFilter,
    filters.priorityFilter,
  ]);

  // Fetch one page of the active tab (status + sort + page).
  const fetchList = useCallback(async () => {
    setListLoading(true);
    try {
      const resp = await fetchProjectsPage({
        ...buildFilterBody(),
        status: activeTab === "active",
        sort_key: projSortKey,
        sort_dir: projSortDir,
        page: currentPageNum,
        page_size: ROWS_PER_PAGE,
      });
      setListResp(resp ?? null);
    } catch {
      /* errors surfaced by the mutation hook */
    } finally {
      setListLoading(false);
    }
    // projSortKey/projSortDir are declared below; included as deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildFilterBody, activeTab, currentPageNum, projSortKey, projSortDir]);

  // Fetch aggregate counts (status excluded → both tab counts reported).
  // Only depends on the filter set, so it doesn't refire on tab/page/sort.
  const fetchStats = useCallback(async () => {
    try {
      const resp = await fetchProjectStats(buildFilterBody());
      setStats(resp ?? null);
    } catch {
      /* errors surfaced by the mutation hook */
    }
  }, [buildFilterBody, fetchProjectStats]);

  const refreshAll = useCallback(() => {
    fetchList();
    fetchStats();
  }, [fetchList, fetchStats]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // Reset both tabs to page 1 whenever the result set or ordering changes
  // (debounced for search). Page itself is intentionally excluded.
  useEffect(() => {
    setActivePageNum(1);
    setInactivePageNum(1);
  }, [
    debouncedSearch,
    filters.showMyProjects,
    filters.countryId,
    filters.regionId,
    filters.teamId,
    filters.communityFilter,
    filters.priorityFilter,
    projSortKey,
    projSortDir,
  ]);

  const projects = listResp?.projects ?? [];
  const total = listResp?.total ?? 0;

  const handleDeleteProject = async () => {
    if (!selectedProject) return;

    try {
      await deleteProject({ project_id: selectedProject.id });
      toast.success("Project deleted successfully");
      setShowDeleteModal(false);
      setSelectedProject(null);
      refreshAll();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to delete project";
      toast.error(message);
    }
  };

  const handleSyncProject = async (projectId: number, projectName: string) => {
    setSyncingProjectId(projectId);
    try {
      const result = await syncProject({ project_id: projectId });
      const jobId = result.job_id;
      if (!jobId) {
        toast.success(result.message || "Sync started");
        setSyncingProjectId(null);
        return;
      }
      // Poll for completion
      const poll = setInterval(async () => {
        try {
          const status = await checkSyncStatus({ job_id: jobId });
          if (status.sync_status === "completed") {
            clearInterval(poll);
            setSyncingProjectId(null);
            toast.success(status.progress || `${projectName} synced`);
            refreshAll();
          } else if (status.sync_status === "failed") {
            clearInterval(poll);
            setSyncingProjectId(null);
            toast.error(status.error || `Sync failed for ${projectName}`);
          }
        } catch {
          clearInterval(poll);
          setSyncingProjectId(null);
          toast.error("Failed to check sync status");
        }
      }, 3000);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sync failed";
      toast.error(message);
      setSyncingProjectId(null);
    }
  };

  const openEditModal = (project: Project) => {
    setSelectedProject(project);
    setShowEditModal(true);
  };

  const openDeleteModal = (project: Project) => {
    setSelectedProject(project);
    setShowDeleteModal(true);
  };

  const handleProjSort = (key: string) => {
    if (projSortKey === key) {
      setProjSortDir(projSortDir === "asc" ? "desc" : "asc");
    } else {
      setProjSortKey(key);
      setProjSortDir("asc");
    }
  };

  /** Calculate completion % for a project (TM4 or MR). Capped at 100%. */
  const getCompletionPct = (project: Project): number | null => {
    try {
      if (!project.total_tasks || project.total_tasks === 0) return null;
      if (
        project.source === "mr" &&
        project.mr_status_breakdown &&
        typeof project.mr_status_breakdown === "object" &&
        !Array.isArray(project.mr_status_breakdown)
      ) {
        const breakdown = project.mr_status_breakdown as Record<string, number>;
        // Count all trackable MR statuses: Fixed(1), FalsePositive(2), Skipped(3), AlreadyFixed(5), CantComplete(6)
        const completed =
          (breakdown["1"] ?? 0) +
          (breakdown["2"] ?? 0) +
          (breakdown["3"] ?? 0) +
          (breakdown["5"] ?? 0) +
          (breakdown["6"] ?? 0);
        return Math.min(
          Math.round((completed / project.total_tasks) * 100),
          100,
        );
      }
      const validated = project.total_validated ?? 0;
      return Math.min(Math.round((validated / project.total_tasks) * 100), 100);
    } catch {
      return null;
    }
  };

  /** Return a Tailwind text color class based on completion percentage. */
  const completionColor = (pct: number): string => {
    if (pct >= 80) return "text-green-600";
    if (pct >= 60) return "text-emerald-500";
    if (pct >= 40) return "text-yellow-500";
    if (pct >= 20) return "text-orange-500";
    return "text-red-500";
  };

  const projSortColumns = [
    { key: "name", label: "Project", width: "w-[22%]" },
    { key: "source_id", label: "Source ID", width: "w-[8%]" },
    { key: "total_tasks", label: "Tasks", width: "w-[6%]" },
    { key: "", label: "Progress", width: "w-[14%]" },
    { key: "", label: "Done", width: "w-[6%]" },
    { key: "mapping_rate", label: "Rates", width: "w-[9%]" },
    { key: "budget", label: "Budget", width: "w-[9%]" },
    { key: "difficulty", label: "Difficulty", width: "w-[10%]" },
  ];

  // Renders the current tab's server-fetched page. Reads `projects`, `total`,
  // `currentPageNum`, `setCurrentPageNum`, and `listLoading` from closure —
  // the server already filtered/sorted/sliced, so there's no client work here.
  const ProjectTable = () => {
    const paginatedProjects = projects;

    return (
      <>
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              {projSortColumns.map((col) => (
                <TableHead
                  key={col.label}
                  className={`${col.width} ${col.key ? "cursor-pointer select-none hover:text-foreground transition-colors" : ""}`}
                  onClick={col.key ? () => handleProjSort(col.key) : undefined}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {col.key && projSortKey === col.key && (
                      <svg
                        className="w-3 h-3"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d={
                            projSortDir === "asc"
                              ? "M5 15l7-7 7 7"
                              : "M19 9l-7 7-7-7"
                          }
                        />
                      </svg>
                    )}
                  </span>
                </TableHead>
              ))}
              <TableHead className="w-[16%] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedProjects.map((project) => (
              <TableRow key={project.id}>
                <TableCell className="max-w-0">
                  <div className="min-w-0">
                    <div className="font-medium truncate">
                      <Link
                        href={`/projects/${project.id}`}
                        className="font-medium text-kaart-orange hover:underline"
                        title={project.name}
                      >
                        {projectDisplayName(project)}
                      </Link>
                      {project.source === "mr" ? (
                        <Badge
                          variant="default"
                          className="ml-2 text-[10px] bg-blue-500"
                        >
                          MR
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="ml-2 text-[10px]">
                          TM4
                        </Badge>
                      )}
                    </div>
                    <a
                      href={getProjectExternalUrl(project.id, project.source)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-kaart-orange hover:underline"
                      title={
                        project.source === "mr"
                          ? "Open in MapRoulette"
                          : "Open in Tasking Manager"
                      }
                    >
                      Open ↗
                    </a>
                  </div>
                </TableCell>
                <TableCell>
                  {/* Source ID = upstream TM4/MR id, persisted as project.id PK.
                  Monospace + small so the digits don't crowd the row. */}
                  <a
                    href={getProjectExternalUrl(project.id, project.source)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-sm text-kaart-orange hover:underline"
                    title={
                      project.source === "mr"
                        ? "Open in MapRoulette"
                        : "Open in Tasking Manager"
                    }
                  >
                    {project.id}
                  </a>
                </TableCell>
                <TableCell>
                  {project.total_tasks === 0 && !project.last_synced ? (
                    <span
                      className="text-muted-foreground italic text-sm"
                      title="Tasks haven't been synced from the source yet"
                    >
                      Pending sync
                    </span>
                  ) : (
                    <Val>{formatNumber(project.total_tasks)}</Val>
                  )}
                </TableCell>
                <TableCell>
                  {project.total_tasks === 0 && !project.last_synced ? (
                    <span className="text-muted-foreground italic text-sm">
                      —
                    </span>
                  ) : project.source === "mr" ? (
                    <div className="text-sm space-y-0.5">
                      <p className="text-green-600">
                        <Val>
                          {formatNumber(
                            project.mr_status_breakdown?.["1"] ?? 0,
                          )}
                        </Val>{" "}
                        Fixed
                      </p>
                      <p className="text-emerald-500">
                        <Val>
                          {formatNumber(
                            project.mr_status_breakdown?.["5"] ?? 0,
                          )}
                        </Val>{" "}
                        Already Fixed
                      </p>
                      <p className="text-amber-600">
                        <Val>
                          {formatNumber(
                            project.mr_status_breakdown?.["2"] ?? 0,
                          )}
                        </Val>{" "}
                        Not an Issue
                      </p>
                      <p className="text-orange-500">
                        <Val>
                          {formatNumber(
                            project.mr_status_breakdown?.["6"] ?? 0,
                          )}
                        </Val>{" "}
                        Can&apos;t Complete
                      </p>
                      <p className="text-gray-400">
                        <Val>
                          {formatNumber(
                            project.mr_status_breakdown?.["3"] ?? 0,
                          )}
                        </Val>{" "}
                        Skipped
                      </p>
                    </div>
                  ) : (
                    <div className="text-sm">
                      <p className="text-green-600">
                        <Val>{formatNumber(project.total_mapped)}</Val> mapped
                      </p>
                      <p className="text-blue-600">
                        <Val>{formatNumber(project.total_validated)}</Val>{" "}
                        validated
                      </p>
                      <p className="text-red-600">
                        <Val>{formatNumber(project.total_invalidated)}</Val>{" "}
                        invalidated
                      </p>
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  {(() => {
                    try {
                      const pct = getCompletionPct(project);
                      if (pct === null)
                        return (
                          <span className="text-muted-foreground text-sm">
                            —
                          </span>
                        );
                      return (
                        <span
                          className={`text-sm font-semibold ${completionColor(pct)}`}
                        >
                          {pct}%
                        </span>
                      );
                    } catch {
                      return (
                        <span className="text-muted-foreground text-sm">—</span>
                      );
                    }
                  })()}
                </TableCell>
                <TableCell>
                  {project.payments_enabled === false ? (
                    <Badge variant="secondary">Stats Only</Badge>
                  ) : (
                    <div className="text-sm">
                      <p>
                        Map:{" "}
                        <Val>
                          {formatCurrency(project.mapping_rate_per_task)}
                        </Val>
                      </p>
                      <p>
                        Val:{" "}
                        <Val>
                          {formatCurrency(project.validation_rate_per_task)}
                        </Val>
                      </p>
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <div className="text-sm">
                    <p>
                      Max: <Val>{formatCurrency(project.max_payment)}</Val>
                    </p>
                    <p className="text-muted-foreground">
                      Paid: <Val>{formatCurrency(project.total_payout)}</Val>
                    </p>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1 flex-wrap">
                    <Badge
                      variant={
                        project.difficulty === "Easy"
                          ? "success"
                          : project.difficulty === "Medium"
                            ? "warning"
                            : "destructive"
                      }
                    >
                      {project.difficulty || "Unknown"}
                    </Badge>
                    <Badge
                      variant={
                        project.priority === "High"
                          ? "destructive"
                          : project.priority === "Low"
                            ? "success"
                            : "warning"
                      }
                    >
                      {project.priority ?? "Medium"}
                    </Badge>
                    {project.community && (
                      <Badge variant="secondary">Community</Badge>
                    )}
                    {(project as Project & { assigned_locations?: number })
                      .assigned_locations ? (
                      <Badge variant="secondary" className="text-[10px]">
                        {
                          (project as Project & { assigned_locations?: number })
                            .assigned_locations
                        }{" "}
                        loc
                      </Badge>
                    ) : null}
                    {(project as Project & { assigned_trainings?: number })
                      .assigned_trainings ? (
                      <Badge variant="secondary" className="text-[10px]">
                        {
                          (project as Project & { assigned_trainings?: number })
                            .assigned_trainings
                        }{" "}
                        trn
                      </Badge>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="text-right pr-2">
                  <div className="flex justify-end gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        handleSyncProject(project.id, project.name)
                      }
                      isLoading={syncingProjectId === project.id}
                      disabled={syncingProjectId !== null}
                    >
                      Sync
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openEditModal(project)}
                    >
                      Edit
                    </Button>
                    {(canCreateOrEditOrDelete || project.can_delete) && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => openDeleteModal(project)}
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {total === 0 && (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="text-center py-8 text-muted-foreground"
                >
                  {listLoading ? "Loading…" : "No projects found"}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {total > ROWS_PER_PAGE && (
          <TablePaginator
            page={currentPageNum}
            totalItems={total}
            pageSize={ROWS_PER_PAGE}
            onPageChange={(p) => setCurrentPageNum(p)}
            disabled={listLoading}
            itemLabel="projects"
          />
        )}
      </>
    );
  };

  if (listLoading && !listResp) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-10 w-24" />
        </div>
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // team_admin with no managed teams → empty state.
  if (isTeamAdmin && !managedTeamsLoading && managedTeams.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Projects</h1>
        <TeamAdminEmptyState context="project" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Projects</h1>
          <p className="text-muted-foreground">
            Manage TM4 projects and payment rates
          </p>
        </div>
        {canCreateOrEditOrDelete && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => setShowDeletedModal(true)}
            >
              Deleted Projects
            </Button>
            <Button onClick={() => setShowAddModal(true)}>Add Project</Button>
          </div>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Active Projects
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              <Val>{formatNumber(stats?.active_count ?? 0)}</Val>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Inactive Projects
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">
              <Val>{formatNumber(stats?.inactive_count ?? 0)}</Val>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Tasks</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              <Val>{formatNumber(stats?.total_tasks ?? 0)}</Val>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">By Platform</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-3">
              <div>
                <span className="text-2xl font-bold">
                  <Val>{formatNumber(stats?.tm4_count ?? 0)}</Val>
                </span>
                <Badge variant="secondary" className="ml-1 text-[10px]">
                  TM4
                </Badge>
              </div>
              <div>
                <span className="text-2xl font-bold">
                  <Val>{formatNumber(stats?.mr_count ?? 0)}</Val>
                </span>
                <Badge
                  variant="default"
                  className="ml-1 text-[10px] bg-blue-500"
                >
                  MR
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <ProjectFilters
        filterOptions={filterOptions ?? null}
        onChange={setFilters}
        withTeam
        withMyProjects
      />

      {/* Projects Tabs — controlled so the active tab drives the server query.
      Both panels render the same server-fetched page (only the active one is
      visible), so switching tabs refetches that status. */}
      <Tabs
        defaultValue="active"
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as "active" | "inactive")}
      >
        <TabsList>
          <TabsTrigger value="active">
            Active ({formatNumber(stats?.active_count ?? 0).text})
          </TabsTrigger>
          <TabsTrigger value="inactive">
            Inactive ({formatNumber(stats?.inactive_count ?? 0).text})
          </TabsTrigger>
        </TabsList>
        <TabsContent value="active">
          <Card>
            <CardContent className="p-0">
              <ProjectTable />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="inactive">
          <Card>
            <CardContent className="p-0">
              <ProjectTable />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AddProjectModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onCreated={() => refreshAll()}
      />

      <EditProjectModal
        isOpen={showEditModal}
        project={selectedProject}
        onClose={() => {
          setShowEditModal(false);
          setSelectedProject(null);
        }}
        onSaved={() => refreshAll()}
      />

      <DeletedProjectsModal
        isOpen={showDeletedModal}
        onClose={() => setShowDeletedModal(false)}
        onChanged={() => refreshAll()}
      />

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setSelectedProject(null);
        }}
        onConfirm={handleDeleteProject}
        title="Delete Project"
        message={`Are you sure you want to delete "${selectedProject?.name}"? The project will be moved to Deleted Projects and can be restored later.`}
        confirmText="Delete"
        variant="destructive"
        isLoading={deleting}
      />
    </div>
  );
}
