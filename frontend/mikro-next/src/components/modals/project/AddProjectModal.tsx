"use client";

import { useState } from "react";
import Link from "next/link";
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
  useCreateProject,
  useApiMutation,
  useAssignUser,
  useAssignTeamToProject,
  useFetchTeams,
  useFetchCountries,
  useAssignProjectLocations,
  useUsersList,
  useLookupProjectByUrl,
} from "@/hooks";
import type { TeamsResponse } from "@/types";

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

const defaultFormData: ProjectFormData = {
  url: "",
  source: "tm4",
  short_name: "",
  mapping_rate: "0.10",
  validation_rate: "0.05",
  visibility: true,
  difficulty: "Medium",
  community: false,
  priority: "Medium",
  status: true,
  payments_enabled: false,
};

type AddPreflight =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "ok"; sourceId: number | null }
  | {
      state: "dupe-here";
      sourceId: number;
      project: { id: number; name: string; short_name: string | null };
    }
  | { state: "dupe-other-org"; sourceId: number }
  | { state: "unparseable" };

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Called after the project is successfully created, e.g. to refresh the list. */
  onCreated?: () => void;
}

export function AddProjectModal({ isOpen, onClose, onCreated }: Props) {
  const { mutate: createProject, loading: creating } = useCreateProject();
  const { mutate: calculateBudget } = useApiMutation<{
    calculation: string;
    status: number;
  }>("/project/calculate_budget");
  const { mutate: toggleAssignUser } = useAssignUser();
  const { mutate: assignTeamToProject } = useAssignTeamToProject();
  const { mutate: assignProjectLocations } = useAssignProjectLocations();
  const { mutate: lookupProjectByUrl } = useLookupProjectByUrl();
  const { data: allTeamsData } = useFetchTeams();
  const { data: countriesData } = useFetchCountries();
  const { data: allUsersData, loading: loadingAllUsers } = useUsersList();
  const toast = useToastActions();

  const [formData, setFormData] = useState<ProjectFormData>(defaultFormData);
  const [addTab, setAddTab] = useState<
    "details" | "locations" | "teams" | "users"
  >("details");
  const [budgetCalculation, setBudgetCalculation] = useState("");
  const [addLocationSearch, setAddLocationSearch] = useState("");
  const [addUserSearch, setAddUserSearch] = useState("");
  const [preSelectedCountryIds, setPreSelectedCountryIds] = useState<
    Set<number>
  >(new Set());
  const [preSelectedTeamIds, setPreSelectedTeamIds] = useState<Set<number>>(
    new Set(),
  );
  const [preSelectedUserIds, setPreSelectedUserIds] = useState<Set<string>>(
    new Set(),
  );
  const [addPreflight, setAddPreflight] = useState<AddPreflight>({
    state: "idle",
  });

  const handleInputChange = (
    field: keyof ProjectFormData,
    value: string | boolean,
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const reset = () => {
    setFormData(defaultFormData);
    setBudgetCalculation("");
    setAddTab("details");
    setPreSelectedCountryIds(new Set());
    setPreSelectedTeamIds(new Set());
    setPreSelectedUserIds(new Set());
    setAddLocationSearch("");
    setAddUserSearch("");
    setAddPreflight({ state: "idle" });
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const runAddPreflight = async () => {
    const url = formData.url.trim();
    if (!url) {
      setAddPreflight({ state: "idle" });
      return;
    }
    setAddPreflight({ state: "checking" });
    try {
      const res = await lookupProjectByUrl({ url });
      if (!res?.exists) {
        if (res?.parseable === false) {
          setAddPreflight({ state: "unparseable" });
        } else {
          setAddPreflight({ state: "ok", sourceId: res?.source_id ?? null });
        }
        return;
      }
      if (res.same_org && res.project) {
        setAddPreflight({
          state: "dupe-here",
          sourceId: res.source_id ?? res.project.id,
          project: res.project,
        });
      } else {
        setAddPreflight({
          state: "dupe-other-org",
          sourceId: res.source_id ?? 0,
        });
      }
    } catch (err) {
      console.error("preflight check failed", err);
      setAddPreflight({ state: "idle" });
    }
  };

  const handleCalculateBudget = async () => {
    if (!formData.url) {
      toast.error("Please enter a project URL");
      return;
    }
    try {
      const result = await calculateBudget({
        url: formData.url,
        rate_type: true,
        mapping_rate: parseFloat(formData.mapping_rate),
        validation_rate: parseFloat(formData.validation_rate),
      });
      setBudgetCalculation(result.calculation || "");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to calculate budget",
      );
    }
  };

  const handleCreate = async () => {
    if (!formData.url) {
      toast.error("Please enter a project URL");
      return;
    }
    try {
      const result = await createProject({
        url: formData.url,
        source: formData.source,
        short_name: formData.short_name.trim() || undefined,
        rate_type: true,
        mapping_rate: formData.payments_enabled
          ? parseFloat(formData.mapping_rate)
          : 0,
        validation_rate: formData.payments_enabled
          ? parseFloat(formData.validation_rate)
          : 0,
        visibility: formData.visibility,
        payments_enabled: formData.payments_enabled,
        community: formData.community,
        priority: formData.priority,
      });

      const projectId = result.project_id;
      const assignResults: string[] = [];

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

      for (const teamId of preSelectedTeamIds) {
        try {
          await assignTeamToProject({ teamId, projectId });
        } catch {
          // continue with remaining teams
        }
      }
      if (preSelectedTeamIds.size > 0) {
        assignResults.push(`${preSelectedTeamIds.size} team(s)`);
      }

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

      const suffix =
        assignResults.length > 0
          ? ` — assigned ${assignResults.join(", ")}`
          : "";
      toast.success(`Project created${suffix}`);
      reset();
      onClose();
      onCreated?.();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create project",
      );
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Add New Project"
      description="Add a TM4 or MapRoulette project to Mikro for payment tracking"
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            isLoading={creating}
            disabled={creating || addPreflight.state === "dupe-here"}
          >
            Create Project
          </Button>
        </>
      }
    >
      <Tabs
        defaultValue="details"
        value={addTab}
        onValueChange={(v) =>
          setAddTab(v as "details" | "locations" | "teams" | "users")
        }
      >
        <TabsList className="mb-4">
          <TabsTrigger value="details">Project Details</TabsTrigger>
          <TabsTrigger value="locations">
            Locations
            {preSelectedCountryIds.size > 0
              ? ` (${preSelectedCountryIds.size})`
              : ""}
          </TabsTrigger>
          <TabsTrigger value="teams">
            Teams
            {preSelectedTeamIds.size > 0 ? ` (${preSelectedTeamIds.size})` : ""}
          </TabsTrigger>
          <TabsTrigger value="users">
            Users
            {preSelectedUserIds.size > 0 ? ` (${preSelectedUserIds.size})` : ""}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="details">
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">
                Project Source
              </label>
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
              label={
                formData.source === "mr"
                  ? "MapRoulette Challenge URL"
                  : "TM4 Project URL"
              }
              placeholder={
                formData.source === "mr"
                  ? "https://maproulette.org/browse/challenges/123"
                  : "https://tasks.kaart.com/projects/123"
              }
              value={formData.url}
              onChange={(e) => {
                handleInputChange("url", e.target.value);
                if (addPreflight.state !== "idle") {
                  setAddPreflight({ state: "idle" });
                }
              }}
              onBlur={runAddPreflight}
            />
            {/* Preflight duplicate-check banner (2026-05-21, Logan ask).
                Runs on URL blur. Surfaces same-org dupes with a link to
                the existing project; cross-org dupes get a generic
                message (no name leakage). */}
            {addPreflight.state === "checking" && (
              <p className="text-xs text-muted-foreground -mt-2">
                Checking for duplicates…
              </p>
            )}
            {addPreflight.state === "dupe-here" && (
              <div className="bg-red-50 dark:bg-red-950/30 border border-red-300 dark:border-red-800 rounded-md p-3 text-sm">
                <p className="font-medium text-red-700 dark:text-red-300">
                  Already in Mikro
                </p>
                <p className="text-red-600 dark:text-red-400 mt-1">
                  Source ID {addPreflight.sourceId} — &quot;
                  {addPreflight.project.name}&quot;
                  {addPreflight.project.short_name
                    ? ` (${addPreflight.project.short_name})`
                    : ""}
                </p>
                <Link
                  href={`/projects/${addPreflight.project.id}`}
                  className="inline-block mt-1 text-red-700 dark:text-red-300 underline"
                >
                  Open existing project →
                </Link>
              </div>
            )}
            {addPreflight.state === "dupe-other-org" && (
              <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 rounded-md p-3 text-sm">
                <p className="font-medium text-amber-700 dark:text-amber-300">
                  Source ID {addPreflight.sourceId} belongs to another
                  organization
                </p>
                <p className="text-amber-600 dark:text-amber-400 mt-1">
                  The same upstream project has already been imported by another
                  org. Ask a super admin if cross-org access is needed.
                </p>
              </div>
            )}
            {addPreflight.state === "unparseable" && (
              <p className="text-xs text-amber-600">
                Could not extract a project id from this URL — double-check the
                format.
              </p>
            )}
            <Input
              label="Short Name (optional)"
              placeholder="Leave blank to auto-derive from project name"
              value={formData.short_name}
              onChange={(e) => handleInputChange("short_name", e.target.value)}
            />
            <div className="flex items-center gap-2 mb-4">
              <input
                type="checkbox"
                id="add-payments-enabled"
                checked={formData.payments_enabled}
                onChange={(e) =>
                  handleInputChange("payments_enabled", e.target.checked)
                }
                className="rounded border-input"
              />
              <label
                htmlFor="add-payments-enabled"
                className="text-sm font-medium"
              >
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
                <div className="border-t border-border pt-4">
                  <Button
                    variant="outline"
                    onClick={handleCalculateBudget}
                    className="w-full"
                  >
                    Calculate Budget
                  </Button>
                  {budgetCalculation && (
                    <p className="mt-2 text-sm text-muted-foreground bg-muted p-3 rounded-lg">
                      {budgetCalculation}
                    </p>
                  )}
                </div>
              </div>
            )}
            <div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="add-visibility"
                  checked={formData.visibility}
                  onChange={(e) =>
                    handleInputChange("visibility", e.target.checked)
                  }
                  className="rounded border-input"
                />
                <label htmlFor="add-visibility" className="text-sm font-medium">
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
                id="add-community"
                checked={formData.community}
                onChange={(e) =>
                  handleInputChange("community", e.target.checked)
                }
                className="rounded border-input"
              />
              <label htmlFor="add-community" className="text-sm font-medium">
                Community project
              </label>
            </div>
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
                <p className="text-sm font-medium">
                  Selected ({preSelectedCountryIds.size})
                </p>
                <div className="flex flex-wrap gap-1">
                  {Array.from(preSelectedCountryIds).map((id) => {
                    const c = countriesData?.countries?.find(
                      (c) => c.id === id,
                    );
                    return c ? (
                      <Badge
                        key={id}
                        variant="success"
                        className="cursor-pointer"
                        onClick={() => {
                          const next = new Set(preSelectedCountryIds);
                          next.delete(id);
                          setPreSelectedCountryIds(next);
                        }}
                      >
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
                  return (
                    c.name.toLowerCase().includes(q) ||
                    (c.iso_code && c.iso_code.toLowerCase().includes(q))
                  );
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
                    <span className="text-xs text-muted-foreground">
                      {country.iso_code || ""}
                    </span>
                  </button>
                ))}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="teams">
          {!(allTeamsData as TeamsResponse)?.teams?.length ? (
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
                    <TableHead className="text-right">Assign</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {((allTeamsData as TeamsResponse)?.teams || []).map(
                    (team) => {
                      const isSelected = preSelectedTeamIds.has(team.id);
                      return (
                        <TableRow key={team.id}>
                          <TableCell className="font-medium">
                            {team.name}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant="secondary">
                              {team.member_count}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {team.lead_names && team.lead_names.length > 0
                              ? team.lead_names.join(", ")
                              : team.lead_name || "None"}
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
                    },
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* Users tab — pre-select individual users to assign at create time.
            Defers API calls until the project exists (handleCreate). */}
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
            ) : !allUsersData?.users?.length ? (
              <p className="text-muted-foreground text-center py-8">
                No users in organization
              </p>
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
                  <p className="text-muted-foreground text-center py-8">
                    No users match the search.
                  </p>
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
                              <TableCell className="font-medium">
                                {user.name || "—"}
                              </TableCell>
                              <TableCell className="text-muted-foreground">
                                {user.email || "—"}
                              </TableCell>
                              <TableCell className="text-muted-foreground">
                                {user.osm_username || "—"}
                              </TableCell>
                              <TableCell className="text-right">
                                <Button
                                  size="sm"
                                  variant={
                                    isSelected ? "destructive" : "primary"
                                  }
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
  );
}
