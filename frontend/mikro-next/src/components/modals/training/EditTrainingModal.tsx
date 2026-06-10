"use client";

import { useState, useEffect } from "react";
import {
  Modal,
  Button,
  Input,
  Select,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui";
import { useToastActions } from "@/components/ui";
import { useUpdateTraining, useModifyTraining } from "@/hooks";
import LocationsTab from "@/components/LocationsTab";
import type { Training } from "@/types";
import { formatNumber } from "@/lib/utils";

interface TrainingFormData {
  title: string;
  training_url: string;
  point_value: string;
  difficulty: string;
  training_type: string;
  project_id: string;
}

interface QuestionFormData {
  question: string;
  answers: { answer: string; correct: boolean }[];
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onUpdated: () => void;
  training: Training | null;
  initialTab?: "settings" | "locations" | "questions";
}

export function EditTrainingModal({
  isOpen,
  onClose,
  onUpdated,
  training,
  initialTab = "settings",
}: Props) {
  const { mutate: updateTraining, loading: updating } = useUpdateTraining();
  const { mutate: modifyTraining, loading: modifying } = useModifyTraining();
  const toast = useToastActions();

  const [formData, setFormData] = useState<TrainingFormData>({
    title: training?.title ?? "",
    training_url: training?.training_url ?? "",
    point_value: training?.point_value?.toString() ?? "10",
    difficulty: training?.difficulty ?? "Medium",
    training_type: training?.training_type ?? "Mapping",
    project_id: training?.project_id?.toString() ?? "",
  });
  const [editQuestions, setEditQuestions] = useState<QuestionFormData[]>(
    training?.questions?.map((q) => ({
      question: q.question,
      answers: q.answers.map((a) => ({
        answer: a.answer,
        correct: a.correct,
      })),
    })) ?? [],
  );
  const [editTab, setEditTab] = useState<
    "settings" | "locations" | "questions"
  >(initialTab);

  // Seed / reset fields whenever the modal (re)opens with a (new) training.
  useEffect(() => {
    if (!isOpen) return;
    setFormData({
      title: training?.title ?? "",
      training_url: training?.training_url ?? "",
      point_value: training?.point_value?.toString() ?? "10",
      difficulty: training?.difficulty ?? "Medium",
      training_type: training?.training_type ?? "Mapping",
      project_id: training?.project_id?.toString() ?? "",
    });
    setEditQuestions(
      training?.questions?.map((q) => ({
        question: q.question,
        answers: q.answers.map((a) => ({
          answer: a.answer,
          correct: a.correct,
        })),
      })) ?? [],
    );
    setEditTab(initialTab);
  }, [isOpen, training, initialTab]);

  const handleInputChange = (field: keyof TrainingFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
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

  const updateEditAnswer = (
    qIndex: number,
    aIndex: number,
    field: string,
    value: string | boolean,
  ) => {
    const updated = [...editQuestions];
    updated[qIndex].answers[aIndex] = {
      ...updated[qIndex].answers[aIndex],
      [field]: value,
    };
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
    updated[qIndex].answers = [
      ...updated[qIndex].answers,
      { answer: "", correct: false },
    ];
    setEditQuestions(updated);
  };

  const removeEditAnswer = (qIndex: number, aIndex: number) => {
    const updated = [...editQuestions];
    updated[qIndex].answers = updated[qIndex].answers.filter(
      (_, i) => i !== aIndex,
    );
    setEditQuestions(updated);
  };

  const handleUpdateTraining = async () => {
    if (!training) return;

    try {
      await updateTraining({
        training_id: training.id,
        title: formData.title,
        training_url: formData.training_url,
        point_value: parseInt(formData.point_value),
        difficulty: formData.difficulty,
      });
      toast.success("Training updated successfully");
      onClose();
      onUpdated();
    } catch {
      toast.error("Failed to update training");
    }
  };

  const handleModifyTraining = async () => {
    if (!training) return;

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
        training_id: training.id,
        title: formData.title,
        training_url: formData.training_url,
        point_value: parseInt(formData.point_value),
        difficulty: formData.difficulty,
        training_type: formData.training_type,
        questions: formattedQuestions,
      });
      toast.success("Training questions updated successfully");
      onClose();
      onUpdated();
    } catch {
      toast.error("Failed to update training questions");
    }
  };

  const handleClose = () => {
    onClose();
    onUpdated();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Edit Training"
      description={`Editing ${training?.title}`}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={handleClose}>
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
      <Tabs
        defaultValue="settings"
        value={editTab}
        onValueChange={(v) =>
          setEditTab(v as "settings" | "locations" | "questions")
        }
      >
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
              onChange={(e) =>
                handleInputChange("training_url", e.target.value)
              }
            />
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Point Value"
                type="number"
                value={formData.point_value}
                onChange={(e) =>
                  handleInputChange("point_value", e.target.value)
                }
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
          {training && (
            <LocationsTab resourceId={training.id} resourceType="training" />
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
                  <span className="text-sm font-medium">
                    Question {qIndex + 1}
                  </span>
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
                  onChange={(e) =>
                    updateEditQuestion(qIndex, "question", e.target.value)
                  }
                  className="mb-2"
                />
                <div className="space-y-2">
                  {q.answers.map((a, aIndex) => (
                    <div key={aIndex} className="flex gap-2 items-center">
                      <input
                        type="radio"
                        name={`edit-correct-${qIndex}`}
                        checked={a.correct}
                        onChange={() =>
                          updateEditAnswer(qIndex, aIndex, "correct", true)
                        }
                        className="h-4 w-4"
                      />
                      <Input
                        placeholder={`Answer ${aIndex + 1}`}
                        value={a.answer}
                        onChange={(e) =>
                          updateEditAnswer(
                            qIndex,
                            aIndex,
                            "answer",
                            e.target.value,
                          )
                        }
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
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => addEditAnswer(qIndex)}
                  >
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
  );
}
