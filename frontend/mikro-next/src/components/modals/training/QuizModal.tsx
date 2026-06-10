"use client";

import { useState, useEffect } from "react";
import { Button, Modal, useToastActions } from "@/components/ui";
import { useSubmitTrainingQuiz } from "@/hooks";
import type { Training, TrainingQuestion, TrainingAnswer } from "@/types";

interface UserTraining extends Training {
  completed?: boolean;
  score?: number;
}

interface QuizResult {
  score: number;
  passed: boolean;
}

interface QuizModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedTraining: UserTraining | null;
  /** Called after the quiz is submitted (pass or fail), e.g. to refetch trainings. */
  onCompleted?: () => void;
}

export function QuizModal({
  isOpen,
  onClose,
  selectedTraining,
  onCompleted,
}: QuizModalProps) {
  const toast = useToastActions();
  const { mutate: submitQuiz, loading: submitting } = useSubmitTrainingQuiz();

  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [quizResult, setQuizResult] = useState<QuizResult | null>(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);

  // Reset quiz state whenever the modal opens with a (new) training.
  useEffect(() => {
    if (isOpen) {
      setAnswers({});
      setQuizSubmitted(false);
      setQuizResult(null);
      setCurrentQuestionIndex(0);
    }
  }, [isOpen, selectedTraining]);

  const handleAnswerSelect = (questionId: number, answerId: number) => {
    if (quizSubmitted) return;
    setAnswers((prev) => ({ ...prev, [questionId]: answerId }));
  };

  const handleSubmitQuiz = async () => {
    if (!selectedTraining || !selectedTraining.questions) return;

    // Check if all questions are answered
    const unanswered = selectedTraining.questions.filter((q) => !answers[q.id]);
    if (unanswered.length > 0) {
      toast.error(`Please answer all ${unanswered.length} remaining questions`);
      return;
    }

    try {
      const result = await submitQuiz({
        training_id: selectedTraining.id,
        answers: Object.entries(answers).map(([questionId, answerId]) => ({
          question_id: parseInt(questionId),
          answer_id: answerId,
        })),
      });
      setQuizResult({
        score: result.score ?? 0,
        passed: result.passed ?? false,
      });
      setQuizSubmitted(true);
      if (result.passed) {
        toast.success(`Congratulations! You passed with ${result.score}%`);
      } else {
        toast.warning(`You scored ${result.score}%. You need 70% to pass.`);
      }
      onCompleted?.();
    } catch {
      toast.error("Failed to submit quiz");
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={selectedTraining?.title ?? "Quiz"}
      description={
        quizSubmitted
          ? `${selectedTraining?.questions?.length ?? 0} questions • ${selectedTraining?.point_value ?? 0} points`
          : `Question ${currentQuestionIndex + 1} of ${selectedTraining?.questions?.length ?? 0}`
      }
      size="lg"
      footer={
        quizSubmitted ? (
          <Button onClick={onClose}>Close</Button>
        ) : (
          <div className="flex w-full items-center justify-between">
            <div>
              {currentQuestionIndex > 0 && (
                <Button
                  variant="outline"
                  onClick={() => setCurrentQuestionIndex((i) => i - 1)}
                >
                  Previous
                </Button>
              )}
            </div>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <div>
              {(selectedTraining?.questions?.length ?? 0) > 1 &&
              currentQuestionIndex <
                (selectedTraining?.questions?.length ?? 1) - 1 ? (
                <Button
                  onClick={() => setCurrentQuestionIndex((i) => i + 1)}
                  disabled={
                    !selectedTraining?.questions?.[currentQuestionIndex] ||
                    !answers[
                      selectedTraining.questions[currentQuestionIndex].id
                    ]
                  }
                >
                  Next Question
                </Button>
              ) : (
                <Button
                  onClick={handleSubmitQuiz}
                  isLoading={submitting}
                  disabled={
                    !selectedTraining?.questions?.[currentQuestionIndex] ||
                    !answers[
                      selectedTraining.questions[currentQuestionIndex].id
                    ]
                  }
                >
                  Submit Quiz
                </Button>
              )}
            </div>
          </div>
        )
      }
    >
      <div className="space-y-6">
        {/* Progress Step Bar (quiz phase only) */}
        {!quizSubmitted && selectedTraining?.questions && (
          <div className="flex items-center gap-1">
            {selectedTraining.questions.map(
              (q: TrainingQuestion, i: number) => (
                <div
                  key={i}
                  className={`h-1.5 flex-1 rounded-full ${
                    i < currentQuestionIndex
                      ? "bg-kaart-orange"
                      : i === currentQuestionIndex
                        ? "bg-kaart-orange/60"
                        : answers[q.id]
                          ? "bg-kaart-orange/30"
                          : "bg-muted"
                  }`}
                />
              ),
            )}
          </div>
        )}

        {/* Training Material Link (show on first question only during quiz, always in review) */}
        {(quizSubmitted || currentQuestionIndex === 0) && (
          <div className="rounded-lg bg-muted p-4">
            <p className="text-sm text-muted-foreground mb-2">
              Make sure you review the training material before taking the quiz:
            </p>
            <a
              href={selectedTraining?.training_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-kaart-orange hover:underline font-medium"
            >
              Open Training Material
            </a>
          </div>
        )}

        {/* Quiz Result (review phase) */}
        {quizSubmitted && quizResult && (
          <div
            className={`rounded-lg p-4 ${
              quizResult.passed
                ? "bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800"
                : "bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800"
            }`}
          >
            <div className="text-center">
              <p
                className={`text-3xl font-bold ${quizResult.passed ? "text-green-600" : "text-red-600"}`}
              >
                {quizResult.score}%
              </p>
              <p
                className={`font-medium ${quizResult.passed ? "text-green-700 dark:text-green-300" : "text-red-700 dark:text-red-300"}`}
              >
                {quizResult.passed
                  ? "Congratulations! You passed!"
                  : "You need 70% to pass. Try again!"}
              </p>
              {quizResult.passed && (
                <p className="text-sm text-green-600 dark:text-green-400 mt-1">
                  +{selectedTraining?.point_value} points earned
                </p>
              )}
            </div>
          </div>
        )}

        {/* Questions — single question during quiz, all questions during review */}
        <div className="space-y-6">
          {(() => {
            const questions = selectedTraining?.questions ?? [];
            const questionsToShow = quizSubmitted
              ? questions
              : questions.slice(currentQuestionIndex, currentQuestionIndex + 1);

            return questionsToShow.map(
              (question: TrainingQuestion, idx: number) => {
                const qIndex = quizSubmitted ? idx : currentQuestionIndex;
                const selectedAnswer = answers[question.id];

                return (
                  <div
                    key={question.id}
                    className="border border-border rounded-lg p-4"
                  >
                    <p className="font-medium mb-3">
                      {qIndex + 1}. {question.question}
                    </p>
                    <div className="space-y-2">
                      {question.answers.map((answer: TrainingAnswer) => {
                        const isSelected = selectedAnswer === answer.id;
                        let answerClassName =
                          "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ";

                        if (quizSubmitted) {
                          if (answer.correct) {
                            answerClassName +=
                              "border-green-500 bg-green-50 dark:bg-green-950";
                          } else if (isSelected && !answer.correct) {
                            answerClassName +=
                              "border-red-500 bg-red-50 dark:bg-red-950";
                          } else {
                            answerClassName += "border-border opacity-50";
                          }
                        } else {
                          answerClassName += isSelected
                            ? "border-kaart-orange bg-kaart-orange/10"
                            : "border-border hover:border-muted-foreground";
                        }

                        return (
                          <div
                            key={answer.id}
                            className={answerClassName}
                            onClick={() =>
                              handleAnswerSelect(question.id, answer.id)
                            }
                          >
                            <div
                              className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                                isSelected
                                  ? "border-kaart-orange"
                                  : "border-muted-foreground"
                              }`}
                            >
                              {isSelected && (
                                <div className="w-2 h-2 rounded-full bg-kaart-orange" />
                              )}
                            </div>
                            <span
                              className={
                                quizSubmitted && answer.correct
                                  ? "font-medium text-green-700 dark:text-green-300"
                                  : ""
                              }
                            >
                              {answer.answer}
                            </span>
                            {quizSubmitted && answer.correct && (
                              <span className="ml-auto text-green-600 text-sm">
                                Correct
                              </span>
                            )}
                            {quizSubmitted && isSelected && !answer.correct && (
                              <span className="ml-auto text-red-600 text-sm">
                                Incorrect
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              },
            );
          })()}
        </div>
      </div>
    </Modal>
  );
}
