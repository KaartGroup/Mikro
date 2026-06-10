"use client";

import { useState } from "react";
import { Modal, Button, useToastActions } from "@/components/ui";
import { User } from "@/types";

interface DeleteUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedUser: string | null;
  users: User[];
  /** Called after a user is successfully removed, e.g. to refresh the list. */
  onDeleted?: () => void;
}

export function DeleteUserModal({
  isOpen,
  onClose,
  selectedUser,
  users,
  onDeleted,
}: DeleteUserModalProps) {
  const toast = useToastActions();
  const [isSaving, setIsSaving] = useState(false);

  const targetUser = users.find((u) => u.id === selectedUser);
  const displayName = targetUser?.name || targetUser?.email || "this user";

  const handleDelete = async () => {
    if (!selectedUser) return;
    setIsSaving(true);
    try {
      const response = await fetch("/backend/user/remove_users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: selectedUser }),
      });
      const data = await response.json();
      if (response.ok && data.status === 200) {
        toast.success("User removed successfully");
        onClose();
        onDeleted?.();
      } else {
        toast.error(data.message || "Failed to remove user");
      }
    } catch (error) {
      console.error("Failed to remove user:", error);
      toast.error("Failed to remove user");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Delete User">
      <div className="space-y-4">
        <p className="text-muted-foreground">
          Are you sure you want to remove{" "}
          <span className="font-semibold text-foreground">{displayName}</span>?
          This action cannot be undone.
        </p>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={isSaving || !selectedUser}
          >
            {isSaving ? "Deleting..." : "Delete"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
