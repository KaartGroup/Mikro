"use client";

import { useEffect, useState } from "react";
import { Modal, Button, Input, useToastActions } from "@/components/ui";

interface CreateRegionModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after a region is successfully created, e.g. to refresh the list. */
  onCreated?: () => void;
}

export function CreateRegionModal({
  isOpen,
  onClose,
  onCreated,
}: CreateRegionModalProps) {
  const toast = useToastActions();
  const [regionName, setRegionName] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Reset field whenever the modal (re)opens.
  useEffect(() => {
    if (isOpen) {
      setRegionName("");
    }
  }, [isOpen]);

  const handleSubmit = async () => {
    if (!regionName.trim()) {
      toast.error("Region name is required");
      return;
    }
    setIsSaving(true);
    try {
      const response = await fetch("/backend/region/create_region", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: regionName.trim() }),
      });
      const data = await response.json();
      if (response.ok && data.status === 200) {
        toast.success("Region created");
        onClose();
        onCreated?.();
      } else {
        toast.error(data.message || "Failed to create region");
      }
    } catch (error) {
      console.error("Failed to create region:", error);
      toast.error("Failed to create region");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Create Region"
      description="Add a new region to organize countries"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} isLoading={isSaving}>
            Create Region
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Region Name"
          placeholder="e.g. East Africa"
          value={regionName}
          onChange={(e) => setRegionName(e.target.value)}
        />
      </div>
    </Modal>
  );
}
