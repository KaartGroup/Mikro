"use client";

import { useState, useRef } from "react";
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
  Val,
} from "@/components/ui";
import { useToastActions } from "@/components/ui";
import LocationsTab from "@/components/LocationsTab";
import {
  useOrgTrainings,
  useCreateTraining,
  useUpdateTraining,
  useModifyTraining,
  useDeleteTraining,
  usePurgeTrainings,
  useCurrentUserRole,
  useManagedTeams,
} from "@/hooks";
import type { Training, TrainingQuestion } from "@/types";
import { isOrgAdminOrAbove } from "@/types";
import { formatNumber } from "@/lib/utils";
import { useUser } from "@auth0/nextjs-auth0/client";
import { TeamAdminEmptyState } from "@/components/admin/TeamAdminEmptyState";

interface TrainingFormData {
  title: string;
  training_url: string;
  point_value: string;
  difficulty: string;
  training_type: string;
  project_id: string;
}

const defaultFormData: TrainingFormData = {
  title: "",
  training_url: "",
  point_value: "10",
  difficulty: "Medium",
  training_type: "Mapping",
  project_id: "",
};

interface QuestionFormData {
  question: string;
  answers: { answer: string; correct: boolean }[];
}

export default function AdminTrainingPage() {
  const { data: trainings, loading, refetch } = useOrgTrainings();
  const { mutate: createTraining, loading: creating } = useCreateTraining();
  const { mutate: updateTraining, loading: updating } = useUpdateTraining();
  const { mutate: modifyTraining, loading: modifying } = useModifyTraining();
  const { mutate: deleteTraining, loading: deleting } = useDeleteTraining();
  const { mutate: purgeTrainings, loading: purging } = usePurgeTrainings();
  const { user: auth0User } = useUser();
  const toast = useToastActions();

  // Role-aware UI (F3 Phase 3.4):
  // - team_admin: list scoped server-side to managed-team trainings.
  //   No create/delete/purge UI.
  const { role: viewerRole, loading: roleLoading } = useCurrentUserRole();
  const { teams: managedTeams, loading: managedTeamsLoading } = useManagedTeams();
  const isTeamAdmin = viewerRole === "team_admin";
  const canCreateOrDelete = isOrgAdminOrAbove(viewerRole);

  const [selectedTraining, setSelectedTraining] = useState<Training | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showPurgeModal, setShowPurgeModal] = useState(false);
  const [formData, setFormData] = useState<TrainingFormData>(defaultFormData);
  const [questions, setQuestions] = useState<QuestionFormData[]>([]);
  const [editQuestions, setEditQuestions] = useState<QuestionFormData[]>([]);
  const [editTab, setEditTab] = useState<"settings" | "locations" | "questions">("settings");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortKey, setSortKey] = useState<string>("title");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const mappingTrainings = trainings?.org_mapping_trainings ?? [];
  const validationTrainings = trainings?.org_validation_trainings ?? [];
  const projectTrainings = trainings?.org_project_trainings ?? [];
  const allTrainings = [...mappingTrainings, ...validationTrainings, ...projectTrainings];

  // Current user's name for "Created by Me" filtering
  const currentUserName = auth0User?.name || "";

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
          (t.difficulty || "").toLowerCase().includes(s)
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
    (t) => t.created_by && currentUserName && t.created_by.toLowerCase().includes(currentUserName.split(" ")[0].toLowerCase())
  );

  const handleInputChange = (field: keyof TrainingFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleCreateTraining = async () => {
    if (!formData.title || !formData.training_url) {
      toast.error("Please fill in all required fields");
      return;
    }

    try {
      // Transform questions to backend format
      const formattedQuestions = questions.map((q) => {
        const correctAnswer = q.answers.find((a) => a.correct);
        const incorrectAnswers = q.answers.filter((a) => !a.correct);
        return {
          question: q.question,
          correct: correctAnswer?.answer || "",
          incorrect: incorrectAnswers.map((a) => ({ answer: a.answer })),
        };
      });

      await createTraining({
        title: formData.title,
        training_url: formData.training_url,
        point_value: parseInt(formData.point_value),
        difficulty: formData.difficulty,
        training_type: formData.training_type,
        project_id: formData.project_id ? parseInt(formData.project_id) : undefined,
        questions: formattedQuestions,
      });
      toast.success("Training created successfully");
      setShowAddModal(false);
      setFormData(defaultFormData);
      setQuestions([]);
      refetch();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create training";
      toast.error(message);
    }
  };

  const handleUpdateTraining = async () => {
    if (!selectedTraining) return;

    try {
      await updateTraining({
        training_id: selectedTraining.id,
        title: formData.title,
        training_url: formData.training_url,
        point_value: parseInt(formData.point_value),
        difficulty: formData.difficulty,
      });
      toast.success("Training updated successfully");
      setShowEditModal(false);
      setSelectedTraining(null);
      refetch();
    } catch {
      toast.error("Failed to update training");
    }
  };

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

  const handlePurgeTrainings = async () => {
    try {
      const result = await purgeTrainings({});
      toast.success(`Purged ${result.trainings_deleted} trainings, reset ${result.users_reset} users`);
      setShowPurgeModal(false);
      refetch();
    } catch {
      toast.error("Failed to purge trainings");
    }
  };

  const handleModifyTraining = async () => {
    if (!selectedTraining) return;

    try {
      // Transform editQuestions to backend format
      const formattedQuestions = editQuestions.map((q) => {
        const correctAnswer = q.answers.find((a) => a.correct);
        const incorrectAnswers = q.answers.filter((a) => !a.correct);
        return {
          question: q.question,
          correct: correctAnswer?.answer || "",
          incorrect: incorrectAnswers.map((a) => ({ answer: a.answer })),
        };
      });

      await modifyTraining({
        training_id: selectedTraining.id,
        title: formData.title,
        training_url: formData.training_url,
        point_value: parseInt(formData.point_value),
        difficulty: formData.difficulty,
        training_type: formData.training_type,
        questions: formattedQuestions,
      });
      toast.success("Training questions updated successfully");
      setShowEditModal(false);
      setSelectedTraining(null);
      refetch();
    } catch {
      toast.error("Failed to update training questions");
    }
  };

  const loadEditQuestions = (training: Training) => {
    setEditQuestions(
      training.questions?.map((q) => ({
        question: q.question,
        answers: q.answers.map((a) => ({ answer: a.answer, correct: a.correct })),
      })) ?? []
    );
  };

  const openEditModal = (training: Training, tab: "settings" | "locations" | "questions" = "settings") => {
    setSelectedTraining(training);
    setFormData({
      title: training.title,
      training_url: training.training_url,
      point_value: training.point_value.toString(),
      difficulty: training.difficulty,
      training_type: training.training_type ?? "Mapping",
      project_id: training.project_id?.toString() ?? "",
    });
    loadEditQuestions(training);
    setEditTab(tab);
    setShowEditModal(true);
  };

  const addEditQuestion = () => {
    setEditQuestions([
      ...editQuestions,
      {
        question: "",
        answers: [
          { answer: "", correct: true },
          { answer: "", correct: false },
          { answer: "", correct: false },
          { answer: "", correct: false },
        ],
      },
    ]);
  };

  const updateEditQuestion = (index: number, field: string, value: string) => {
    const updated = [...editQuestions];
    updated[index] = { ...updated[index], [field]: value };
    setEditQuestions(updated);
  };

  const updateEditAnswer = (qIndex: number, aIndex: number, field: string, value: string | boolean) => {
    const updated = [...editQuestions];
    updated[qIndex].answers[aIndex] = { ...updated[qIndex].answers[aIndex], [field]: value };
    if (field === "correct" && value === true) {
      updated[qIndex].answers = updated[qIndex].answers.map((a, i) => ({
        ...a,
        correct: i === aIndex,
      }));
    }
    setEditQuestions(updated);
  };

  const removeEditQuestion = (index: number) => {
    setEditQuestions(editQuestions.filter((_, i) => i !== index));
  };

  const addEditAnswer = (qIndex: number) => {
    const updated = [...editQuestions];
    updated[qIndex].answers = [...updated[qIndex].answers, { answer: "", correct: false }];
    setEditQuestions(updated);
  };

  const removeEditAnswer = (qIndex: number, aIndex: number) => {
    const updated = [...editQuestions];
    updated[qIndex].answers = updated[qIndex].answers.filter((_, i) => i !== aIndex);
    setEditQuestions(updated);
  };

  const addQuestion = () => {
    setQuestions([
      ...questions,
      {
        question: "",
        answers: [
          { answer: "", correct: true },
          { answer: "", correct: false },
          { answer: "", correct: false },
          { answer: "", correct: false },
        ],
      },
    ]);
  };

  const updateQuestion = (index: number, field: string, value: string) => {
    const updated = [...questions];
    updated[index] = { ...updated[index], [field]: value };
    setQuestions(updated);
  };

  const updateAnswer = (qIndex: number, aIndex: number, field: string, value: string | boolean) => {
    const updated = [...questions];
    updated[qIndex].answers[aIndex] = { ...updated[qIndex].answers[aIndex], [field]: value };
    if (field === "correct" && value === true) {
      // Only one correct answer per question
      updated[qIndex].answers = updated[qIndex].answers.map((a, i) => ({
        ...a,
        correct: i === aIndex,
      }));
    }
    setQuestions(updated);
  };

  const removeQuestion = (index: number) => {
    setQuestions(questions.filter((_, i) => i !== index));
  };

  const SortHeader = ({ label, sortField }: { label: string; sortField: string }) => (
    <TableHead
      className="cursor-pointer select-none hover:text-kaart-orange transition-colors"
      onClick={() => handleSort(sortField)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortKey === sortField && (
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d={sortDir === "asc" ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} />
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
    const paginated = filtered.slice((currentPage - 1) * ROWS_PER_PAGE, currentPage * ROWS_PER_PAGE);
    const showingStart = filtered.length === 0 ? 0 : (currentPage - 1) * ROWS_PER_PAGE + 1;
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
                    {(training as Training & { assigned_locations?: number }).assigned_locations ? (
                      <Badge variant="secondary" className="text-[10px]">
                        {(training as Training & { assigned_locations?: number }).assigned_locations} loc
                      </Badge>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>{training.point_value}</TableCell>
                <TableCell><Val>{formatNumber(training.questions?.length ?? 0)}</Val></TableCell>
                <TableCell className="text-sm text-muted-foreground"><Val>{training.created_by}</Val></TableCell>
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
                    <Button size="sm" variant="outline" onClick={() => openEditModal(training, "questions")}>
                      Questions
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openEditModal(training)}>
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
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
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
              <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}>Previous</Button>
              <span className="text-sm text-muted-foreground">Page {currentPage} of {totalPages}</span>
              <Button variant="outline" size="sm" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(p => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </>
    );
  };

  if (loading || roleLoading) {
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
            <CardTitle className="text-sm font-medium">Total Trainings</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              <Val>{formatNumber(mappingTrainings.length + validationTrainings.length + projectTrainings.length)}</Val>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Mapping</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-kaart-orange"><Val>{formatNumber(mappingTrainings.length)}</Val></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Validation</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600"><Val>{formatNumber(validationTrainings.length)}</Val></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Project Specific</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600"><Val>{formatNumber(projectTrainings.length)}</Val></div>
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
          <TabsTrigger value="all">All ({formatNumber(allTrainings.length).text})</TabsTrigger>
          <TabsTrigger value="mine">Created by Me ({formatNumber(myTrainings.length).text})</TabsTrigger>
          <TabsTrigger value="mapping">Mapping ({formatNumber(mappingTrainings.length).text})</TabsTrigger>
          <TabsTrigger value="validation">Validation ({formatNumber(validationTrainings.length).text})</TabsTrigger>
          <TabsTrigger value="project">Project Specific ({formatNumber(projectTrainings.length).text})</TabsTrigger>
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
      <Modal
        isOpen={showAddModal}
        onClose={() => {
          setShowAddModal(false);
          setFormData(defaultFormData);
          setQuestions([]);
        }}
        title="Add New Training"
        description="Create a new training module with quiz questions"
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowAddModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateTraining} isLoading={creating}>
              Create Training
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Title"
            placeholder="Training title"
            value={formData.title}
            onChange={(e) => handleInputChange("title", e.target.value)}
          />
          <Input
            label="Training URL"
            placeholder="https://..."
            value={formData.training_url}
            onChange={(e) => handleInputChange("training_url", e.target.value)}
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Point Value"
              type="number"
              value={formData.point_value}
              onChange={(e) => handleInputChange("point_value", e.target.value)}
            />
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
          </div>
          <Select
            label="Training Type"
            value={formData.training_type}
            onChange={(value) => handleInputChange("training_type", value)}
            options={[
              { value: "Mapping", label: "Mapping" },
              { value: "Validation", label: "Validation" },
              { value: "Project", label: "Project Specific" },
            ]}
          />
          {formData.training_type === "Project" && (
            <Input
              label="Project ID"
              type="number"
              placeholder="Enter project ID"
              value={formData.project_id}
              onChange={(e) => handleInputChange("project_id", e.target.value)}
            />
          )}

          {/* Questions Section */}
          <div className="border-t border-border pt-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-medium">Quiz Questions ({formatNumber(questions.length).text})</h3>
              <Button size="sm" variant="outline" onClick={addQuestion}>
                Add Question
              </Button>
            </div>
            {questions.map((q, qIndex) => (
              <div key={qIndex} className="border border-border rounded-lg p-4 mb-4">
                <div className="flex justify-between items-start mb-2">
                  <span className="text-sm font-medium">Question {qIndex + 1}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => removeQuestion(qIndex)}
                    className="text-red-600"
                  >
                    Remove
                  </Button>
                </div>
                <Input
                  placeholder="Enter question"
                  value={q.question}
                  onChange={(e) => updateQuestion(qIndex, "question", e.target.value)}
                  className="mb-2"
                />
                <div className="space-y-2">
                  {q.answers.map((a, aIndex) => (
                    <div key={aIndex} className="flex gap-2 items-center">
                      <input
                        type="radio"
                        name={`correct-${qIndex}`}
                        checked={a.correct}
                        onChange={() => updateAnswer(qIndex, aIndex, "correct", true)}
                        className="h-4 w-4"
                      />
                      <Input
                        placeholder={`Answer ${aIndex + 1}`}
                        value={a.answer}
                        onChange={(e) => updateAnswer(qIndex, aIndex, "answer", e.target.value)}
                        className="flex-1"
                      />
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Select the radio button to mark the correct answer
                </p>
              </div>
            ))}
          </div>
        </div>
      </Modal>

      {/* Edit Training Modal */}
      <Modal
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setSelectedTraining(null);
          refetch();
        }}
        title="Edit Training"
        description={`Editing ${selectedTraining?.title}`}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => {
              setShowEditModal(false);
              setSelectedTraining(null);
              refetch();
            }}>
              Cancel
            </Button>
            {editTab === "questions" ? (
              <Button onClick={handleModifyTraining} isLoading={modifying}>
                Save Questions
              </Button>
            ) : editTab === "settings" ? (
              <Button onClick={handleUpdateTraining} isLoading={updating}>
                Save Changes
              </Button>
            ) : null}
          </>
        }
      >
        <Tabs defaultValue="settings" value={editTab} onValueChange={(v) => setEditTab(v as "settings" | "locations" | "questions")}>
          <TabsList className="mb-4">
            <TabsTrigger value="settings">Settings</TabsTrigger>
            <TabsTrigger value="locations">Locations</TabsTrigger>
            <TabsTrigger value="questions">
              Questions ({formatNumber(editQuestions.length).text})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="settings">
            <div className="space-y-4">
              <Input
                label="Title"
                value={formData.title}
                onChange={(e) => handleInputChange("title", e.target.value)}
              />
              <Input
                label="Training URL"
                value={formData.training_url}
                onChange={(e) => handleInputChange("training_url", e.target.value)}
              />
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="Point Value"
                  type="number"
                  value={formData.point_value}
                  onChange={(e) => handleInputChange("point_value", e.target.value)}
                />
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
              </div>
            </div>
          </TabsContent>

          <TabsContent value="locations">
            {selectedTraining && (
              <LocationsTab resourceId={selectedTraining.id} resourceType="training" />
            )}
          </TabsContent>

          <TabsContent value="questions">
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="font-medium">Quiz Questions</h3>
                <Button size="sm" variant="outline" onClick={addEditQuestion}>
                  Add Question
                </Button>
              </div>
              {editQuestions.map((q, qIndex) => (
                <div key={qIndex} className="border border-border rounded-lg p-4">
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-sm font-medium">Question {qIndex + 1}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeEditQuestion(qIndex)}
                      className="text-red-600"
                    >
                      Remove
                    </Button>
                  </div>
                  <Input
                    placeholder="Enter question"
                    value={q.question}
                    onChange={(e) => updateEditQuestion(qIndex, "question", e.target.value)}
                    className="mb-2"
                  />
                  <div className="space-y-2">
                    {q.answers.map((a, aIndex) => (
                      <div key={aIndex} className="flex gap-2 items-center">
                        <input
                          type="radio"
                          name={`edit-correct-${qIndex}`}
                          checked={a.correct}
                          onChange={() => updateEditAnswer(qIndex, aIndex, "correct", true)}
                          className="h-4 w-4"
                        />
                        <Input
                          placeholder={`Answer ${aIndex + 1}`}
                          value={a.answer}
                          onChange={(e) => updateEditAnswer(qIndex, aIndex, "answer", e.target.value)}
                          className="flex-1"
                        />
                        {q.answers.length > 2 && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => removeEditAnswer(qIndex, aIndex)}
                            className="text-red-600 shrink-0"
                          >
                            X
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between items-center mt-2">
                    <p className="text-xs text-muted-foreground">
                      Select the radio button to mark the correct answer
                    </p>
                    <Button size="sm" variant="ghost" onClick={() => addEditAnswer(qIndex)}>
                      Add Answer
                    </Button>
                  </div>
                </div>
              ))}
              {editQuestions.length === 0 && (
                <p className="text-muted-foreground text-center py-4">
                  No questions yet. Click &quot;Add Question&quot; to create one.
                </p>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </Modal>

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

      {/* Purge Confirmation */}
      <ConfirmDialog
        isOpen={showPurgeModal}
        onClose={() => setShowPurgeModal(false)}
        onConfirm={handlePurgeTrainings}
        title="Purge All Trainings"
        message="This will DELETE all trainings, training completions, and reset all user training points. This action cannot be undone!"
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
              Purge All Trainings
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
