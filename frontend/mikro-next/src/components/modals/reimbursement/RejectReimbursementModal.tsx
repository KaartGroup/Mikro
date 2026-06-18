"use client";

import { useEffect, useState } from "react";
import { Button, Modal, useToastActions } from "@/components/ui";
import { useRejectReimbursementRequest } from "@/hooks";
import type { ReimbursementRequest } from "@/types";
import { formatCurrency } from "@/lib/utils";

interface RejectReimbursementModalProps {
  request: ReimbursementRequest;
  isOpen: boolean;
  onClose: () => void;
  /** Called after a successful rejection, e.g. to reload the list. */
  onRejected?: () => void;
}

export function RejectReimbursementModal({
  request,
  isOpen,
  onClose,
  onRejected,
}: RejectReimbursementModalProps) {
  const toast = useToastActions();
  const { mutate: rejectRequest, loading } = useRejectReimbursementRequest();
  const [reviewerNote, setReviewerNote] = useState("");

  // Reset fields whenever the modal (re)opens.
  useEffect(() => {
    if (isOpen) {
      setReviewerNote("");
    }
  }, [isOpen]);

  const handleReject = async () => {
    if (!reviewerNote.trim()) {
      toast.error("Reviewer note is required when rejecting");
      return;
    }
    try {
      await rejectRequest({
        request_id: request.id,
        reviewer_note: reviewerNote.trim(),
      });
      toast.success("Reimbursement rejected");
      onClose();
      onRejected?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to reject");
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Reject reimbursement"
      description={`The editor will see your reviewer note in their own request history.`}
    >
      <div className="space-y-3">
        <p className="text-sm">
          Rejecting <strong>{formatCurrency(request.amount).text}</strong> from{" "}
          <strong>{request.user_name || request.user_id}</strong>.
        </p>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Reason (required)</label>
          <textarea
            className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
            rows={4}
            value={reviewerNote}
            onChange={(e) => setReviewerNote(e.target.value)}
            placeholder="Why is this being rejected? The editor will see this verbatim."
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleReject}
            disabled={loading}
          >
            {loading ? "Rejecting…" : "Reject"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
