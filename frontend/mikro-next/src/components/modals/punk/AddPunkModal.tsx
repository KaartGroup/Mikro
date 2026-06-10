"use client";

import { useEffect, useState } from "react";
import { Modal, Button, Input, useToastActions } from "@/components/ui";

interface AddPunkModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after a punk is successfully added, e.g. to refresh the list. */
  onCreated?: () => void;
}

export function AddPunkModal({
  isOpen,
  onClose,
  onCreated,
}: AddPunkModalProps) {
  const toast = useToastActions();
  const [addUsername, setAddUsername] = useState("");
  const [addNotes, setAddNotes] = useState("");
  const [addTags, setAddTags] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Reset fields whenever the modal (re)opens.
  useEffect(() => {
    if (isOpen) {
      setAddUsername("");
      setAddNotes("");
      setAddTags("");
    }
  }, [isOpen]);

  const handleClose = () => {
    setAddUsername("");
    setAddNotes("");
    setAddTags("");
    onClose();
  };

  const handleSubmit = async () => {
    if (!addUsername.trim()) {
      toast.error("OSM username is required");
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch("/backend/punk/create_punk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          osm_username: addUsername.trim(),
          notes: addNotes,
          tags: addTags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      });
      const data = await res.json();
      if (res.ok && data.status === 200) {
        toast.success("Punk added successfully");
        onClose();
        onCreated?.();
      } else {
        toast.error(data.message || "Failed to add punk");
      }
    } catch (error) {
      console.error("Failed to add punk:", error);
      toast.error("Failed to add punk");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Add to Punks List"
      description="Add an OSM user to the punks tracking list"
      footer={
        <>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} isLoading={isSaving}>
            Add Punk
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="OSM Username"
          placeholder="Enter OSM username"
          value={addUsername}
          onChange={(e) => setAddUsername(e.target.value)}
        />
        <div>
          <label className="text-sm font-medium leading-none mb-2 block">
            Notes
          </label>
          <textarea
            className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            rows={3}
            placeholder="Optional notes about this user..."
            value={addNotes}
            onChange={(e) => setAddNotes(e.target.value)}
          />
        </div>
        <Input
          label="Tags"
          placeholder="vandal, revert-war, building-damage"
          value={addTags}
          onChange={(e) => setAddTags(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Separate tags with commas
        </p>
      </div>
    </Modal>
  );
}
