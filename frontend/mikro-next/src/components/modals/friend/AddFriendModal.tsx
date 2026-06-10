"use client";

import { useEffect, useState } from "react";
import { Modal, Button, Input, useToastActions } from "@/components/ui";
import { useCreateFriend } from "@/hooks";

interface AddFriendModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after a friend is successfully added, e.g. to refresh the list. */
  onCreated?: () => void;
}

export function AddFriendModal({
  isOpen,
  onClose,
  onCreated,
}: AddFriendModalProps) {
  const toast = useToastActions();
  const { mutate: createFriend, loading: isSaving } = useCreateFriend();

  const [addUsername, setAddUsername] = useState("");
  const [addNotes, setAddNotes] = useState("");
  const [addTags, setAddTags] = useState("");

  // Reset the form whenever the modal is (re)opened.
  useEffect(() => {
    if (isOpen) {
      setAddUsername("");
      setAddNotes("");
      setAddTags("");
    }
  }, [isOpen]);

  const handleAdd = async () => {
    if (!addUsername.trim()) {
      toast.error("OSM username is required");
      return;
    }
    try {
      await createFriend({
        osm_username: addUsername.trim(),
        notes: addNotes,
        tags: addTags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      });
      toast.success("Friend added successfully");
      onClose();
      onCreated?.();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to add friend";
      toast.error(message);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add to Friends List"
      description="Add an OSM user to the friends tracking list"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleAdd} isLoading={isSaving}>
            Add Friend
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
          placeholder="helpful, experienced, active-reviewer"
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
