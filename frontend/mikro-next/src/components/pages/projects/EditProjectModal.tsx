"use client";

import { useState, useEffect } from "react";
import LocationsTab from "@/components/LocationsTab";
import ProjectTrainingsTab from "@/components/ProjectTrainingsTab";
import {
  Modal,
  Button,
  Input,
  Select,
  Badge,
  Skeleton,
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
} from "@/components/ui";
import { useToastActions } from "@/components/ui";
import {
  useUpdateProject,
  useFetchProjectUsers,
  useAssignUser,
  useFetchProjectTeams,
  useAssignTeamToProject,
  useUnassignTeamFromProject,
} from "@/hooks";
import type { Project, ProjectTeamItem } from "@/types";

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
  visibility: boolean;
  difficulty: string;
  community: boolean;
  priority: "Low" | "Medium" | "High";
  status: boolean;
  payments_enabled: boolean;
}

function formDataFromProject(project: Project): ProjectFormData {
  return {
    url: project.url,
    source: project.source ?? "tm4",
    short_name: project.short_name ?? "",
    mapping_rate: project.mapping_rate_per_task.toString(),
    validation_rate: project.validation_rate_per_task.toString(),
    visibility: project.visibility ?? false,
    difficulty: project.difficulty ?? "Medium",
    community: project.community ?? false,
    priority: (project.priority as "Low" | "Medium" | "High") ?? "Medium",
    status: project.status ?? true,
    payments_enabled: project.payments_enabled ?? true,
  };
}

interface Props {
  isOpen: boolean;
  project: Project | null;
  onClose: () => void;
  onSaved: () => void;
}

export function EditProjectModal({ isOpen, project, onClose, onSaved }: Props) {
  const { mutate: updateProject, loading: updating } = useUpdateProject();
  const { mutate: fetchProjectUsers, loading: loadingUsers } =
    useFetchProjectUsers();
  const { mutate: toggleAssignUser, loading: assigning } = useAssignUser();
  const { mutate: fetchProjectTeams, loading: loadingTeams } =
    useFetchProjectTeams();
  const { mutate: assignTeamToProject } = useAssignTeamToProject();
  const { mutate: unassignTeamFromProject } = useUnassignTeamFromProject();
  const toast = useToastActions();

  const [formData, setFormData] = useState<ProjectFormData>(
    project ? formDataFromProject(project) : ({} as ProjectFormData),
  );
  const [editTab, setEditTab] = useState<
    "settings" | "users" | "teams" | "training" | "locations"
  >("settings");
  const [loading, setLoading] = useState(false);
  const [projectUsers, setProjectUsers] = useState<ProjectUserItem[]>([]);
  const [projectTeams, setProjectTeams] = useState<ProjectTeamItem[]>([]);

  // When the modal opens with a new project, populate form and fetch tab data.
  // 2026-05-21: Promise.allSettled so a 4xx on one endpoint (e.g.
  // fetch_project_users 403ing for a team_admin) doesn't blank the OTHER tab.
  useEffect(() => {
    if (!project) return;
    setFormData(formDataFromProject(project));
    setEditTab("settings");
    setLoading(true);
    Promise.allSettled([
      fetchProjectUsers({ project_id: project.id }),
      fetchProjectTeams({ projectId: project.id }),
    ])
      .then(([usersResult, teamsResult]) => {
        if (usersResult.status === "fulfilled") {
          setProjectUsers(usersResult.value?.users ?? []);
        } else {
          console.error("Failed to fetch project users", usersResult.reason);
          setProjectUsers([]);
        }
        if (teamsResult.status === "fulfilled") {
          setProjectTeams(teamsResult.value?.teams ?? []);
        } else {
          console.error("Failed to fetch project teams", teamsResult.reason);
          setProjectTeams([]);
        }
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  const handleInputChange = (
    field: keyof ProjectFormData,
    value: string | boolean,
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    if (!project) return;
    try {
      await updateProject({
        project_id: project.id,
        short_name: formData.short_name,
        difficulty: formData.difficulty,
        rate_type: true,
        mapping_rate: formData.payments_enabled
          ? parseFloat(formData.mapping_rate)
          : 0,
        validation_rate: formData.payments_enabled
          ? parseFloat(formData.validation_rate)
          : 0,
        visibility: formData.visibility,
        project_status: formData.status,
        payments_enabled: formData.payments_enabled,
        community: formData.community,
        priority: formData.priority,
      });
      toast.success("Project updated successfully");
      onClose();
      onSaved();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update project",
      );
    }
  };

  const handleToggleUserAssignment = async (userId: string) => {
    if (!project) return;
    try {
      await toggleAssignUser({ project_id: project.id, user_id: userId });
      const response = await fetchProjectUsers({ project_id: project.id });
      setProjectUsers(response?.users ?? []);
      toast.success("User assignment updated");
    } catch {
      toast.error("Failed to update user assignment");
    }
  };

  const handleToggleTeamAssignment = async (
    teamId: number,
    currentStatus: string,
  ) => {
    if (!project) return;
    try {
      if (currentStatus === "Assigned") {
        const result = await unassignTeamFromProject({
          teamId,
          projectId: project.id,
        });
        toast.success(`Team removed — ${result.removed} user(s) unassigned`);
      } else {
        const result = await assignTeamToProject({
          teamId,
          projectId: project.id,
        });
        toast.success(
          `Team assigned — ${result.assigned} user(s) added${result.skipped ? `, ${result.skipped} already assigned` : ""}`,
        );
      }
      const [usersResponse, teamsResponse] = await Promise.all([
        fetchProjectUsers({ project_id: project.id }),
        fetchProjectTeams({ projectId: project.id }),
      ]);
      setProjectUsers(usersResponse?.users ?? []);
      setProjectTeams(teamsResponse?.teams ?? []);
    } catch {
      toast.error("Failed to update team assignment");
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Edit Project"
      description={`Editing ${project?.name || "project"}`}
      size="lg"
      footer={
        loading ? null : (
          <>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleSave} isLoading={updating}>
              Save Changes
            </Button>
          </>
        )
      }
    >
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-foreground" />
          <p className="text-sm text-muted-foreground">
            Loading project data…
          </p>
        </div>
      ) : (
        <Tabs
          defaultValue="settings"
          value={editTab}
          onValueChange={(v) =>
            setEditTab(
              v as "settings" | "users" | "teams" | "training" | "locations",
            )
          }
        >
          <TabsList className="mb-4">
            <TabsTrigger value="settings">Settings</TabsTrigger>
            <TabsTrigger value="users">
              Users ({projectUsers.filter((u) => u.assigned === "Yes").length})
            </TabsTrigger>
            <TabsTrigger value="teams">
              Teams (
              {projectTeams.filter((t) => t.assigned === "Assigned").length})
            </TabsTrigger>
            <TabsTrigger value="training">Training</TabsTrigger>
            <TabsTrigger value="locations">Locations</TabsTrigger>
          </TabsList>

          <TabsContent value="settings">
            <div className="space-y-4">
              {/* 2026-05-21 (Logan ask): show long name as read-only alongside
                  the editable short name. Source URL + id are read-only too. */}
              <Input
                label="Long Name"
                value={project?.name ?? ""}
                readOnly
                disabled
              />
              <Input
                label="Short Name"
                placeholder="e.g. Philippines — Construction Check"
                value={formData.short_name}
                onChange={(e) =>
                  handleInputChange("short_name", e.target.value)
                }
              />
              {project && (
                <div className="grid grid-cols-2 gap-4">
                  <Input
                    label="Source ID"
                    value={String(project.id)}
                    readOnly
                    disabled
                  />
                  <Input
                    label={project.source === "mr" ? "MapRoulette URL" : "TM4 URL"}
                    value={project.url || ""}
                    readOnly
                    disabled
                  />
                </div>
              )}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="edit-payments-enabled"
                  checked={formData.payments_enabled}
                  onChange={(e) =>
                    handleInputChange("payments_enabled", e.target.checked)
                  }
                  className="rounded border-input"
                />
                <label
                  htmlFor="edit-payments-enabled"
                  className="text-sm font-medium"
                >
                  Enable Payments
                </label>
                <span className="text-xs text-muted-foreground">
                  (uncheck for stats-only tracking)
                </span>
              </div>
              {!formData.payments_enabled && (
                <p className="text-xs text-amber-600">
                  Disabling payments will not reverse already-accumulated
                  earnings
                </p>
              )}
              {formData.payments_enabled && (
                <div className="grid grid-cols-2 gap-4">
                  <Input
                    label="Mapping Rate ($)"
                    type="number"
                    step="0.01"
                    value={formData.mapping_rate}
                    onChange={(e) =>
                      handleInputChange("mapping_rate", e.target.value)
                    }
                  />
                  <Input
                    label="Validation Rate ($)"
                    type="number"
                    step="0.01"
                    value={formData.validation_rate}
                    onChange={(e) =>
                      handleInputChange("validation_rate", e.target.value)
                    }
                  />
                </div>
              )}
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
              <Select
                label="Priority"
                value={formData.priority}
                onChange={(value) =>
                  handleInputChange(
                    "priority",
                    value as "Low" | "Medium" | "High",
                  )
                }
                options={[
                  { value: "Low", label: "Low" },
                  { value: "Medium", label: "Medium" },
                  { value: "High", label: "High" },
                ]}
              />
              <div className="space-y-3">
                <div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="edit-visibility"
                      checked={formData.visibility}
                      onChange={(e) =>
                        handleInputChange("visibility", e.target.checked)
                      }
                      className="rounded border-input"
                    />
                    <label
                      htmlFor="edit-visibility"
                      className="text-sm font-medium"
                    >
                      Publicly visible
                    </label>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 ml-6">
                    If checked, anyone in the org can see this project. If
                    unchecked, only assigned users and teams can see it.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="edit-status"
                    checked={formData.status}
                    onChange={(e) =>
                      handleInputChange("status", e.target.checked)
                    }
                    className="rounded border-input"
                  />
                  <label
                    htmlFor="edit-status"
                    className="text-sm font-medium"
                  >
                    Active
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="edit-community"
                    checked={formData.community}
                    onChange={(e) =>
                      handleInputChange("community", e.target.checked)
                    }
                    className="rounded border-input"
                  />
                  <label
                    htmlFor="edit-community"
                    className="text-sm font-medium"
                  >
                    Community project
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
              <p className="text-muted-foreground text-center py-8">
                No users in organization
              </p>
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
                        <TableCell className="font-medium">
                          {user.name}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {user.email}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge
                            variant={
                              user.assigned === "Yes" ? "success" : "secondary"
                            }
                          >
                            {user.assigned}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant={
                              user.assigned === "Yes"
                                ? "destructive"
                                : "primary"
                            }
                            onClick={() =>
                              handleToggleUserAssignment(user.id)
                            }
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
              <p className="text-muted-foreground text-center py-8">
                No teams in organization
              </p>
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
                        <TableCell className="font-medium">
                          {team.name}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="secondary">{team.member_count}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {team.lead_names && team.lead_names.length > 0
                            ? team.lead_names.join(", ")
                            : team.lead_name || "None"}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge
                            variant={
                              team.assigned === "Assigned"
                                ? "success"
                                : "secondary"
                            }
                          >
                            {team.assigned}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant={
                              team.assigned === "Assigned"
                                ? "destructive"
                                : "primary"
                            }
                            onClick={() =>
                              handleToggleTeamAssignment(
                                team.id,
                                team.assigned,
                              )
                            }
                          >
                            {team.assigned === "Assigned"
                              ? "Unassign"
                              : "Assign"}
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
            {project && <ProjectTrainingsTab projectId={project.id} />}
          </TabsContent>

          <TabsContent value="locations">
            {project && (
              <LocationsTab resourceId={project.id} resourceType="project" />
            )}
          </TabsContent>
        </Tabs>
      )}
    </Modal>
  );
}
