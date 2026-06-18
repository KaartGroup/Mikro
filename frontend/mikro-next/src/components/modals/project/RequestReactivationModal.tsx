"use client";

import { useState, useEffect } from "react";
import { Modal, Button, useToastActions } from "@/components/ui";
import { useRequestReactivation } from "@/hooks";
import type { MyArchivedProject } from "@/hooks";
import { projectDisplayName } from "@/lib/sortProjects";

interface RequestReactivationModalProps {
  isOpen: boolean;
  /** The archived project to request reactivation for. */
  project: MyArchivedProject | null;
  onClose: () => void;
  /** Called after a successful request so the parent can refresh its
   *  archived list (row flips to "Reactivation requested"). */
  onRequested?: () => void;
}

/**
 * Small modal letting an editor request that an archived (soft-deleted)
 * project be reactivated. A reason is required — submit stays disabled
 * until the textarea has non-whitespace content.
 */
export function RequestReactivationModal({
  isOpen,
  project,
  onClose,
  onRequested,
}: RequestReactivationModalProps) {
  const toast = useToastActions();
  const { mutate: requestReactivation } = useRequestReactivation();

  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Clear the reason each time the modal opens for a (possibly new) project.
  useEffect(() => {
    if (isOpen) setReason("");
  }, [isOpen]);

  const handleSubmit = async () => {
    if (!project || !reason.trim()) return;
    setSubmitting(true);
    try {
      await requestReactivation({
        project_id: project.id,
        reason: reason.trim(),
      });
      toast.success(
        `Reactivation requested for "${projectDisplayName(project)}"`,
      );
      onClose();
      onRequested?.();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to request reactivation";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Request Reactivation"
      description={
        project
          ? `Ask an admin to reactivate "${projectDisplayName(project)}".`
          : undefined
      }
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            disabled={!reason.trim() || submitting}
            isLoading={submitting}
          >
            Submit Request
          </Button>
        </div>
      }
    >
      <label className="mb-1.5 block text-sm font-medium">
        Reason <span className="text-red-500">*</span>
      </label>
      <textarea
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        rows={4}
        placeholder="Why should this project be reactivated?"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
    </Modal>
  );
}
