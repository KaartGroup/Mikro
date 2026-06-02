"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Button,
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  Spinner,
  Badge,
} from "@/components/ui";
import {
  useFetchProjectTrainings,
  useAssignProjectTraining,
  useUnassignProjectTraining,
} from "@/hooks/useApi";

interface TrainingInfo {
  id: number;
  title: string;
  training_type: string;
  difficulty: string;
}

interface ProjectTrainingsTabProps {
  projectId: number | string;
}

export default function ProjectTrainingsTab({
  projectId,
}: ProjectTrainingsTabProps) {
  const fetchTrainings = useFetchProjectTrainings();
  const assignTraining = useAssignProjectTraining();
  const unassignTraining = useUnassignProjectTraining();

  const [assigned, setAssigned] = useState<TrainingInfo[]>([]);
  const [available, setAvailable] = useState<TrainingInfo[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);

  const loadTrainings = useCallback(async () => {
    try {
      const result = await fetchTrainings.mutate({
        project_id: Number(projectId),
      });
      setAssigned(result.assigned_trainings || []);
      setAvailable(result.available_trainings || []);
    } catch {
      // error surfaced via fetchTrainings.error
    } finally {
      setInitialLoading(false);
    }
  }, [projectId, fetchTrainings.mutate]);

  useEffect(() => {
    loadTrainings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const handleAssign = useCallback(
    async (trainingId: number) => {
      try {
        await assignTraining.mutate({
          project_id: Number(projectId),
          training_id: trainingId,
        });
        await loadTrainings();
      } catch {
        // error surfaced via assignTraining.error
      }
    },
    [projectId, assignTraining.mutate, loadTrainings],
  );

  const handleUnassign = useCallback(
    async (trainingId: number) => {
      try {
        await unassignTraining.mutate({
          project_id: Number(projectId),
          training_id: trainingId,
        });
        await loadTrainings();
      } catch {
        // error surfaced via unassignTraining.error
      }
    },
    [projectId, unassignTraining.mutate, loadTrainings],
  );

  const errorMessage =
    fetchTrainings.error || assignTraining.error || unassignTraining.error;

  const difficultyColor = (d: string) => {
    if (d === "Easy") return "success";
    if (d === "Medium") return "warning";
    if (d === "Hard") return "destructive";
    return "secondary";
  };

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Spinner size="md" />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6">
      {errorMessage && (
        <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
          {errorMessage}
        </div>
      )}

      {/* Assigned trainings */}
      <div className="space-y-2">
        <p className="text-sm font-medium">
          Assigned trainings{" "}
          <span className="text-muted-foreground">({assigned.length})</span>
        </p>

        {assigned.length === 0 ? (
          <div className="rounded-md border border-input bg-muted/30 p-4 text-center text-sm text-muted-foreground">
            No trainings assigned to this project
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Training</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Difficulty</TableHead>
                <TableHead className="w-[100px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {assigned.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.title}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{t.training_type}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={difficultyColor(t.difficulty)}>
                      {t.difficulty}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={unassignTraining.loading}
                      onClick={() => handleUnassign(t.id)}
                    >
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Available trainings */}
      {available.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">
            Available trainings{" "}
            <span className="text-muted-foreground">({available.length})</span>
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Training</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Difficulty</TableHead>
                <TableHead className="w-[100px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {available.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.title}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{t.training_type}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={difficultyColor(t.difficulty)}>
                      {t.difficulty}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={assignTraining.loading}
                      onClick={() => handleAssign(t.id)}
                    >
                      Assign
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
