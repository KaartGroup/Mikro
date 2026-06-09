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
  useOrgProjects,
  useDeleteProject,
  usePurgeProjects,
  useSyncProject,
  useCheckSyncStatus,
  useFetchFilterOptions,
  useCurrentUserRole,
  useManagedTeams,
} from "@/hooks";
import { AddProjectModal } from "./AddProjectModal";
import { EditProjectModal } from "./EditProjectModal";
import { ProjectFilters, DEFAULT_FILTERS } from "./ProjectFilters";
import type { ProjectFiltersValue } from "./ProjectFilters";
import { TeamAdminEmptyState } from "@/components/admin/TeamAdminEmptyState";
import Link from "next/link";
import {
  formatNumber,
  formatCurrency,
  getProjectExternalUrl,
} from "@/lib/utils";
import { Val } from "@/components/ui";
import { isOrgAdminOrAbove, isAnyAdmin } from "@/types";
import type { Project } from "@/types";

export function AdminProjects() {
  const { data: projects, loading, refetch } = useOrgProjects();
  const { data: filterOptions } = useFetchFilterOptions();
  const { mutate: deleteProject, loading: deleting } = useDeleteProject();
  const { mutate: purgeProjects, loading: purging } = usePurgeProjects();
  const { mutate: syncProject } = useSyncProject();
  const { mutate: checkSyncStatus } = useCheckSyncStatus();
  const [syncingProjectId, setSyncingProjectId] = useState<number | null>(null);
  const toast = useToastActions();


  // Role-aware UI (F3 Phase 3.4):
  // - team_admin: list is server-scoped to managed teams' projects.
  //   No create/delete/purge buttons.
  // - admin/super_admin: full management.
  const { role: viewerRole } = useCurrentUserRole();
  const { teams: managedTeams, loading: managedTeamsLoading } =
    useManagedTeams();
  const isTeamAdmin = viewerRole === "team_admin";
  const canCreateOrDelete = isOrgAdminOrAbove(viewerRole);
  // team_admin can now create AND edit projects (delete + dev-tools purge
  // are still org_admin only).
  const canCreateOrEdit = isAnyAdmin(viewerRole);

  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showPurgeModal, setShowPurgeModal] = useState(false);
  const [filters, setFilters] = useState<ProjectFiltersValue>(DEFAULT_FILTERS);
  const [activePageNum, setActivePageNum] = useState(1);
  const [inactivePageNum, setInactivePageNum] = useState(1);
  const ROWS_PER_PAGE = 20;

  useEffect(() => {
    setActivePageNum(1);
    setInactivePageNum(1);
  }, [filters]);

  const buildRefetchBody = useCallback((): Record<string, unknown> => {
    const body: Record<string, unknown> = {};
    if (filters.showMyProjects) body.created_by_me = true;
    if (filters.countryId) body.country_id = Number(filters.countryId);
    if (filters.regionId) body.region_id = Number(filters.regionId);
    if (filters.teamId) body.team_id = Number(filters.teamId);
    return body;
  }, [filters]);

  // Re-fetch projects when any filter changes. country_id, region_id,
  // and team_id are project-direct (look up via ProjectCountry /
  // ProjectTeam) — see fetch_org_projects in Projects.py.
  useEffect(() => {
    if (refetch) {
      const body = buildRefetchBody();
      refetch(Object.keys(body).length > 0 ? body : {});
    }
  }, [buildRefetchBody, refetch]);

  const activeProjects = projects?.org_active_projects ?? [];
  const inactiveProjects = projects?.org_inactive_projects ?? [];

  const handleDeleteProject = async () => {
    if (!selectedProject) return;

    try {
      await deleteProject({ project_id: selectedProject.id });
      toast.success("Project deleted successfully");
      setShowDeleteModal(false);
      setSelectedProject(null);
      refetch(buildRefetchBody());
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
            refetch(buildRefetchBody());
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

  const handlePurgeProjects = async () => {
    try {
      const result = await purgeProjects({});
      toast.success(
        `Purged ${result.projects_deleted} projects, ${result.tasks_deleted} tasks, reset ${result.users_reset} users`,
      );
      setShowPurgeModal(false);
      refetch(buildRefetchBody());
    } catch {
      toast.error("Failed to purge projects");
    }
  };

  const [projSortKey, setProjSortKey] = useState<string>("name");
  const [projSortDir, setProjSortDir] = useState<"asc" | "desc">("asc");

  const handleProjSort = (key: string) => {
    if (projSortKey === key) {
      setProjSortDir(projSortDir === "asc" ? "desc" : "asc");
    } else {
      setProjSortKey(key);
      setProjSortDir("asc");
    }
  };

  const sortProjects = (list: Project[]) => {
    const sorted = [...list];
    const dir = projSortDir === "asc" ? 1 : -1;
    sorted.sort((a, b) => {
      let aVal: string | number = "";
      let bVal: string | number = "";
      switch (projSortKey) {
        case "name":
          aVal = (a.short_name || a.name || "").toLowerCase();
          bVal = (b.short_name || b.name || "").toLowerCase();
          break;
        case "source_id":
          // project.id IS the source id (upstream TM4/MR numeric id is
          // persisted as our PK). Numeric compare for stable ordering.
          aVal = a.id ?? 0;
          bVal = b.id ?? 0;
          break;
        case "total_tasks":
          aVal = a.total_tasks ?? 0;
          bVal = b.total_tasks ?? 0;
          break;
        case "mapping_rate":
          aVal = a.mapping_rate_per_task ?? 0;
          bVal = b.mapping_rate_per_task ?? 0;
          break;
        case "budget":
          aVal = a.max_payment ?? 0;
          bVal = b.max_payment ?? 0;
          break;
        case "completion":
          aVal = getCompletionPct(a) ?? -1;
          bVal = getCompletionPct(b) ?? -1;
          break;
        case "difficulty":
          const diffOrder: Record<string, number> = {
            Easy: 1,
            Medium: 2,
            Hard: 3,
          };
          aVal = diffOrder[a.difficulty || ""] ?? 0;
          bVal = diffOrder[b.difficulty || ""] ?? 0;
          break;
        default:
          return 0;
      }
      if (aVal < bVal) return -1 * dir;
      if (aVal > bVal) return 1 * dir;
      return 0;
    });
    return sorted;
  };

  /** NFD-decompose + strip combining marks so accents don't sink an otherwise
   *  obvious match (e.g. searching "Vias Chia" needs to find "Vías Chía"). */
  const normalizeForSearch = (s: string): string =>
    (s || "")
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();

  const filterProjectsBySearch = (list: Project[]) => {
    if (!filters.search.trim()) return list;
    const q = normalizeForSearch(filters.search.trim());
    return list.filter((p) => {
      if (normalizeForSearch(p.name || "").includes(q)) return true;
      if (normalizeForSearch(p.short_name || "").includes(q)) return true;
      if (normalizeForSearch(p.url || "").includes(q)) return true;
      if (String(p.id).includes(q)) return true;
      return false;
    });
  };

  const filterProjectsByCompletion = (list: Project[]) => {
    if (!filters.completionFilter) return list;
    return list.filter((p) => {
      const pct = getCompletionPct(p) ?? 0;
      if (filters.completionFilter === "not-started") return pct === 0;
      if (filters.completionFilter === "in-progress") return pct >= 1 && pct <= 49;
      if (filters.completionFilter === "almost-done") return pct >= 50 && pct <= 99;
      if (filters.completionFilter === "complete") return pct === 100;
      return true;
    });
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
    { key: "completion", label: "Done", width: "w-[6%]" },
    { key: "mapping_rate", label: "Rates", width: "w-[9%]" },
    { key: "budget", label: "Budget", width: "w-[9%]" },
    { key: "difficulty", label: "Difficulty", width: "w-[10%]" },
  ];

  const ProjectTable = ({
    projectList,
    currentPage,
    setCurrentPage,
  }: {
    projectList: Project[];
    currentPage: number;
    setCurrentPage: (v: number | ((p: number) => number)) => void;
  }) => {
    const totalPages = Math.ceil(projectList.length / ROWS_PER_PAGE);
    const paginatedProjects = projectList.slice(
      (currentPage - 1) * ROWS_PER_PAGE,
      currentPage * ROWS_PER_PAGE,
    );
    const showingStart =
      projectList.length > 0 ? (currentPage - 1) * ROWS_PER_PAGE + 1 : 0;
    const showingEnd = Math.min(
      currentPage * ROWS_PER_PAGE,
      projectList.length,
    );

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
                        {project.short_name || project.name}
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
                    {(canCreateOrDelete || project.can_delete) && (
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
            {projectList.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="text-center py-8 text-muted-foreground"
                >
                  No projects found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {projectList.length > ROWS_PER_PAGE && (
          <div className="flex items-center justify-between mt-4 px-2">
            <span className="text-sm text-muted-foreground">
              Showing {showingStart}–{showingEnd} of {projectList.length}{" "}
              projects
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((p: number) => p - 1)}
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
                onClick={() => setCurrentPage((p: number) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </>
    );
  };

  if (loading && !projects) {
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
        {canCreateOrEdit && (
          <Button onClick={() => setShowAddModal(true)}>Add Project</Button>
        )}
      </div>

      {isTeamAdmin && (
        <div className="rounded-md border border-blue-200 bg-blue-50 dark:border-blue-900/50 dark:bg-blue-950/30 px-4 py-3 text-sm text-blue-900 dark:text-blue-200">
          You're seeing <strong>every project you created</strong> plus{" "}
          <strong>every project on a team you lead</strong>. New projects are
          active and visible by default. Tip: assign a new project to one of
          your teams so your mappers can see it too.
        </div>
      )}

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
              <Val>{formatNumber(activeProjects.length)}</Val>
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
              <Val>{formatNumber(inactiveProjects.length)}</Val>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Tasks</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              <Val>
                {formatNumber(
                  [...activeProjects, ...inactiveProjects].reduce(
                    (sum, p) => sum + p.total_tasks,
                    0,
                  ),
                )}
              </Val>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">By Platform</CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const all = [...activeProjects, ...inactiveProjects];
              const tm4 = all.filter((p) => p.source !== "mr").length;
              const mr = all.filter((p) => p.source === "mr").length;
              return (
                <div className="flex items-baseline gap-3">
                  <div>
                    <span className="text-2xl font-bold">
                      <Val>{formatNumber(tm4)}</Val>
                    </span>
                    <Badge variant="secondary" className="ml-1 text-[10px]">
                      TM4
                    </Badge>
                  </div>
                  <div>
                    <span className="text-2xl font-bold">
                      <Val>{formatNumber(mr)}</Val>
                    </span>
                    <Badge
                      variant="default"
                      className="ml-1 text-[10px] bg-blue-500"
                    >
                      MR
                    </Badge>
                  </div>
                </div>
              );
            })()}
          </CardContent>
        </Card>
      </div>

      <ProjectFilters
        filterOptions={filterOptions ?? null}
        onChange={setFilters}
        withTeam
        withMyProjects
        withCompletion
      />

      {/* Projects Tabs */}
      <Tabs defaultValue="active">
        <TabsList>
          <TabsTrigger value="active">
            Active ({activeProjects.length})
          </TabsTrigger>
          <TabsTrigger value="inactive">
            Inactive ({inactiveProjects.length})
          </TabsTrigger>
        </TabsList>
        <TabsContent value="active">
          <Card>
            <CardContent className="p-0">
              <ProjectTable
                projectList={sortProjects(
                  filterProjectsByCompletion(filterProjectsBySearch(activeProjects)),
                )}
                currentPage={activePageNum}
                setCurrentPage={setActivePageNum}
              />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="inactive">
          <Card>
            <CardContent className="p-0">
              <ProjectTable
                projectList={sortProjects(
                  filterProjectsByCompletion(filterProjectsBySearch(inactiveProjects)),
                )}
                currentPage={inactivePageNum}
                setCurrentPage={setInactivePageNum}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AddProjectModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onCreated={() => refetch(buildRefetchBody())}
      />

      <EditProjectModal
        isOpen={showEditModal}
        project={selectedProject}
        onClose={() => {
          setShowEditModal(false);
          setSelectedProject(null);
          refetch(buildRefetchBody());
        }}
        onSaved={() => refetch(buildRefetchBody())}
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
        message={`Are you sure you want to delete "${selectedProject?.name}"? This action cannot be undone and will remove all associated task and payment data.`}
        confirmText="Delete"
        variant="destructive"
        isLoading={deleting}
      />

      {/* Purge Confirmation */}
      <ConfirmDialog
        isOpen={showPurgeModal}
        onClose={() => setShowPurgeModal(false)}
        onConfirm={handlePurgeProjects}
        title="Purge All Projects"
        message="This will PERMANENTLY DELETE all projects, tasks, user-task relations, and reset user stats. This action cannot be undone!"
        confirmText="Purge All"
        variant="destructive"
        isLoading={purging}
      />

      {/* Dev Tools Section — Org Admin / Super Admin only. */}
      {/* Dev/purge tools hidden per management request 2026-05-19 —
          restore by removing the `false &&` guard below. */}
      {false && canCreateOrDelete && (
        <Card className="mt-8 border-dashed border-yellow-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-yellow-600">
              Dev Tools (Remove before production)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Button
              variant="destructive"
              onClick={() => setShowPurgeModal(true)}
              isLoading={purging}
            >
              Purge All Projects
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
