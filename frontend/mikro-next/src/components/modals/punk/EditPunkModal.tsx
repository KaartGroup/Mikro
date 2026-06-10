"use client";

import { useEffect, useState } from "react";
import { Modal, Button, Input, useToastActions } from "@/components/ui";
import type { Punk } from "@/types";

interface EditPunkModalProps {
  isOpen: boolean;
  onClose: () => void;
  punk: Punk | null;
  /** Called after a punk is successfully updated, e.g. to refresh the list. */
  onSaved?: () => void;
}

export function EditPunkModal({
  isOpen,
  onClose,
  punk,
  onSaved,
}: EditPunkModalProps) {
  const toast = useToastActions();
  const [editNotes, setEditNotes] = useState("");
  const [editTags, setEditTags] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Seed fields from the target punk whenever the modal (re)opens.
  useEffect(() => {
    if (isOpen) {
      setEditNotes(punk?.notes ?? "");
      setEditTags((punk?.tags ?? []).join(", "));
    }
  }, [isOpen, punk]);

  const handleSubmit = async () => {
    if (!punk) return;
    setIsSaving(true);
    try {
      const res = await fetch("/backend/punk/update_punk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          punk_id: punk.id,
          notes: editNotes,
          tags: editTags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      });
      const data = await res.json();
      if (res.ok && data.status === 200) {
        toast.success("Punk updated successfully");
        onClose();
        onSaved?.();
      } else {
        toast.error(data.message || "Failed to update punk");
      }
    } catch (error) {
      console.error("Failed to update punk:", error);
      toast.error("Failed to update punk");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Edit Punk"
      description={`Editing ${punk?.osm_username ?? ""}`}
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
        <div>
          <label className="text-sm font-medium leading-none mb-2 block">
            OSM Username
          </label>
          <p className="text-sm text-muted-foreground">{punk?.osm_username}</p>
        </div>
        <div>
          <label className="text-sm font-medium leading-none mb-2 block">
            Notes
          </label>
          <textarea
            className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            rows={3}
            placeholder="Notes about this user..."
            value={editNotes}
            onChange={(e) => setEditNotes(e.target.value)}
          />
        </div>
        <Input
          label="Tags"
          placeholder="vandal, revert-war, building-damage"
          value={editTags}
          onChange={(e) => setEditTags(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Separate tags with commas
        </p>
      </div>
    </Modal>
  );
}
