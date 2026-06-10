"use client";

import { useEffect, useState } from "react";
import { Modal, Button, Input, useToastActions } from "@/components/ui";

interface Organization {
  id: string;
  name: string;
  display_name: string | null;
  contact_name: string | null;
  contact_email: string | null;
  notes: string | null;
}

interface EditOrganizationModalProps {
  isOpen: boolean;
  onClose: () => void;
  organization: Organization | null;
  /** Called after the organization is successfully saved, e.g. to refresh the list. */
  onSaved?: () => void;
}

export function EditOrganizationModal({
  isOpen,
  onClose,
  organization,
  onSaved,
}: EditOrganizationModalProps) {
  const toast = useToastActions();
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editContactName, setEditContactName] = useState("");
  const [editContactEmail, setEditContactEmail] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Seed fields from the organization whenever the modal is (re)opened.
  useEffect(() => {
    if (isOpen) {
      setEditDisplayName(organization?.display_name ?? "");
      setEditContactName(organization?.contact_name ?? "");
      setEditContactEmail(organization?.contact_email ?? "");
      setEditNotes(organization?.notes ?? "");
    }
  }, [isOpen, organization]);

  const handleUpdate = async () => {
    if (!organization) return;
    setIsSaving(true);
    try {
      const response = await fetch("/backend/organization/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId: organization.id,
          displayName: editDisplayName.trim(),
          contactName: editContactName.trim(),
          contactEmail: editContactEmail.trim(),
          notes: editNotes.trim(),
        }),
      });
      const data = await response.json();
      if (response.ok && data.status === 200) {
        toast.success("Organization updated");
        onClose();
        onSaved?.();
      } else {
        toast.error(data.message || "Failed to update organization");
      }
    } catch (error) {
      console.error("Failed to update organization:", error);
      toast.error("Failed to update organization");
    } finally {
      setIsSaving(false);
    }
  };

  const orgLabel = organization?.display_name || organization?.name || "";

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Edit Organization"
      description={`Editing "${orgLabel}"`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleUpdate} isLoading={isSaving}>
            Save Changes
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Display Name"
          value={editDisplayName}
          onChange={(e) => setEditDisplayName(e.target.value)}
        />
        <Input
          label="Contact Name"
          value={editContactName}
          onChange={(e) => setEditContactName(e.target.value)}
        />
        <Input
          label="Contact Email"
          value={editContactEmail}
          onChange={(e) => setEditContactEmail(e.target.value)}
        />
        <div>
          <label className="block text-sm font-medium mb-1">Notes</label>
          <textarea
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            rows={3}
            value={editNotes}
            onChange={(e) => setEditNotes(e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}
