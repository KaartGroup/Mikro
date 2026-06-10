"use client";

import { useEffect, useState } from "react";
import { Modal, Button, Input, useToastActions } from "@/components/ui";

interface CreateOrganizationModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after the organization is successfully created, e.g. to refresh the list. */
  onCreated?: () => void;
}

export function CreateOrganizationModal({
  isOpen,
  onClose,
  onCreated,
}: CreateOrganizationModalProps) {
  const toast = useToastActions();
  const [createName, setCreateName] = useState("");
  const [createDisplayName, setCreateDisplayName] = useState("");
  const [createAdminEmail, setCreateAdminEmail] = useState("");
  const [createContactName, setCreateContactName] = useState("");
  const [createContactEmail, setCreateContactEmail] = useState("");
  const [createNotes, setCreateNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Reset fields whenever the modal is (re)opened.
  useEffect(() => {
    if (isOpen) {
      setCreateName("");
      setCreateDisplayName("");
      setCreateAdminEmail("");
      setCreateContactName("");
      setCreateContactEmail("");
      setCreateNotes("");
    }
  }, [isOpen]);

  const handleCreate = async () => {
    if (!createName.trim()) {
      toast.error("Organization name is required");
      return;
    }
    setIsSaving(true);
    try {
      const response = await fetch("/backend/organization/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: createName.trim(),
          displayName: createDisplayName.trim() || createName.trim(),
          adminEmail: createAdminEmail.trim() || undefined,
          contactName: createContactName.trim() || undefined,
          contactEmail: createContactEmail.trim() || undefined,
          notes: createNotes.trim() || undefined,
        }),
      });
      const data = await response.json();
      if (response.ok && data.status === 200) {
        toast.success(data.message || "Organization created");
        onClose();
        onCreated?.();
      } else {
        toast.error(data.message || "Failed to create organization");
      }
    } catch (error) {
      console.error("Failed to create organization:", error);
      toast.error("Failed to create organization");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Create Organization"
      description="Provisions an Auth0 organization and invites its first admin."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleCreate} isLoading={isSaving}>
            Create Organization
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Name (slug)"
          placeholder="e.g. acme-mapping"
          value={createName}
          onChange={(e) => setCreateName(e.target.value)}
        />
        <Input
          label="Display Name"
          placeholder="e.g. Acme Mapping"
          value={createDisplayName}
          onChange={(e) => setCreateDisplayName(e.target.value)}
        />
        <Input
          label="First Admin Email"
          placeholder="admin@acme.com"
          value={createAdminEmail}
          onChange={(e) => setCreateAdminEmail(e.target.value)}
        />
        <Input
          label="Contact Name"
          value={createContactName}
          onChange={(e) => setCreateContactName(e.target.value)}
        />
        <Input
          label="Contact Email"
          value={createContactEmail}
          onChange={(e) => setCreateContactEmail(e.target.value)}
        />
        <div>
          <label className="block text-sm font-medium mb-1">Notes</label>
          <textarea
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            rows={3}
            value={createNotes}
            onChange={(e) => setCreateNotes(e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}
