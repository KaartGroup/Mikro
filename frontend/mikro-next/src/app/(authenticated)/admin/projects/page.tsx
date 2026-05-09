"use client";

import { useState, useEffect, useCallback } from "react";
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
import { StandaloneFilter } from "@/components/admin/StandaloneFilter";
import LocationsTab from "@/components/LocationsTab";
import ProjectTrainingsTab from "@/components/ProjectTrainingsTab";
import {
  useOrgProjects,
  useCreateProject,
  useUpdateProject,
  useDeleteProject,
  useApiMutation,
  useFetchProjectUsers,
  useAssignUser,
  usePurgeProjects,
  useFetchProjectTeams,
  useAssignTeamToProject,
  useUnassignTeamFromProject,
  useSyncProject,
  useCheckSyncStatus,
  useFetchFilterOptions,
  useFetchTeams,
  useFetchCountries,
  useAssignProjectLocations,
  useUsersList,
  useCurrentUserRole,
  useManagedTeams,
} from "@/hooks";
import { TeamAdminEmptyState } from "@/components/admin/TeamAdminEmptyState";
import Link from "next/link";
import { formatNumber, formatCurrency, getProjectExternalUrl } from "@/lib/utils";
import { Val } from "@/components/ui";
import { isOrgAdminOrAbove } from "@/types";
import type { Project, ProjectTeamItem, TeamsResponse } from "@/types";

interface ProjectUserItem {
  id: string;
  name: string;
  email: string;
  assigned: string;
}

interface ProjectFormData {
  url: string;
  source: "tm4" | "mr";
  short_name: string;
  mapping_rate: string;
  validation_rate: string;
  max_editors: string;
  max_validators: string;
  visibility: boolean;
  difficulty: string;
  status: boolean;
  payments_enabled: boolean;
}

const defaultFormData: ProjectFormData = {
  url: "",
  source: "tm4",
  short_name: "",
  mapping_rate: "0.10",
  validation_rate: "0.05",
  max_editors: "5",
  max_validators: "3",
  // Private by default — only assigned users + teams see the project
  // until an admin explicitly opts in to publicity.
  visibility: false,
  difficulty: "Medium",
  status: true,
  payments_enabled: true,
};

export default function AdminProjectsPage() {
  const { data: projects, loading, refetch } = useOrgProjects();
  const { data: filterOptions } = useFetchFilterOptions();
  const { mutate: createProject, loading: creating } = useCreateProject();
  const { mutate: updateProject, loading: updating } = useUpdateProject();
  const { mutate: deleteProject, loading: deleting } = useDeleteProject();
  const { mutate: calculateBudget } = useApiMutation<{ calculation: string; status: number }>(
    "/project/calculate_budget"
  );
  const { mutate: fetchProjectUsers, loading: loadingUsers } = useFetchProjectUsers();
  const { mutate: toggleAssignUser, loading: assigning } = useAssignUser();
  const { mutate: purgeProjects, loading: purging } = usePurgeProjects();
  const { mutate: fetchProjectTeams, loading: loadingTeams } = useFetchProjectTeams();
  const { mutate: assignTeamToProject } = useAssignTeamToProject();
  const { mutate: unassignTeamFromProject } = useUnassignTeamFromProject();
  const { mutate: syncProject } = useSyncProject();
  const { mutate: checkSyncStatus } = useCheckSyncStatus();
  // Full org user list — drives the pre-select Users tab on the Add-Project
  // modal so admins can pick assignees at create time instead of having
  // to edit the project afterwards (UI20).
  const { data: allUsersData, loading: loadingAllUsers } = useUsersList();
  const [syncingProjectId, setSyncingProjectId] = useState<number | null>(null);
  const toast = useToastActions();

  // Role-aware UI (F3 Phase 3.4):
  // - team_admin: list is server-scoped to managed teams' projects.
  //   No create/delete/purge buttons.
  // - admin/super_admin: full management.
  const { role: viewerRole, loading: roleLoading } = useCurrentUserRole();
  const { teams: managedTeams, loading: managedTeamsLoading } = useManagedTeams();
  const isTeamAdmin = viewerRole === "team_admin";
  const canCreateOrDelete = isOrgAdminOrAbove(viewerRole);

  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editModalLoading, setEditModalLoading] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showPurgeModal, setShowPurgeModal] = useState(false);
  const [formData, setFormData] = useState<ProjectFormData>(defaultFormData);
  const [budgetCalculation, setBudgetCalculation] = useState("");
  const [projectUsers, setProjectUsers] = useState<ProjectUserItem[]>([]);
  const [projectTeams, setProjectTeams] = useState<ProjectTeamItem[]>([]);
  const [editTab, setEditTab] = useState<"settings" | "users" | "teams" | "training" | "locations">("settings");
  const [showMyProjects, setShowMyProjects] = useState(false);
  // Standalone filter dropdowns. Each null = "All …" (no filter).
  const [filterRegionId, setFilterRegionId] = useState<string | null>(null);
  const [filterCountryId, setFilterCountryId] = useState<string | null>(null);
  const [filterTeamId, setFilterTeamId] = useState<string | null>(null);
  const [projectSearch, setProjectSearch] = useState("");
  const [activePageNum, setActivePageNum] = useState(1);
  const [inactivePageNum, setInactivePageNum] = useState(1);
  const ROWS_PER_PAGE = 20;
  const [newProjectId, setNewProjectId] = useState<number | null>(null);
  const [addTab, setAddTab] = useState<"details" | "locations" | "teams" | "users">("details");
  const [addProjectTeams, setAddProjectTeams] = useState<ProjectTeamItem[]>([]);

  // Pre-creation location & team selection
  const { data: allTeamsData } = useFetchTeams();
  const { data: countriesData } = useFetchCountries();
  const { mutate: assignProjectLocations } = useAssignProjectLocations();
  const [preSelectedCountryIds, setPreSelectedCountryIds] = useState<Set<number>>(new Set());
  const [preSelectedTeamIds, setPreSelectedTeamIds] = useState<Set<number>>(new Set());
  // User ids are Auth0 sub strings (or tracked|uuid), so Set<string>.
  const [preSelectedUserIds, setPreSelectedUserIds] = useState<Set<string>>(new Set());
  const [addUserSearch, setAddUserSearch] = useState("");
  const [addLocationSearch, setAddLocationSearch] = useState("");

  // Reset pagination when search or filters change
  useEffect(() => {
    setActivePageNum(1);
    setInactivePageNum(1);
  }, [projectSearch, showMyProjects, filterRegionId, filterCountryId, filterTeamId]);

  // Build the request body from current filter state. Used both by
  // the auto-refetch effect below and by post-mutation refetches
  // (create / edit / delete / sync) so they all keep the active
  // filters applied.
  const buildRefetchBody = useCallback((): Record<string, unknown> => {
    const body: Record<string, unknown> = {};
    if (showMyProjects) body.created_by_me = true;
    if (filterCountryId) body.country_id = Number(filterCountryId);
    if (filterRegionId) body.region_id = Number(filterRegionId);
    if (filterTeamId) body.team_id = Number(filterTeamId);
    return body;
  }, [showMyProjects, filterCountryId, filterRegionId, filterTeamId]);

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

  const handleInputChange = (field: keyof ProjectFormData, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleCalculateBudget = async () => {
    if (!formData.url) {
      toast.error("Please enter a project URL");
      return;
    }

    try {
      const payload: Record<string, unknown> = {
        url: formData.url,
        rate_type: true,
        mapping_rate: parseFloat(formData.mapping_rate),
        validation_rate: parseFloat(formData.validation_rate),
      };
      // Only include project_id if we're editing an existing project
      if (selectedProject?.id) {
        payload.project_id = selectedProject.id;
      }
      const result = await calculateBudget(payload);
      setBudgetCalculation(result.calculation || "");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to calculate budget";
      toast.error(message);
    }
  };

  const handleCreateProject = async () => {
    if (!formData.url) {
      toast.error("Please enter a project URL");
      return;
    }

    try {
      const result = await createProject({
        url: formData.url,
        source: formData.source,
        rate_type: true,
        mapping_rate: formData.payments_enabled ? parseFloat(formData.mapping_rate) : 0,
        validation_rate: formData.payments_enabled ? parseFloat(formData.validation_rate) : 0,
        max_editors: parseInt(formData.max_editors),
        max_validators: parseInt(formData.max_validators),
        visibility: formData.visibility,
        payments_enabled: formData.payments_enabled,
      });

      const projectId = result.project_id;
      const assignResults: string[] = [];

      // Assign pre-selected locations
      if (preSelectedCountryIds.size > 0) {
        try {
          const locResult = await assignProjectLocations({
            resourceId: projectId,
            countryIds: Array.from(preSelectedCountryIds),
            regionIds: [],
          });
          assignResults.push(`${locResult.created} location(s)`);
        } catch {
          assignResults.push("locations failed");
        }
      }

      // Assign pre-selected teams
      for (const teamId of preSelectedTeamIds) {
        try {
          await assignTeamToProject({ teamId, projectId });
        } catch {
          // continue with other teams
        }
      }
      if (preSelectedTeamIds.size > 0) {
        assignResults.push(`${preSelectedTeamIds.size} team(s)`);
      }

      // Assign pre-selected individual users. toggleAssignUser flips the
      // current state, and on a fresh project every user starts
      // unassigned, so one call per user results in an assignment.
      let userAssignFailures = 0;
      for (const userId of preSelectedUserIds) {
        try {
          await toggleAssignUser({ project_id: projectId, user_id: userId });
        } catch {
          userAssignFailures += 1;
        }
      }
      if (preSelectedUserIds.size > 0) {
        const ok = preSelectedUserIds.size - userAssignFailures;
        assignResults.push(
          userAssignFailures > 0
            ? `${ok}/${preSelectedUserIds.size} user(s)`
            : `${ok} user(s)`,
        );
      }

      const suffix = assignResults.length > 0 ? ` — assigned ${assignResults.join(", ")}` : "";
      toast.success(`Project created${suffix}`);

      // Close modal and reset
      setShowAddModal(false);
      setFormData(defaultFormData);
      setBudgetCalculation("");
      setNewProjectId(null);
      setAddTab("details");
      setAddProjectTeams([]);
      setPreSelectedCountryIds(new Set());
      setPreSelectedTeamIds(new Set());
      setPreSelectedUserIds(new Set());
      setAddLocationSearch("");
      setAddUserSearch("");
      refetch(buildRefetchBody());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create project";
      toast.error(message);
    }
  };

  const handleUpdateProject = async () => {
    if (!selectedProject) return;

    try {
      await updateProject({
        project_id: selectedProject.id,
        short_name: formData.short_name,
        difficulty: formData.difficulty,
        rate_type: true,
        mapping_rate: formData.payments_enabled ? parseFloat(formData.mapping_rate) : 0,
        validation_rate: formData.payments_enabled ? parseFloat(formData.validation_rate) : 0,
        max_editors: parseInt(formData.max_editors),
        max_validators: parseInt(formData.max_validators),
        visibility: formData.visibility,
        project_status: formData.status,
        payments_enabled: formData.payments_enabled,
      });
      toast.success("Project updated successfully");
      setShowEditModal(false);
      setSelectedProject(null);
      refetch(buildRefetchBody());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update project";
      toast.error(message);
    }
  };

  const handleDeleteProject = async () => {
    if (!selectedProject) return;

    try {
      await deleteProject({ project_id: selectedProject.id });
      toast.success("Project deleted successfully");
      setShowDeleteModal(false);
      setSelectedProject(null);
      refetch(buildRefetchBody());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete project";
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

  const openEditModal = async (project: Project) => {
    setSelectedProject(project);
    setFormData({
      url: project.url,
      source: project.source ?? "tm4",
      short_name: project.short_name ?? "",
      mapping_rate: project.mapping_rate_per_task.toString(),
      validation_rate: project.validation_rate_per_task.toString(),
      max_editors: project.max_editors?.toString() ?? "5",
      max_validators: project.max_validators?.toString() ?? "3",
      visibility: project.visibility ?? false,
      difficulty: project.difficulty ?? "Medium",
      status: project.status ?? true,
      payments_enabled: project.payments_enabled ?? true,
    });
    setEditTab("settings");
    setEditModalLoading(true);
    setShowEditModal(true);
    // Fetch users and teams for this project
    try {
      const [usersResponse, teamsResponse] = await Promise.all([
        fetchProjectUsers({ project_id: project.id }),
        fetchProjectTeams({ projectId: project.id }),
      ]);
      setProjectUsers(usersResponse?.users ?? []);
      setProjectTeams(teamsResponse?.teams ?? []);
    } catch {
      console.error("Failed to fetch project data");
      setProjectUsers([]);
      setProjectTeams([]);
    } finally {
      setEditModalLoading(false);
    }
  };

  const handleToggleUserAssignment = async (userId: string) => {
    if (!selectedProject) return;
    try {
      await toggleAssignUser({ project_id: selectedProject.id, user_id: userId });
      // Refresh the users list
      const response = await fetchProjectUsers({ project_id: selectedProject.id });
      setProjectUsers(response?.users ?? []);
      toast.success("User assignment updated");
    } catch {
      toast.error("Failed to update user assignment");
    }
  };

  const handleToggleTeamAssignment = async (teamId: number, currentStatus: string) => {
    if (!selectedProject) return;
    try {
      if (currentStatus === "Assigned") {
        const result = await unassignTeamFromProject({
          teamId,
          projectId: selectedProject.id,
        });
        toast.success(`Team removed — ${result.removed} user(s) unassigned`);
      } else {
        const result = await assignTeamToProject({
          teamId,
          projectId: selectedProject.id,
        });
        toast.success(
          `Team assigned — ${result.assigned} user(s) added${result.skipped ? `, ${result.skipped} already assigned` : ""}`
        );
      }
      // Refresh both teams and users lists
      const [usersResponse, teamsResponse] = await Promise.all([
        fetchProjectUsers({ project_id: selectedProject.id }),
        fetchProjectTeams({ projectId: selectedProject.id }),
      ]);
      setProjectUsers(usersResponse?.users ?? []);
      setProjectTeams(teamsResponse?.teams ?? []);
    } catch {
      toast.error("Failed to update team assignment");
    }
  };

  const handleToggleAddTeamAssignment = async (teamId: number, currentStatus: string) => {
    if (!newProjectId) return;
    try {
      if (currentStatus === "Assigned") {
        const result = await unassignTeamFromProject({ teamId, projectId: newProjectId });
        toast.success(`Team removed — ${result.removed} user(s) unassigned`);
      } else {
        const result = await assignTeamToProject({ teamId, projectId: newProjectId });
        toast.success(
          `Team assigned — ${result.assigned} user(s) added${result.skipped ? `, ${result.skipped} already assigned` : ""}`
        );
      }
      const teamsResponse = await fetchProjectTeams({ projectId: newProjectId });
      setAddProjectTeams(teamsResponse?.teams ?? []);
    } catch {
      toast.error("Failed to update team assignment");
    }
  };

  const openDeleteModal = (project: Project) => {
    setSelectedProject(project);
    setShowDeleteModal(true);
  };

  const handlePurgeProjects = async () => {
    try {
      const result = await purgeProjects({});
      toast.success(`Purged ${result.projects_deleted} projects, ${result.tasks_deleted} tasks, reset ${result.users_reset} users`);
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
          const diffOrder: Record<string, number> = { Easy: 1, Medium: 2, Hard: 3 };
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

  const filterProjectsBySearch = (list: Project[]) => {
    if (!projectSearch.trim()) return list;
    const search = projectSearch.trim().toLowerCase();
    return list.filter(
      (p) =>
        (p.name || "").toLowerCase().includes(search) ||
        (p.short_name || "").toLowerCase().includes(search)
    );
  };

  /** Calculate completion % for a project (TM4 or MR). Capped at 100%. */
  const getCompletionPct = (project: Project): number | null => {
    try {
      if (!project.total_tasks || project.total_tasks === 0) return null;
      if (project.source === "mr" && project.mr_status_breakdown && typeof project.mr_status_breakdown === "object" && !Array.isArray(project.mr_status_breakdown)) {
        const breakdown = project.mr_status_breakdown as Record<string, number>;
        // Count all trackable MR statuses: Fixed(1), FalsePositive(2), Skipped(3), AlreadyFixed(5), CantComplete(6)
        const completed = (breakdown["1"] ?? 0) + (breakdown["2"] ?? 0) + (breakdown["3"] ?? 0) + (breakdown["5"] ?? 0) + (breakdown["6"] ?? 0);
        return Math.min(Math.round((completed / project.total_tasks) * 100), 100);
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
    { key: "name", label: "Project", width: "w-[26%]" },
    { key: "total_tasks", label: "Tasks", width: "w-[6%]" },
    { key: "", label: "Progress", width: "w-[14%]" },
    { key: "completion", label: "Done", width: "w-[6%]" },
    { key: "mapping_rate", label: "Rates", width: "w-[11%]" },
    { key: "budget", label: "Budget", width: "w-[11%]" },
    { key: "difficulty", label: "Difficulty", width: "w-[10%]" },
  ];

  const ProjectTable = ({ projectList, currentPage, setCurrentPage }: { projectList: Project[]; currentPage: number; setCurrentPage: (v: number | ((p: number) => number)) => void }) => {
    const totalPages = Math.ceil(projectList.length / ROWS_PER_PAGE);
    const paginatedProjects = projectList.slice(
      (currentPage - 1) * ROWS_PER_PAGE,
      currentPage * ROWS_PER_PAGE
    );
    const showingStart = projectList.length > 0 ? (currentPage - 1) * ROWS_PER_PAGE + 1 : 0;
    const showingEnd = Math.min(currentPage * ROWS_PER_PAGE, projectList.length);

    return (<>
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
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d={projSortDir === "asc" ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} />
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
                  <Link href={`/admin/projects/${project.id}`} className="font-medium text-kaart-orange hover:underline" title={project.name}>
                    {project.short_name || project.name}
                  </Link>
                  {project.source === "mr" ? (
                    <Badge variant="default" className="ml-2 text-[10px] bg-blue-500">MR</Badge>
                  ) : (
                    <Badge variant="secondary" className="ml-2 text-[10px]">TM4</Badge>
                  )}
                </div>
                <a
                  href={getProjectExternalUrl(project.id, project.source)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-kaart-orange hover:underline"
                  title={project.source === "mr" ? "Open in MapRoulette" : "Open in Tasking Manager"}
                >
                  #{project.id}
                </a>
              </div>
            </TableCell>
            <TableCell>
              {project.total_tasks === 0 && !project.last_synced ? (
                <span className="text-muted-foreground italic text-sm" title="Tasks haven't been synced from the source yet">Pending sync</span>
              ) : (
                <Val>{formatNumber(project.total_tasks)}</Val>
              )}
            </TableCell>
            <TableCell>
              {project.total_tasks === 0 && !project.last_synced ? (
                <span className="text-muted-foreground italic text-sm">—</span>
              ) : project.source === "mr" ? (
                <div className="text-sm space-y-0.5">
                  <p className="text-green-600"><Val>{formatNumber(project.mr_status_breakdown?.["1"] ?? 0)}</Val> Fixed</p>
                  <p className="text-emerald-500"><Val>{formatNumber(project.mr_status_breakdown?.["5"] ?? 0)}</Val> Already Fixed</p>
                  <p className="text-amber-600"><Val>{formatNumber(project.mr_status_breakdown?.["2"] ?? 0)}</Val> Not an Issue</p>
                  <p className="text-orange-500"><Val>{formatNumber(project.mr_status_breakdown?.["6"] ?? 0)}</Val> Can&apos;t Complete</p>
                  <p className="text-gray-400"><Val>{formatNumber(project.mr_status_breakdown?.["3"] ?? 0)}</Val> Skipped</p>
                </div>
              ) : (
                <div className="text-sm">
                  <p className="text-green-600"><Val>{formatNumber(project.total_mapped)}</Val> mapped</p>
                  <p className="text-blue-600"><Val>{formatNumber(project.total_validated)}</Val> validated</p>
                  <p className="text-red-600"><Val>{formatNumber(project.total_invalidated)}</Val> invalidated</p>
                </div>
              )}
            </TableCell>
            <TableCell>
              {(() => {
                try {
                  const pct = getCompletionPct(project);
                  if (pct === null) return <span className="text-muted-foreground text-sm">—</span>;
                  return <span className={`text-sm font-semibold ${completionColor(pct)}`}>{pct}%</span>;
                } catch {
                  return <span className="text-muted-foreground text-sm">—</span>;
                }
              })()}
            </TableCell>
            <TableCell>
              {project.payments_enabled === false ? (
                <Badge variant="secondary">Stats Only</Badge>
              ) : (
                <div className="text-sm">
                  <p>Map: <Val>{formatCurrency(project.mapping_rate_per_task)}</Val></p>
                  <p>Val: <Val>{formatCurrency(project.validation_rate_per_task)}</Val></p>
                </div>
              )}
            </TableCell>
            <TableCell>
              <div className="text-sm">
                <p>Max: <Val>{formatCurrency(project.max_payment)}</Val></p>
                <p className="text-muted-foreground">
                  Paid: <Val>{formatCurrency(project.total_payout)}</Val>
                </p>
              </div>
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-1">
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
                {(project as Project & { assigned_locations?: number }).assigned_locations ? (
                  <Badge variant="secondary" className="text-[10px]">
                    {(project as Project & { assigned_locations?: number }).assigned_locations} loc
                  </Badge>
                ) : null}
                {(project as Project & { assigned_trainings?: number }).assigned_trainings ? (
                  <Badge variant="secondary" className="text-[10px]">
                    {(project as Project & { assigned_trainings?: number }).assigned_trainings} trn
                  </Badge>
                ) : null}
              </div>
            </TableCell>
            <TableCell className="text-right pr-2">
              <div className="flex justify-end gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleSyncProject(project.id, project.name)}
                  isLoading={syncingProjectId === project.id}
                  disabled={syncingProjectId !== null}
                >
                  Sync
                </Button>
                <Button size="sm" variant="outline" onClick={() => openEditModal(project)}>
                  Edit
                </Button>
                {canCreateOrDelete && (
                  <Button size="sm" variant="destructive" onClick={() => openDeleteModal(project)}>
                    Delete
                  </Button>
                )}
              </div>
            </TableCell>
          </TableRow>
        ))}
        {projectList.length === 0 && (
          <TableRow>
            <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
              No projects found
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
    {projectList.length > ROWS_PER_PAGE && (
      <div className="flex items-center justify-between mt-4 px-2">
        <span className="text-sm text-muted-foreground">
          Showing {showingStart}–{showingEnd} of {projectList.length} projects
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
    </>);
  };

  if ((loading && !projects) || roleLoading) {
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
  if (
    isTeamAdmin &&
    !managedTeamsLoading &&
    managedTeams.length === 0
  ) {
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
        {canCreateOrDelete && (
          <Button onClick={() => setShowAddModal(true)}>Add Project</Button>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Active Projects</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600"><Val>{formatNumber(activeProjects.length)}</Val></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Inactive Projects</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600"><Val>{formatNumber(inactiveProjects.length)}</Val></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Tasks</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              <Val>{formatNumber([...activeProjects, ...inactiveProjects].reduce((sum, p) => sum + p.total_tasks, 0))}</Val>
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
                    <span className="text-2xl font-bold"><Val>{formatNumber(tm4)}</Val></span>
                    <Badge variant="secondary" className="ml-1 text-[10px]">TM4</Badge>
                  </div>
                  <div>
                    <span className="text-2xl font-bold"><Val>{formatNumber(mr)}</Val></span>
                    <Badge variant="default" className="ml-1 text-[10px] bg-blue-500">MR</Badge>
                  </div>
                </div>
              );
            })()}
          </CardContent>
        </Card>
      </div>

      {/* Filters — each filterable dimension is its own visible
          dropdown so admins don't have to discover an "Add filter"
          menu. All default to "All …" (no filter). Project-direct
          filtering: backend looks up ProjectCountry / ProjectTeam. */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col">
          <label className="mb-1.5 block text-sm font-medium text-foreground">
            Search
          </label>
          <input
            type="text"
            placeholder="Search projects..."
            className="h-10 rounded-lg border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring w-48"
            value={projectSearch}
            onChange={(e) => setProjectSearch(e.target.value)}
          />
        </div>
        <div className="w-44">
          <StandaloneFilter
            label="Region"
            allLabel="All regions"
            options={(filterOptions?.dimensions?.region ?? [])
              .map((v) =>
                typeof v === "string"
                  ? { value: v, label: v }
                  : { value: String(v.id ?? v.name), label: v.name },
              )}
            value={filterRegionId}
            onChange={setFilterRegionId}
          />
        </div>
        <div className="w-44">
          <StandaloneFilter
            label="Country"
            allLabel="All countries"
            options={(filterOptions?.dimensions?.country ?? [])
              .map((v) =>
                typeof v === "string"
                  ? { value: v, label: v }
                  : { value: String(v.id ?? v.name), label: v.name },
              )}
            value={filterCountryId}
            onChange={setFilterCountryId}
          />
        </div>
        <div className="w-44">
          <StandaloneFilter
            label="Team"
            allLabel="All teams"
            options={(filterOptions?.dimensions?.team ?? [])
              .map((v) =>
                typeof v === "string"
                  ? { value: v, label: v }
                  : { value: String(v.id ?? v.name), label: v.name },
              )}
            value={filterTeamId}
            onChange={setFilterTeamId}
          />
        </div>
        <div className="ml-auto">
          <Button
            variant={showMyProjects ? "primary" : "outline"}
            size="sm"
            onClick={() => setShowMyProjects(!showMyProjects)}
          >
            My Projects
          </Button>
        </div>
      </div>

      {/* Projects Tabs */}
      <Tabs defaultValue="active">
        <TabsList>
          <TabsTrigger value="active">Active ({activeProjects.length})</TabsTrigger>
          <TabsTrigger value="inactive">Inactive ({inactiveProjects.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="active">
          <Card>
            <CardContent className="p-0">
              <ProjectTable projectList={sortProjects(filterProjectsBySearch(activeProjects))} currentPage={activePageNum} setCurrentPage={setActivePageNum} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="inactive">
          <Card>
            <CardContent className="p-0">
              <ProjectTable projectList={sortProjects(filterProjectsBySearch(inactiveProjects))} currentPage={inactivePageNum} setCurrentPage={setInactivePageNum} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Add Project Modal */}
      <Modal
        isOpen={showAddModal}
        onClose={() => {
          setShowAddModal(false);
          setFormData(defaultFormData);
          setBudgetCalculation("");
          setNewProjectId(null);
          setAddTab("details");
          setAddProjectTeams([]);
          setPreSelectedCountryIds(new Set());
          setPreSelectedTeamIds(new Set());
          setPreSelectedUserIds(new Set());
          setAddLocationSearch("");
          setAddUserSearch("");
        }}
        title="Add New Project"
        description="Add a TM4 or MapRoulette project to Mikro for payment tracking"
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowAddModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateProject} isLoading={creating}>
              Create Project
            </Button>
          </>
        }
      >
        <Tabs defaultValue="details" value={addTab} onValueChange={(v) => setAddTab(v as "details" | "locations" | "teams" | "users")}>
          <TabsList className="mb-4">
            <TabsTrigger value="details">Project Details</TabsTrigger>
            <TabsTrigger value="locations">
              Locations{preSelectedCountryIds.size > 0 ? ` (${preSelectedCountryIds.size})` : ""}
            </TabsTrigger>
            <TabsTrigger value="teams">
              Teams{preSelectedTeamIds.size > 0 ? ` (${preSelectedTeamIds.size})` : ""}
            </TabsTrigger>
            <TabsTrigger value="users">
              Users{preSelectedUserIds.size > 0 ? ` (${preSelectedUserIds.size})` : ""}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="details">
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">Project Source</label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="add-source"
                        value="tm4"
                        checked={formData.source === "tm4"}
                        onChange={() => handleInputChange("source", "tm4")}
                        className="accent-kaart-orange"
                      />
                      <span className="text-sm">TM4 (Tasking Manager)</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="add-source"
                        value="mr"
                        checked={formData.source === "mr"}
                        onChange={() => handleInputChange("source", "mr")}
                        className="accent-kaart-orange"
                      />
                      <span className="text-sm">MapRoulette</span>
                    </label>
                  </div>
                </div>
                <Input
                  label={formData.source === "mr" ? "MapRoulette Challenge URL" : "TM4 Project URL"}
                  placeholder={formData.source === "mr" ? "https://maproulette.org/browse/challenges/123" : "https://tasks.kaart.com/projects/123"}
                  value={formData.url}
                  onChange={(e) => handleInputChange("url", e.target.value)}
                />
                <div className="flex items-center gap-2 mb-4">
                  <input
                    type="checkbox"
                    id="add-payments-enabled"
                    checked={formData.payments_enabled}
                    onChange={(e) => handleInputChange("payments_enabled", e.target.checked)}
                    className="rounded border-input"
                  />
                  <label htmlFor="add-payments-enabled" className="text-sm font-medium">
                    Enable Payments
                  </label>
                  <span className="text-xs text-muted-foreground">
                    (uncheck for stats-only tracking)
                  </span>
                </div>
                {formData.payments_enabled && (
                  <div className="grid grid-cols-2 gap-4">
                    <Input
                      label="Mapping Rate ($)"
                      type="number"
                      step="0.01"
                      value={formData.mapping_rate}
                      onChange={(e) => handleInputChange("mapping_rate", e.target.value)}
                    />
                    <Input
                      label="Validation Rate ($)"
                      type="number"
                      step="0.01"
                      value={formData.validation_rate}
                      onChange={(e) => handleInputChange("validation_rate", e.target.value)}
                    />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <Input
                    label="Max Editors"
                    type="number"
                    value={formData.max_editors}
                    onChange={(e) => handleInputChange("max_editors", e.target.value)}
                  />
                  <Input
                    label="Max Validators"
                    type="number"
                    value={formData.max_validators}
                    onChange={(e) => handleInputChange("max_validators", e.target.value)}
                  />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="add-visibility"
                      checked={formData.visibility}
                      onChange={(e) => handleInputChange("visibility", e.target.checked)}
                      className="rounded border-input"
                    />
                    <label htmlFor="add-visibility" className="text-sm font-medium">
                      Publicly visible
                    </label>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 ml-6">
                    If checked, anyone in the org can see this project. If unchecked, only assigned users and teams can see it.
                  </p>
                </div>
                <div className="border-t border-border pt-4">
                  <Button variant="outline" onClick={handleCalculateBudget} className="w-full">
                    Calculate Budget
                  </Button>
                  {budgetCalculation && (
                    <p className="mt-2 text-sm text-muted-foreground bg-muted p-3 rounded-lg">
                      {budgetCalculation}
                    </p>
                  )}
                </div>
              </div>
          </TabsContent>

          <TabsContent value="locations">
            <div className="space-y-4">
              <div>
                <Input
                  placeholder="Search countries..."
                  value={addLocationSearch}
                  onChange={(e) => setAddLocationSearch(e.target.value)}
                />
              </div>
              {preSelectedCountryIds.size > 0 && (
                <div className="space-y-1">
                  <p className="text-sm font-medium">Selected ({preSelectedCountryIds.size})</p>
                  <div className="flex flex-wrap gap-1">
                    {Array.from(preSelectedCountryIds).map((id) => {
                      const c = countriesData?.countries?.find((c) => c.id === id);
                      return c ? (
                        <Badge key={id} variant="success" className="cursor-pointer" onClick={() => {
                          const next = new Set(preSelectedCountryIds);
                          next.delete(id);
                          setPreSelectedCountryIds(next);
                        }}>
                          {c.name} &times;
                        </Badge>
                      ) : null;
                    })}
                  </div>
                </div>
              )}
              <div className="max-h-60 overflow-y-auto border rounded-md">
                {(countriesData?.countries || [])
                  .filter((c) => !preSelectedCountryIds.has(c.id))
                  .filter((c) => {
                    if (!addLocationSearch.trim()) return true;
                    const q = addLocationSearch.toLowerCase();
                    return c.name.toLowerCase().includes(q) || (c.iso_code && c.iso_code.toLowerCase().includes(q));
                  })
                  .map((country) => (
                    <button
                      key={country.id}
                      type="button"
                      className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground border-b last:border-b-0"
                      onClick={() => {
                        const next = new Set(preSelectedCountryIds);
                        next.add(country.id);
                        setPreSelectedCountryIds(next);
                      }}
                    >
                      <span>{country.name}</span>
                      <span className="text-xs text-muted-foreground">{country.iso_code || ""}</span>
                    </button>
                  ))}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="teams">
            {!(allTeamsData as TeamsResponse)?.teams?.length ? (
              <p className="text-muted-foreground text-center py-8">No teams in organization</p>
            ) : (
              <div className="max-h-80 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Team</TableHead>
                      <TableHead className="text-center">Members</TableHead>
                      <TableHead>Lead</TableHead>
                      <TableHead className="text-right">Assign</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {((allTeamsData as TeamsResponse)?.teams || []).map((team) => {
                      const isSelected = preSelectedTeamIds.has(team.id);
                      return (
                        <TableRow key={team.id}>
                          <TableCell className="font-medium">{team.name}</TableCell>
                          <TableCell className="text-center">
                            <Badge variant="secondary">{team.member_count}</Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {team.lead_name || "None"}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant={isSelected ? "destructive" : "primary"}
                              onClick={() => {
                                const next = new Set(preSelectedTeamIds);
                                if (isSelected) next.delete(team.id);
                                else next.add(team.id);
                                setPreSelectedTeamIds(next);
                              }}
                            >
                              {isSelected ? "Remove" : "Assign"}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          {/* Users tab — pre-select individual users to assign at create time.
              Mirrors the Edit modal's Users tab but defers the API calls
              until the project actually exists (handleCreateProject). */}
          <TabsContent value="users">
            <div className="space-y-3">
              <Input
                type="text"
                placeholder="Search users by name, email, or OSM username..."
                value={addUserSearch}
                onChange={(e) => setAddUserSearch(e.target.value)}
              />
              {loadingAllUsers ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : !(allUsersData?.users?.length) ? (
                <p className="text-muted-foreground text-center py-8">No users in organization</p>
              ) : (
                (() => {
                  const q = addUserSearch.trim().toLowerCase();
                  const filtered = (allUsersData?.users ?? []).filter((u) => {
                    if (!q) return true;
                    return (
                      (u.name || "").toLowerCase().includes(q) ||
                      (u.email || "").toLowerCase().includes(q) ||
                      (u.osm_username || "").toLowerCase().includes(q)
                    );
                  });
                  return filtered.length === 0 ? (
                    <p className="text-muted-foreground text-center py-8">No users match the search.</p>
                  ) : (
                    <div className="max-h-80 overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>User</TableHead>
                            <TableHead>Email</TableHead>
                            <TableHead>OSM Username</TableHead>
                            <TableHead className="text-right">Assign</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filtered.map((user) => {
                            const isSelected = preSelectedUserIds.has(user.id);
                            return (
                              <TableRow key={user.id}>
                                <TableCell className="font-medium">{user.name || "—"}</TableCell>
                                <TableCell className="text-muted-foreground">{user.email || "—"}</TableCell>
                                <TableCell className="text-muted-foreground">{user.osm_username || "—"}</TableCell>
                                <TableCell className="text-right">
                                  <Button
                                    size="sm"
                                    variant={isSelected ? "destructive" : "primary"}
                                    onClick={() => {
                                      const next = new Set(preSelectedUserIds);
                                      if (isSelected) next.delete(user.id);
                                      else next.add(user.id);
                                      setPreSelectedUserIds(next);
                                    }}
                                  >
                                    {isSelected ? "Remove" : "Assign"}
                                  </Button>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  );
                })()
              )}
            </div>
          </TabsContent>
        </Tabs>
      </Modal>

      {/* Edit Project Modal */}
      <Modal
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setSelectedProject(null);
          setProjectUsers([]);
          setProjectTeams([]);
          refetch(buildRefetchBody());
        }}
        title="Edit Project"
        description={`Editing ${selectedProject?.name || "project"}`}
        size="lg"
        footer={editModalLoading ? null : (
          <>
            <Button variant="outline" onClick={() => {
              setShowEditModal(false);
              setSelectedProject(null);
              setProjectUsers([]);
              setProjectTeams([]);
              refetch(buildRefetchBody());
            }}>
              Cancel
            </Button>
            <Button onClick={handleUpdateProject} isLoading={updating}>
              Save Changes
            </Button>
          </>
        )}
      >
        {editModalLoading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-foreground" />
            <p className="text-sm text-muted-foreground">Loading project data…</p>
          </div>
        ) : (
        <Tabs defaultValue="settings" value={editTab} onValueChange={(v) => setEditTab(v as "settings" | "users" | "teams" | "training" | "locations")}>
          <TabsList className="mb-4">
            <TabsTrigger value="settings">Settings</TabsTrigger>
            <TabsTrigger value="users">
              Users ({projectUsers.filter(u => u.assigned === "Yes").length}/{selectedProject?.max_editors ?? 0})
            </TabsTrigger>
            <TabsTrigger value="teams">
              Teams ({projectTeams.filter(t => t.assigned === "Assigned").length})
            </TabsTrigger>
            <TabsTrigger value="training">Training</TabsTrigger>
            <TabsTrigger value="locations">Locations</TabsTrigger>
          </TabsList>

          <TabsContent value="settings">
            <div className="space-y-4">
              <Input
                label="Short Name"
                placeholder="e.g. Philippines — Construction Check"
                value={formData.short_name}
                onChange={(e) => handleInputChange("short_name", e.target.value)}
              />
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="edit-payments-enabled"
                  checked={formData.payments_enabled}
                  onChange={(e) => handleInputChange("payments_enabled", e.target.checked)}
                  className="rounded border-input"
                />
                <label htmlFor="edit-payments-enabled" className="text-sm font-medium">
                  Enable Payments
                </label>
                <span className="text-xs text-muted-foreground">
                  (uncheck for stats-only tracking)
                </span>
              </div>
              {!formData.payments_enabled && (
                <p className="text-xs text-amber-600">
                  Disabling payments will not reverse already-accumulated earnings
                </p>
              )}
              {formData.payments_enabled && (
                <div className="grid grid-cols-2 gap-4">
                  <Input
                    label="Mapping Rate ($)"
                    type="number"
                    step="0.01"
                    value={formData.mapping_rate}
                    onChange={(e) => handleInputChange("mapping_rate", e.target.value)}
                  />
                  <Input
                    label="Validation Rate ($)"
                    type="number"
                    step="0.01"
                    value={formData.validation_rate}
                    onChange={(e) => handleInputChange("validation_rate", e.target.value)}
                  />
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="Max Editors"
                  type="number"
                  value={formData.max_editors}
                  onChange={(e) => handleInputChange("max_editors", e.target.value)}
                />
                <Input
                  label="Max Validators"
                  type="number"
                  value={formData.max_validators}
                  onChange={(e) => handleInputChange("max_validators", e.target.value)}
                />
              </div>
              <Select
                label="Difficulty"
                value={formData.difficulty}
                onChange={(value) => handleInputChange("difficulty", value)}
                options={[
                  { value: "Easy", label: "Easy" },
                  { value: "Medium", label: "Medium" },
                  { value: "Hard", label: "Hard" },
                ]}
              />
              <div className="space-y-3">
                <div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="edit-visibility"
                      checked={formData.visibility}
                      onChange={(e) => handleInputChange("visibility", e.target.checked)}
                      className="rounded border-input"
                    />
                    <label htmlFor="edit-visibility" className="text-sm font-medium">
                      Publicly visible
                    </label>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 ml-6">
                    If checked, anyone in the org can see this project. If unchecked, only assigned users and teams can see it.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="edit-status"
                    checked={formData.status}
                    onChange={(e) => handleInputChange("status", e.target.checked)}
                    className="rounded border-input"
                  />
                  <label htmlFor="edit-status" className="text-sm font-medium">
                    Active
                  </label>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="users">
            {loadingUsers ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : projectUsers.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">No users in organization</p>
            ) : (
              <div className="max-h-80 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead className="text-center">Assigned</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {projectUsers.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell className="font-medium">{user.name}</TableCell>
                        <TableCell className="text-muted-foreground">{user.email}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant={user.assigned === "Yes" ? "success" : "secondary"}>
                            {user.assigned}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant={user.assigned === "Yes" ? "destructive" : "primary"}
                            onClick={() => handleToggleUserAssignment(user.id)}
                            disabled={assigning}
                          >
                            {user.assigned === "Yes" ? "Unassign" : "Assign"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="teams">
            {loadingTeams ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : projectTeams.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">No teams in organization</p>
            ) : (
              <div className="max-h-80 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Team</TableHead>
                      <TableHead className="text-center">Members</TableHead>
                      <TableHead>Lead</TableHead>
                      <TableHead className="text-center">Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {projectTeams.map((team) => (
                      <TableRow key={team.id}>
                        <TableCell className="font-medium">{team.name}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant="secondary">{team.member_count}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {team.lead_name || "None"}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant={team.assigned === "Assigned" ? "success" : "secondary"}>
                            {team.assigned}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant={team.assigned === "Assigned" ? "destructive" : "primary"}
                            onClick={() => handleToggleTeamAssignment(team.id, team.assigned)}
                          >
                            {team.assigned === "Assigned" ? "Unassign" : "Assign"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="training">
            {selectedProject && (
              <ProjectTrainingsTab projectId={selectedProject.id} />
            )}
          </TabsContent>

          <TabsContent value="locations">
            {selectedProject && (
              <LocationsTab resourceId={selectedProject.id} resourceType="project" />
            )}
          </TabsContent>
        </Tabs>
        )}
      </Modal>

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
      {canCreateOrDelete && (
        <Card className="mt-8 border-dashed border-yellow-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-yellow-600">Dev Tools (Remove before production)</CardTitle>
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
