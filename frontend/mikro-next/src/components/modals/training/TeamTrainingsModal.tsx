"use client";

import { useEffect, useState } from "react";
import {
  Modal,
  Button,
  Input,
  Badge,
  Skeleton,
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  useToastActions,
} from "@/components/ui";
import { Val } from "@/components/ui";
import { formatNumber } from "@/lib/utils";
import {
  useFetchTeamTrainings,
  useAssignTrainingToTeam,
  useUnassignTrainingFromTeam,
} from "@/hooks/useApi";
import type { Team, TeamTrainingItem } from "@/types";

interface TeamTrainingsModalProps {
  team: Team | null;
  onClose: () => void;
  /**
   * Called after any successful assign/unassign, e.g. to allow the page to
   * react if needed.
   */
  onTrainingsChanged?: () => void;
}

export function TeamTrainingsModal({
  team,
  onClose,
  onTrainingsChanged,
}: TeamTrainingsModalProps) {
  const toast = useToastActions();
  const { mutate: fetchTeamTrainings } = useFetchTeamTrainings();
  const { mutate: assignTrainingToTeam } = useAssignTrainingToTeam();
  const { mutate: unassignTrainingFromTeam } = useUnassignTrainingFromTeam();

  const [teamTrainings, setTeamTrainings] = useState<TeamTrainingItem[]>([]);
  const [trainingsLoading, setTrainingsLoading] = useState(false);
  const [trainingsSearch, setTrainingsSearch] = useState("");

  // Fetch trainings whenever the modal opens with a new team.
  useEffect(() => {
    if (!team) return;
    setTrainingsSearch("");
    setTrainingsLoading(true);
    fetchTeamTrainings({ teamId: team.id })
      .then((res) => setTeamTrainings(res?.trainings ?? []))
      .catch(() => {
        toast.error("Failed to fetch team trainings");
        setTeamTrainings([]);
      })
      .finally(() => setTrainingsLoading(false));
  }, [team]);

  const handleToggleTraining = async (
    trainingId: number,
    currentStatus: string,
  ) => {
    if (!team) return;
    try {
      if (currentStatus === "Assigned") {
        await unassignTrainingFromTeam({ teamId: team.id, trainingId });
      } else {
        await assignTrainingToTeam({ teamId: team.id, trainingId });
      }
      const res = await fetchTeamTrainings({ teamId: team.id });
      setTeamTrainings(res?.trainings ?? []);
      onTrainingsChanged?.();
    } catch {
      toast.error("Failed to update training assignment");
    }
  };

  const filteredTrainings = teamTrainings.filter((t) =>
    t.title?.toLowerCase().includes(trainingsSearch.toLowerCase()),
  );

  return (
    <Modal
      isOpen={!!team}
      onClose={onClose}
      title={`Team Trainings — ${team?.name}`}
      description="Assign or remove trainings from this team"
      size="5xl"
      footer={
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="space-y-4">
        <Input
          placeholder="Search trainings..."
          value={trainingsSearch}
          onChange={(e) => setTrainingsSearch(e.target.value)}
        />
        {trainingsLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : filteredTrainings.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">
            {trainingsSearch
              ? "No trainings match your search"
              : "No trainings in organization"}
          </p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Difficulty</TableHead>
                  <TableHead className="text-center">Points</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTrainings.map((training) => (
                  <TableRow key={training.id}>
                    <TableCell className="font-medium">
                      {training.title}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {training.training_type || "—"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {training.difficulty || "—"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Val>{formatNumber(training.point_value)}</Val>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        variant={
                          training.assigned === "Assigned"
                            ? "success"
                            : "secondary"
                        }
                      >
                        {training.assigned}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant={
                          training.assigned === "Assigned"
                            ? "destructive"
                            : "primary"
                        }
                        onClick={() =>
                          handleToggleTraining(training.id, training.assigned)
                        }
                      >
                        {training.assigned === "Assigned" ? "Remove" : "Assign"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </Modal>
  );
}
