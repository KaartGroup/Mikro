"use client";

import { useEffect, useState } from "react";
import { Modal, Button, Input, useToastActions } from "@/components/ui";
import { useUpdateFriend } from "@/hooks";
import type { Friend } from "@/types";

interface EditFriendModalProps {
  isOpen: boolean;
  onClose: () => void;
  friend: Friend | null;
  /** Called after a friend is successfully updated, e.g. to refresh the list. */
  onSaved?: () => void;
}

export function EditFriendModal({
  isOpen,
  onClose,
  friend,
  onSaved,
}: EditFriendModalProps) {
  const toast = useToastActions();
  const { mutate: updateFriend, loading: isSaving } = useUpdateFriend();

  const [editNotes, setEditNotes] = useState("");
  const [editTags, setEditTags] = useState("");

  // Seed fields whenever the modal (re)opens with a friend.
  useEffect(() => {
    if (isOpen) {
      setEditNotes(friend?.notes ?? "");
      setEditTags((friend?.tags ?? []).join(", "));
    }
  }, [isOpen, friend]);

  const handleSave = async () => {
    if (!friend) return;
    try {
      await updateFriend({
        friend_id: friend.id,
        notes: editNotes,
        tags: editTags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      });
      toast.success("Friend updated successfully");
      onClose();
      onSaved?.();
    } catch {
      toast.error("Failed to update friend");
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Edit Friend"
      description={`Editing ${friend?.osm_username ?? ""}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} isLoading={isSaving}>
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
          <p className="text-sm text-muted-foreground">
            {friend?.osm_username ?? ""}
          </p>
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
          placeholder="helpful, experienced, active-reviewer"
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
