"use client";

import { useEffect, useState } from "react";
import { Modal, Button, Input, useToastActions } from "@/components/ui";

interface Region {
  id: number;
  name: string;
}

interface EditRegionModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The region being edited; null when the modal is closed. */
  region: Region | null;
  /** Called after the region is successfully updated, e.g. to refresh the list. */
  onSaved?: () => void;
}

export function EditRegionModal({
  isOpen,
  onClose,
  region,
  onSaved,
}: EditRegionModalProps) {
  const toast = useToastActions();
  const [regionName, setRegionName] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Seed / reset fields whenever the modal (re)opens.
  useEffect(() => {
    if (isOpen) {
      setRegionName(region?.name ?? "");
    }
  }, [isOpen, region]);

  const handleSubmit = async () => {
    if (!region) return;
    if (!regionName.trim()) {
      toast.error("Region name is required");
      return;
    }
    setIsSaving(true);
    try {
      const response = await fetch("/backend/region/update_region", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          regionId: region.id,
          name: regionName.trim(),
        }),
      });
      const data = await response.json();
      if (response.ok && data.status === 200) {
        toast.success("Region updated");
        onClose();
        onSaved?.();
      } else {
        toast.error(data.message || "Failed to update region");
      }
    } catch (error) {
      console.error("Failed to update region:", error);
      toast.error("Failed to update region");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Edit Region"
      description={`Editing "${region?.name ?? ""}"`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} isLoading={isSaving}>
            Save Changes
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Region Name"
          value={regionName}
          onChange={(e) => setRegionName(e.target.value)}
        />
      </div>
    </Modal>
  );
}
