"use client";

import { useEffect, useState } from "react";
import { Button, Modal, useToastActions } from "@/components/ui";
import { useApproveReimbursementRequest } from "@/hooks";
import type { ReimbursementRequest } from "@/types";
import { formatCurrency } from "@/lib/utils";

interface ApproveReimbursementModalProps {
  request: ReimbursementRequest;
  isOpen: boolean;
  onClose: () => void;
  /** Called after a successful approval, e.g. to reload the list. */
  onApproved?: () => void;
}

export function ApproveReimbursementModal({
  request,
  isOpen,
  onClose,
  onApproved,
}: ApproveReimbursementModalProps) {
  const toast = useToastActions();
  const { mutate: approveRequest, loading } = useApproveReimbursementRequest();
  const [reviewerNote, setReviewerNote] = useState("");

  useEffect(() => {
    if (isOpen) {
      setReviewerNote("");
    }
  }, [isOpen]);

  const handleApprove = async () => {
    try {
      await approveRequest({
        request_id: request.id,
        reviewer_note: reviewerNote.trim() || undefined,
      });
      toast.success(
        `Approved ${formatCurrency(request.amount).text} for ${request.user_name || request.user_id}`,
      );
      onClose();
      onApproved?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to approve");
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Approve reimbursement"
      description={`Approve ${formatCurrency(request.amount).text} for ${request.user_name || request.user_id}.`}
    >
      <div className="space-y-3">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">
            Reviewer note (optional)
          </label>
          <textarea
            className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
            rows={3}
            value={reviewerNote}
            onChange={(e) => setReviewerNote(e.target.value)}
            placeholder="Any context to record alongside the approval."
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleApprove} disabled={loading}>
            {loading ? "Approving…" : "Approve"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
