"use client";

import { useState, useRef } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  ConfirmDialog,
  Input,
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
  Val,
} from "@/components/ui";
import { useToastActions } from "@/components/ui";
import {
  useOrgTrainings,
  useDeleteTraining,
  useCurrentUserRole,
  useManagedTeams,
} from "@/hooks";
import type { Training } from "@/types";
import { isOrgAdminOrAbove } from "@/types";
import { formatNumber } from "@/lib/utils";
import { useRole } from "@/contexts/RoleContext";
import { TeamAdminEmptyState } from "@/components/admin/TeamAdminEmptyState";
import { AddTrainingModal } from "@/components/modals/training/AddTrainingModal";
import { EditTrainingModal } from "@/components/modals/training/EditTrainingModal";

export function AdminTraining() {
  const { data: trainings, loading, refetch } = useOrgTrainings();
  const { mutate: deleteTraining, loading: deleting } = useDeleteTraining();
  const { displayName: auth0UserName } = useRole();
  const toast = useToastActions();

  // Role-aware UI (F3 Phase 3.4):
  // - team_admin: list scoped server-side to managed-team trainings.
  //   No create/delete UI.
  const { role: viewerRole } = useCurrentUserRole();
  const { teams: managedTeams, loading: managedTeamsLoading } =
    useManagedTeams();
  const isTeamAdmin = viewerRole === "team_admin";
  const canCreateOrDelete = isOrgAdminOrAbove(viewerRole);

  const [selectedTraining, setSelectedTraining] = useState<Training | null>(
    null,
  );
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editInitialTab, setEditInitialTab] = useState<
    "settings" | "locations" | "questions"
  >("settings");
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortKey, setSortKey] = useState<string>("title");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const mappingTrainings = trainings?.org_mapping_trainings ?? [];
  const validationTrainings = trainings?.org_validation_trainings ?? [];
  const projectTrainings = trainings?.org_project_trainings ?? [];
  const allTrainings = [
    ...mappingTrainings,
    ...validationTrainings,
    ...projectTrainings,
  ];

  // Current user's name for "Created by Me" filtering
  const currentUserName = auth0UserName;

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const filterAndSort = (list: Training[]) => {
    let filtered = list;
    if (searchTerm.trim()) {
      const s = searchTerm.trim().toLowerCase();
      filtered = filtered.filter(
        (t) =>
          t.title.toLowerCase().includes(s) ||
          (t.created_by || "").toLowerCase().includes(s) ||
          (t.difficulty || "").toLowerCase().includes(s),
      );
    }
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      let aVal: string | number = "";
      let bVal: string | number = "";
      switch (sortKey) {
        case "title":
          aVal = a.title.toLowerCase();
          bVal = b.title.toLowerCase();
          break;
        case "difficulty": {
          const order: Record<string, number> = { Easy: 1, Medium: 2, Hard: 3 };
          aVal = order[a.difficulty] ?? 0;
          bVal = order[b.difficulty] ?? 0;
          break;
        }
        case "points":
          aVal = a.point_value;
          bVal = b.point_value;
          break;
        case "questions":
          aVal = a.questions?.length ?? 0;
          bVal = b.questions?.length ?? 0;
          break;
        case "created_by":
          aVal = (a.created_by || "").toLowerCase();
          bVal = (b.created_by || "").toLowerCase();
          break;
        default:
          return 0;
      }
      if (aVal < bVal) return -1 * dir;
      if (aVal > bVal) return 1 * dir;
      return 0;
    });
  };

  const myTrainings = allTrainings.filter(
    (t) =>
      t.created_by &&
      currentUserName &&
      t.created_by
        .toLowerCase()
        .includes(currentUserName.split(" ")[0].toLowerCase()),
  );

  const handleDeleteTraining = async () => {
    if (!selectedTraining) return;

    try {
      await deleteTraining({ training_id: selectedTraining.id });
      toast.success("Training deleted successfully");
      setShowDeleteModal(false);
      setSelectedTraining(null);
      refetch();
    } catch {
      toast.error("Failed to delete training");
    }
  };

  const openEditModal = (
    training: Training,
    tab: "settings" | "locations" | "questions" = "settings",
  ) => {
    setSelectedTraining(training);
    setEditInitialTab(tab);
    setShowEditModal(true);
  };

  const SortHeader = ({
    label,
    sortField,
  }: {
    label: string;
    sortField: string;
  }) => (
    <TableHead
      className="cursor-pointer select-none hover:text-kaart-orange transition-colors"
      onClick={() => handleSort(sortField)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortKey === sortField && (
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
              d={sortDir === "asc" ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"}
            />
          </svg>
        )}
      </span>
    </TableHead>
  );

  const ROWS_PER_PAGE = 20;

  const TrainingTable = ({ trainingList }: { trainingList: Training[] }) => {
    const [currentPage, setCurrentPage] = useState(1);
    const filtered = filterAndSort(trainingList);
    const totalPages = Math.ceil(filtered.length / ROWS_PER_PAGE);
    const paginated = filtered.slice(
      (currentPage - 1) * ROWS_PER_PAGE,
      currentPage * ROWS_PER_PAGE,
    );
    const showingStart =
      filtered.length === 0 ? 0 : (currentPage - 1) * ROWS_PER_PAGE + 1;
    const showingEnd = Math.min(currentPage * ROWS_PER_PAGE, filtered.length);

    // Reset page when search/sort changes
    const prevFilterLen = useRef(filtered.length);
    if (filtered.length !== prevFilterLen.current) {
      prevFilterLen.current = filtered.length;
      if (currentPage !== 1) setCurrentPage(1);
    }

    return (
      <>
        <Table>
          <TableHeader>
            <TableRow>
              <SortHeader label="Title" sortField="title" />
              <SortHeader label="Difficulty" sortField="difficulty" />
              <SortHeader label="Points" sortField="points" />
              <SortHeader label="Questions" sortField="questions" />
              <SortHeader label="Created By" sortField="created_by" />
              <TableHead>URL</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginated.map((training) => (
              <TableRow key={training.id}>
                <TableCell className="font-medium">{training.title}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Badge
                      variant={
                        training.difficulty === "Easy"
                          ? "success"
                          : training.difficulty === "Medium"
                            ? "warning"
                            : "destructive"
                      }
                    >
                      {training.difficulty}
                    </Badge>
                    {(training as Training & { assigned_locations?: number })
                      .assigned_locations ? (
                      <Badge variant="secondary" className="text-[10px]">
                        {
                          (
                            training as Training & {
                              assigned_locations?: number;
                            }
                          ).assigned_locations
                        }{" "}
                        loc
                      </Badge>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>{training.point_value}</TableCell>
                <TableCell>
                  <Val>{formatNumber(training.questions?.length ?? 0)}</Val>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  <Val>{training.created_by}</Val>
                </TableCell>
                <TableCell>
                  <a
                    href={training.training_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-kaart-orange hover:underline"
                  >
                    View
                  </a>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openEditModal(training, "questions")}
                    >
                      Questions
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openEditModal(training)}
                    >
                      Edit
                    </Button>
                    {canCreateOrDelete && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                          setSelectedTraining(training);
                          setShowDeleteModal(true);
                        }}
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
                  colSpan={7}
                  className="text-center py-8 text-muted-foreground"
                >
                  No trainings found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {filtered.length > ROWS_PER_PAGE && (
          <div className="flex items-center justify-between mt-4 px-2">
            <span className="text-sm text-muted-foreground">
              Showing {showingStart}–{showingEnd} of {filtered.length}
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
        )}
      </>
    );
  };

  if (loading) {
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
        <h1 className="text-3xl font-bold tracking-tight">Training</h1>
        <TeamAdminEmptyState context="training" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Training</h1>
          <p className="text-muted-foreground">
            Manage training modules and quizzes
          </p>
        </div>
        {canCreateOrDelete && (
          <Button onClick={() => setShowAddModal(true)}>Add Training</Button>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Total Trainings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              <Val>
                {formatNumber(
                  mappingTrainings.length +
                    validationTrainings.length +
                    projectTrainings.length,
                )}
              </Val>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Mapping</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-kaart-orange">
              <Val>{formatNumber(mappingTrainings.length)}</Val>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Validation</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              <Val>{formatNumber(validationTrainings.length)}</Val>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Project Specific
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">
              <Val>{formatNumber(projectTrainings.length)}</Val>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="flex-1">
        <Input
          placeholder="Search by title, creator, or difficulty..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {/* Trainings Tabs */}
      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">
            All ({formatNumber(allTrainings.length).text})
          </TabsTrigger>
          <TabsTrigger value="mine">
            Created by Me ({formatNumber(myTrainings.length).text})
          </TabsTrigger>
          <TabsTrigger value="mapping">
            Mapping ({formatNumber(mappingTrainings.length).text})
          </TabsTrigger>
          <TabsTrigger value="validation">
            Validation ({formatNumber(validationTrainings.length).text})
          </TabsTrigger>
          <TabsTrigger value="project">
            Project Specific ({formatNumber(projectTrainings.length).text})
          </TabsTrigger>
        </TabsList>
        <TabsContent value="all">
          <Card>
            <CardContent className="p-0">
              <TrainingTable trainingList={allTrainings} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="mine">
          <Card>
            <CardContent className="p-0">
              <TrainingTable trainingList={myTrainings} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="mapping">
          <Card>
            <CardContent className="p-0">
              <TrainingTable trainingList={mappingTrainings} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="validation">
          <Card>
            <CardContent className="p-0">
              <TrainingTable trainingList={validationTrainings} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="project">
          <Card>
            <CardContent className="p-0">
              <TrainingTable trainingList={projectTrainings} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Add Training Modal */}
      <AddTrainingModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onCreated={refetch}
      />

      {/* Edit Training Modal */}
      {showEditModal && selectedTraining && (
        <EditTrainingModal
          isOpen={showEditModal}
          onClose={() => {
            setShowEditModal(false);
            setSelectedTraining(null);
          }}
          onUpdated={refetch}
          training={selectedTraining}
          initialTab={editInitialTab}
        />
      )}

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setSelectedTraining(null);
        }}
        onConfirm={handleDeleteTraining}
        title="Delete Training"
        message={`Are you sure you want to delete "${selectedTraining?.title}"? This action cannot be undone.`}
        confirmText="Delete"
        variant="destructive"
        isLoading={deleting}
      />
    </div>
  );
}
