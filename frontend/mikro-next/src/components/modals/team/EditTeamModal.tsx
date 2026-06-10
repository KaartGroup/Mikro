"use client";

import { useEffect, useState } from "react";
import { Modal, Button, Input, useToastActions } from "@/components/ui";
import { MultiSelect } from "@/components/ui/MultiSelect";
import { useUpdateTeam } from "@/hooks/useApi";
import { isAnyAdmin } from "@/types";
import type { Team, User } from "@/types";

interface EditTeamModalProps {
  isOpen: boolean;
  onClose: () => void;
  team: Team | null;
  /**
   * All org users — used to build the lead options list, preserving already-
   * assigned leads whose role may have changed since assignment.
   */
  orgUsers: User[];
  /** Called after the team is successfully saved, e.g. to refresh the list. */
  onSaved?: () => void;
}

export function EditTeamModal({
  isOpen,
  onClose,
  team,
  orgUsers,
  onSaved,
}: EditTeamModalProps) {
  const toast = useToastActions();
  const { mutate: updateTeam, loading } = useUpdateTeam();
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formLeadIds, setFormLeadIds] = useState<string[]>([]);

  // Seed fields from the team whenever the modal (re)opens.
  useEffect(() => {
    if (isOpen && team) {
      setFormName(team.name);
      setFormDescription(team.description ?? "");
      setFormLeadIds(team.lead_ids ?? (team.lead_id ? [team.lead_id] : []));
    }
  }, [isOpen, team]);

  // Only admin users may be leads; also keep any already-assigned lead
  // selectable even if their role changed since they were assigned.
  const leadOptions = orgUsers
    .filter((u) => isAnyAdmin(u.role) || formLeadIds.includes(u.id))
    .map((u) => ({
      value: u.id,
      label: u.name || u.email,
    }));

  const handleUpdate = async () => {
    if (!team) return;
    if (!formName.trim()) {
      toast.error("Team name is required");
      return;
    }
    try {
      await updateTeam({
        teamId: team.id,
        teamName: formName.trim(),
        teamDescription: formDescription.trim() || null,
        leadIds: formLeadIds,
      });
      toast.success("Team updated");
      onClose();
      onSaved?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update team";
      toast.error(msg);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Edit Team"
      description={`Editing "${team?.name}"`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleUpdate} isLoading={loading}>
            Save Changes
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Team Name"
          value={formName}
          onChange={(e) => setFormName(e.target.value)}
        />
        <div>
          <label className="block text-sm font-medium mb-1">Description</label>
          <textarea
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            rows={3}
            value={formDescription}
            onChange={(e) => setFormDescription(e.target.value)}
          />
        </div>
        <div>
          <MultiSelect
            label="Team Leads"
            value={formLeadIds}
            onChange={setFormLeadIds}
            options={leadOptions}
            placeholder="Select one or more leads"
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            Only users with an admin role (Super Admin, Org Admin, or Team
            Admin) appear here. A team lead needs admin permissions to manage
            the team — assign someone an admin role on the Users page first to
            make them eligible.
          </p>
        </div>
      </div>
    </Modal>
  );
}
