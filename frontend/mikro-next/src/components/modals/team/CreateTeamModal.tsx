"use client";

import { useEffect, useState } from "react";
import { Modal, Button, Input, useToastActions } from "@/components/ui";
import { MultiSelect } from "@/components/ui/MultiSelect";
import { useCreateTeam } from "@/hooks/useApi";

interface CreateTeamModalProps {
  isOpen: boolean;
  onClose: () => void;
  leadOptions: { value: string; label: string }[];
  /** Called after the team is successfully created, e.g. to refresh the list. */
  onCreated?: () => void;
}

export function CreateTeamModal({
  isOpen,
  onClose,
  leadOptions,
  onCreated,
}: CreateTeamModalProps) {
  const toast = useToastActions();
  const { mutate: createTeam, loading } = useCreateTeam();
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formLeadIds, setFormLeadIds] = useState<string[]>([]);

  // Reset fields whenever the modal opens.
  useEffect(() => {
    if (isOpen) {
      setFormName("");
      setFormDescription("");
      setFormLeadIds([]);
    }
  }, [isOpen]);

  const handleCreate = async () => {
    if (!formName.trim()) {
      toast.error("Team name is required");
      return;
    }
    try {
      await createTeam({
        teamName: formName.trim(),
        teamDescription: formDescription.trim() || null,
        leadIds: formLeadIds,
      });
      toast.success("Team created");
      onClose();
      onCreated?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create team";
      toast.error(msg);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Create Team"
      description="Create a new team to group users"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleCreate} isLoading={loading}>
            Create Team
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Team Name"
          placeholder="e.g. East Africa Mappers"
          value={formName}
          onChange={(e) => setFormName(e.target.value)}
        />
        <div>
          <label className="block text-sm font-medium mb-1">Description</label>
          <textarea
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            rows={3}
            placeholder="Optional team description..."
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
