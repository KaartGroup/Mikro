"use client";

import { useState, useMemo } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Skeleton,
  Val,
} from "@/components/ui";
import { useUserTrainings } from "@/hooks";
import type { Training } from "@/types";
import { formatNumber } from "@/lib/utils";
import { QuizModal } from "@/components/modals/training/QuizModal";

interface UserTraining extends Training {
  completed?: boolean;
  score?: number;
}

export function UserTraining() {
  const { data: trainings, loading, refetch } = useUserTrainings();

  const [selectedTraining, setSelectedTraining] = useState<UserTraining | null>(
    null,
  );
  const [showQuizModal, setShowQuizModal] = useState(false);

  const ROWS_PER_PAGE = 20;
  const [mappingPage, setMappingPage] = useState(1);
  const [validationPage, setValidationPage] = useState(1);
  const [projectPage, setProjectPage] = useState(1);
  const [completedPage, setCompletedPage] = useState(1);

  const mappingTrainings = (trainings?.mapping_trainings ??
    []) as UserTraining[];
  const validationTrainings = (trainings?.validation_trainings ??
    []) as UserTraining[];
  const projectTrainings = (trainings?.project_trainings ??
    []) as UserTraining[];
  const completedTrainings = (trainings?.user_completed_trainings ??
    []) as UserTraining[];

  // Calculate stats
  const stats = useMemo(() => {
    const pending = [
      ...mappingTrainings,
      ...validationTrainings,
      ...projectTrainings,
    ];
    const totalPoints = completedTrainings.reduce(
      (sum, t) => sum + t.point_value,
      0,
    );
    return {
      total: pending.length + completedTrainings.length,
      completed: completedTrainings.length,
      pending: pending.length,
      totalPoints,
    };
  }, [
    mappingTrainings,
    validationTrainings,
    projectTrainings,
    completedTrainings,
  ]);

  const handleStartQuiz = (training: UserTraining) => {
    setSelectedTraining(training);
    setShowQuizModal(true);
  };

  const closeQuizModal = () => {
    setShowQuizModal(false);
    setSelectedTraining(null);
  };

  const TrainingCard = ({ training }: { training: UserTraining }) => (
    <Card
      className={`transition-all hover:shadow-md ${
        training.completed
          ? "border-green-500 bg-green-50/50 dark:bg-green-950/20"
          : ""
      }`}
    >
      <CardHeader>
        <div className="flex justify-between items-start">
          <CardTitle className="text-lg">{training.title}</CardTitle>
          {training.completed && <Badge variant="success">Completed</Badge>}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Difficulty:</span>
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
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Points:</span>
            <span className="font-medium">{training.point_value}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Questions:</span>
            <span>{training.questions?.length ?? 0}</span>
          </div>
          {training.completed && training.score !== undefined && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Your Score:</span>
              <span className="font-medium text-green-600">
                {training.score}%
              </span>
            </div>
          )}
        </div>
        <div className="mt-4 flex gap-2">
          <a
            href={training.training_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 text-center py-2 px-4 border border-input rounded-lg hover:bg-muted transition-colors text-sm font-medium"
          >
            View Material
          </a>
          <Button
            onClick={() => handleStartQuiz(training)}
            className="flex-1"
            disabled={training.completed || !training.questions?.length}
          >
            {training.completed ? "Completed" : "Take Quiz"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  if (loading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
        <Skeleton className="h-8 w-48" />
        <div
          style={{
            display: "grid",
            gap: 16,
            gridTemplateColumns: "repeat(4, 1fr)",
          }}
        >
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 md:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-64 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      {/* Header */}
      <div style={{ marginBottom: 8 }}>
        <h1 className="text-3xl font-bold tracking-tight">Training</h1>
        <p className="text-muted-foreground" style={{ marginTop: 8 }}>
          Complete training modules to earn points and improve your skills
        </p>
      </div>

      {/* Stats Cards - Compact Row */}
      <div
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: "repeat(4, 1fr)",
        }}
        className="grid-stats"
      >
        <Card style={{ padding: 0 }}>
          <div style={{ padding: "12px 16px" }}>
            <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
              Total Trainings
            </p>
            <div style={{ fontSize: 20, fontWeight: 700 }}>
              <Val>{formatNumber(stats.total)}</Val>
            </div>
          </div>
        </Card>
        <Card style={{ padding: 0 }}>
          <div style={{ padding: "12px 16px" }}>
            <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
              Completed
            </p>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#16a34a" }}>
              <Val>{formatNumber(stats.completed)}</Val>
            </div>
            <div
              style={{
                width: "100%",
                backgroundColor: "#e5e7eb",
                borderRadius: 4,
                height: 4,
                marginTop: 8,
              }}
            >
              <div
                style={{
                  backgroundColor: "#16a34a",
                  height: 4,
                  borderRadius: 4,
                  width: `${stats.total > 0 ? (stats.completed / stats.total) * 100 : 0}%`,
                  transition: "width 0.3s",
                }}
              />
            </div>
          </div>
        </Card>
        <Card style={{ padding: 0 }}>
          <div style={{ padding: "12px 16px" }}>
            <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
              Pending
            </p>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#ca8a04" }}>
              <Val>{formatNumber(stats.pending)}</Val>
            </div>
          </div>
        </Card>
        <Card style={{ padding: 0 }}>
          <div style={{ padding: "12px 16px" }}>
            <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
              Points Earned
            </p>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#ff6b35" }}>
              <Val>{formatNumber(stats.totalPoints)}</Val>
            </div>
          </div>
        </Card>
      </div>

      {/* Trainings Tabs */}
      <Tabs defaultValue="mapping">
        <TabsList>
          <TabsTrigger value="mapping">
            Mapping ({formatNumber(mappingTrainings.length).text})
          </TabsTrigger>
          <TabsTrigger value="validation">
            Validation ({formatNumber(validationTrainings.length).text})
          </TabsTrigger>
          <TabsTrigger value="project">
            Project ({formatNumber(projectTrainings.length).text})
          </TabsTrigger>
          <TabsTrigger value="completed">
            Completed ({formatNumber(completedTrainings.length).text})
          </TabsTrigger>
        </TabsList>
        <TabsContent value="mapping">
          {mappingTrainings.length > 0 ? (
            <>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {mappingTrainings
                  .slice(
                    (mappingPage - 1) * ROWS_PER_PAGE,
                    mappingPage * ROWS_PER_PAGE,
                  )
                  .map((training) => (
                    <TrainingCard key={training.id} training={training} />
                  ))}
              </div>
              {mappingTrainings.length > ROWS_PER_PAGE && (
                <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
                  <span>
                    Showing {(mappingPage - 1) * ROWS_PER_PAGE + 1}-
                    {Math.min(
                      mappingPage * ROWS_PER_PAGE,
                      mappingTrainings.length,
                    )}{" "}
                    of {mappingTrainings.length}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={mappingPage === 1}
                      onClick={() => setMappingPage((p) => p - 1)}
                    >
                      Previous
                    </Button>
                    <span className="flex items-center px-2">
                      Page {mappingPage} of{" "}
                      {Math.ceil(mappingTrainings.length / ROWS_PER_PAGE)}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={
                        mappingPage ===
                        Math.ceil(mappingTrainings.length / ROWS_PER_PAGE)
                      }
                      onClick={() => setMappingPage((p) => p + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <Card>
              <CardContent
                style={{
                  padding: "48px 24px",
                  textAlign: "center",
                  color: "#6b7280",
                }}
              >
                No mapping trainings available
              </CardContent>
            </Card>
          )}
        </TabsContent>
        <TabsContent value="validation">
          {validationTrainings.length > 0 ? (
            <>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {validationTrainings
                  .slice(
                    (validationPage - 1) * ROWS_PER_PAGE,
                    validationPage * ROWS_PER_PAGE,
                  )
                  .map((training) => (
                    <TrainingCard key={training.id} training={training} />
                  ))}
              </div>
              {validationTrainings.length > ROWS_PER_PAGE && (
                <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
                  <span>
                    Showing {(validationPage - 1) * ROWS_PER_PAGE + 1}-
                    {Math.min(
                      validationPage * ROWS_PER_PAGE,
                      validationTrainings.length,
                    )}{" "}
                    of {validationTrainings.length}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={validationPage === 1}
                      onClick={() => setValidationPage((p) => p - 1)}
                    >
                      Previous
                    </Button>
                    <span className="flex items-center px-2">
                      Page {validationPage} of{" "}
                      {Math.ceil(validationTrainings.length / ROWS_PER_PAGE)}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={
                        validationPage ===
                        Math.ceil(validationTrainings.length / ROWS_PER_PAGE)
                      }
                      onClick={() => setValidationPage((p) => p + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <Card>
              <CardContent
                style={{
                  padding: "48px 24px",
                  textAlign: "center",
                  color: "#6b7280",
                }}
              >
                No validation trainings available
              </CardContent>
            </Card>
          )}
        </TabsContent>
        <TabsContent value="project">
          {projectTrainings.length > 0 ? (
            <>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {projectTrainings
                  .slice(
                    (projectPage - 1) * ROWS_PER_PAGE,
                    projectPage * ROWS_PER_PAGE,
                  )
                  .map((training) => (
                    <TrainingCard key={training.id} training={training} />
                  ))}
              </div>
              {projectTrainings.length > ROWS_PER_PAGE && (
                <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
                  <span>
                    Showing {(projectPage - 1) * ROWS_PER_PAGE + 1}-
                    {Math.min(
                      projectPage * ROWS_PER_PAGE,
                      projectTrainings.length,
                    )}{" "}
                    of {projectTrainings.length}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={projectPage === 1}
                      onClick={() => setProjectPage((p) => p - 1)}
                    >
                      Previous
                    </Button>
                    <span className="flex items-center px-2">
                      Page {projectPage} of{" "}
                      {Math.ceil(projectTrainings.length / ROWS_PER_PAGE)}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={
                        projectPage ===
                        Math.ceil(projectTrainings.length / ROWS_PER_PAGE)
                      }
                      onClick={() => setProjectPage((p) => p + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <Card>
              <CardContent
                style={{
                  padding: "48px 24px",
                  textAlign: "center",
                  color: "#6b7280",
                }}
              >
                No project-specific trainings available
              </CardContent>
            </Card>
          )}
        </TabsContent>
        <TabsContent value="completed">
          {completedTrainings.length > 0 ? (
            <>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {completedTrainings
                  .slice(
                    (completedPage - 1) * ROWS_PER_PAGE,
                    completedPage * ROWS_PER_PAGE,
                  )
                  .map((training) => (
                    <TrainingCard
                      key={training.id}
                      training={{ ...training, completed: true }}
                    />
                  ))}
              </div>
              {completedTrainings.length > ROWS_PER_PAGE && (
                <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
                  <span>
                    Showing {(completedPage - 1) * ROWS_PER_PAGE + 1}-
                    {Math.min(
                      completedPage * ROWS_PER_PAGE,
                      completedTrainings.length,
                    )}{" "}
                    of {completedTrainings.length}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={completedPage === 1}
                      onClick={() => setCompletedPage((p) => p - 1)}
                    >
                      Previous
                    </Button>
                    <span className="flex items-center px-2">
                      Page {completedPage} of{" "}
                      {Math.ceil(completedTrainings.length / ROWS_PER_PAGE)}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={
                        completedPage ===
                        Math.ceil(completedTrainings.length / ROWS_PER_PAGE)
                      }
                      onClick={() => setCompletedPage((p) => p + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <Card>
              <CardContent
                style={{
                  padding: "48px 24px",
                  textAlign: "center",
                  color: "#6b7280",
                }}
              >
                No completed trainings yet
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Quiz Modal */}
      <QuizModal
        isOpen={showQuizModal}
        onClose={closeQuizModal}
        selectedTraining={selectedTraining}
        onCompleted={refetch}
      />
    </div>
  );
}
