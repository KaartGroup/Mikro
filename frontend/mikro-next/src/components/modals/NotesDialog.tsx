"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useToastActions } from "@/components/ui";

export const USER_NOTES_MAX_LEN = 500;

export interface NotesDialogProps {
  isOpen: boolean;
  onClose: () => void;
  initialValue: string | null;
  editable: boolean;
  /** Called with the new value when the user confirms. Throw to signal failure. */
  onSave?: (value: string | null) => Promise<void> | void;
  /** Called after a successful save, e.g. to refresh the parent list. */
  onSaved?: () => void;
  title?: string;
}

export function NotesDialog({
  isOpen,
  onClose,
  initialValue,
  editable,
  onSave,
  onSaved,
  title = "Notes",
}: NotesDialogProps) {
  const toast = useToastActions();
  const [value, setValue] = useState(initialValue ?? "");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) setValue(initialValue ?? "");
  }, [isOpen, initialValue]);

  const trimmed = value.trim();
  const overLimit = trimmed.length > USER_NOTES_MAX_LEN;
  const unchanged = trimmed === (initialValue ?? "").trim();

  const handleConfirm = async () => {
    if (!onSave || overLimit || unchanged) return;
    setIsSaving(true);
    try {
      await onSave(trimmed.length === 0 ? null : trimmed);
      toast.success("Note saved");
      onClose();
      onSaved?.();
    } catch (error) {
      console.error("Failed to save note:", error);
      toast.error("Failed to save note");
    } finally {
      setIsSaving(false);
    }
  };

  if (!editable) {
    return (
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={title}
        size="md"
        footer={
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        }
      >
        {initialValue && initialValue.trim().length > 0 ? (
          <p className="whitespace-pre-wrap text-sm text-foreground">
            {initialValue}
          </p>
        ) : (
          <p className="text-sm italic text-muted-foreground">No notes.</p>
        )}
      </Modal>
    );
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      description="Optional context for this time record. Up to 500 characters."
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleConfirm}
            disabled={overLimit || unchanged}
            isLoading={isSaving}
          >
            Confirm
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={USER_NOTES_MAX_LEN + 50}
          rows={6}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y"
          placeholder="Add notes about this entry…"
          autoFocus
        />
        <div
          className={`text-right text-xs ${
            overLimit ? "text-destructive" : "text-muted-foreground"
          }`}
        >
          {trimmed.length}/{USER_NOTES_MAX_LEN}
        </div>
      </div>
    </Modal>
  );
}
