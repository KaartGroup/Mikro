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
import { displayRole } from "@/lib/utils";
import {
  useFetchTeamMembers,
  useAssignTeamMember,
  useUnassignTeamMember,
} from "@/hooks/useApi";
import type { Team, TeamMemberItem } from "@/types";

interface TeamMembersModalProps {
  team: Team | null;
  onClose: () => void;
  /**
   * Called after any successful assign/unassign, e.g. to refresh the team
   * list member count.
   */
  onMembersChanged?: () => void;
}

export function TeamMembersModal({
  team,
  onClose,
  onMembersChanged,
}: TeamMembersModalProps) {
  const toast = useToastActions();
  const { mutate: fetchMembers } = useFetchTeamMembers();
  const { mutate: assignMember } = useAssignTeamMember();
  const { mutate: unassignMember } = useUnassignTeamMember();

  const [members, setMembers] = useState<TeamMemberItem[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersSearch, setMembersSearch] = useState("");

  // Fetch members whenever the modal opens with a new team.
  useEffect(() => {
    if (!team) return;
    setMembersSearch("");
    setMembersLoading(true);
    fetchMembers({ teamId: team.id })
      .then((res) => setMembers(res?.users ?? []))
      .catch(() => {
        toast.error("Failed to fetch team members");
        setMembers([]);
      })
      .finally(() => setMembersLoading(false));
  }, [team]);

  const handleToggleMember = async (userId: string, currentStatus: string) => {
    if (!team) return;
    try {
      if (currentStatus === "Assigned") {
        await unassignMember({ teamId: team.id, userId });
      } else {
        await assignMember({ teamId: team.id, userId });
      }
      // Refresh the members list after the change.
      const res = await fetchMembers({ teamId: team.id });
      setMembers(res?.users ?? []);
      onMembersChanged?.();
    } catch {
      toast.error("Failed to update member assignment");
    }
  };

  const filteredMembers = members.filter(
    (m) =>
      m.name.toLowerCase().includes(membersSearch.toLowerCase()) ||
      m.email.toLowerCase().includes(membersSearch.toLowerCase()),
  );

  return (
    <Modal
      isOpen={!!team}
      onClose={onClose}
      title={`Team Members — ${team?.name}`}
      description="Assign or remove users from this team"
      size="5xl"
      footer={
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="space-y-4">
        <Input
          placeholder="Search users..."
          value={membersSearch}
          onChange={(e) => setMembersSearch(e.target.value)}
        />
        {membersLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : filteredMembers.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">
            {membersSearch
              ? "No users match your search"
              : "No users in organization"}
          </p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMembers.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {user.email}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {displayRole(user.role)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        variant={
                          user.assigned === "Assigned" ? "success" : "secondary"
                        }
                      >
                        {user.assigned}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant={
                          user.assigned === "Assigned"
                            ? "destructive"
                            : "primary"
                        }
                        onClick={() =>
                          handleToggleMember(user.id, user.assigned)
                        }
                      >
                        {user.assigned === "Assigned" ? "Remove" : "Assign"}
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
