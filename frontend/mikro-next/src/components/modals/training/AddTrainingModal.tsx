"use client";

import { useState, useEffect } from "react";
import { Modal, Button, Input, Select } from "@/components/ui";
import { useToastActions } from "@/components/ui";
import { useCreateTraining } from "@/hooks";
import { formatNumber } from "@/lib/utils";

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

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export function AddTrainingModal({ isOpen, onClose, onCreated }: Props) {
  const { mutate: createTraining, loading: creating } = useCreateTraining();
  const toast = useToastActions();

  const [formData, setFormData] = useState<TrainingFormData>(defaultFormData);
  const [questions, setQuestions] = useState<QuestionFormData[]>([]);

  // Reset fields whenever the modal opens.
  useEffect(() => {
    if (isOpen) {
      setFormData(defaultFormData);
      setQuestions([]);
    }
  }, [isOpen]);

  const handleInputChange = (field: keyof TrainingFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
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

  const updateAnswer = (
    qIndex: number,
    aIndex: number,
    field: string,
    value: string | boolean,
  ) => {
    const updated = [...questions];
    updated[qIndex].answers[aIndex] = {
      ...updated[qIndex].answers[aIndex],
      [field]: value,
    };
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
        project_id: formData.project_id
          ? parseInt(formData.project_id)
          : undefined,
        questions: formattedQuestions,
      });
      toast.success("Training created successfully");
      onClose();
      onCreated();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to create training";
      toast.error(message);
    }
  };

  const handleClose = () => {
    setFormData(defaultFormData);
    setQuestions([]);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Add New Training"
      description="Create a new training module with quiz questions"
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={handleClose}>
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
            <h3 className="font-medium">
              Quiz Questions ({formatNumber(questions.length).text})
            </h3>
            <Button size="sm" variant="outline" onClick={addQuestion}>
              Add Question
            </Button>
          </div>
          {questions.map((q, qIndex) => (
            <div
              key={qIndex}
              className="border border-border rounded-lg p-4 mb-4"
            >
              <div className="flex justify-between items-start mb-2">
                <span className="text-sm font-medium">
                  Question {qIndex + 1}
                </span>
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
                onChange={(e) =>
                  updateQuestion(qIndex, "question", e.target.value)
                }
                className="mb-2"
              />
              <div className="space-y-2">
                {q.answers.map((a, aIndex) => (
                  <div key={aIndex} className="flex gap-2 items-center">
                    <input
                      type="radio"
                      name={`correct-${qIndex}`}
                      checked={a.correct}
                      onChange={() =>
                        updateAnswer(qIndex, aIndex, "correct", true)
                      }
                      className="h-4 w-4"
                    />
                    <Input
                      placeholder={`Answer ${aIndex + 1}`}
                      value={a.answer}
                      onChange={(e) =>
                        updateAnswer(qIndex, aIndex, "answer", e.target.value)
                      }
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
  );
}
