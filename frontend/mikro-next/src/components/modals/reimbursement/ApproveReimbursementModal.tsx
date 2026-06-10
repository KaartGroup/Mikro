"use client";

import { useEffect, useState } from "react";
import { Button, Input, Modal, useToastActions } from "@/components/ui";
import { useApproveReimbursementRequest } from "@/hooks";
import type { ReimbursementRequest } from "@/types";
import { formatCurrency } from "@/lib/utils";

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface ApproveReimbursementModalProps {
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
  const [cycleStart, setCycleStart] = useState(todayIso());
  const [cycleEnd, setCycleEnd] = useState(todayIso());
  const [reviewerNote, setReviewerNote] = useState("");

  // Reset fields whenever the modal (re)opens.
  useEffect(() => {
    if (isOpen) {
      setCycleStart(todayIso());
      setCycleEnd(todayIso());
      setReviewerNote("");
    }
  }, [isOpen]);

  const handleApprove = async () => {
    if (!cycleStart || !cycleEnd) {
      toast.error("Cycle start and end are required");
      return;
    }
    if (cycleStart > cycleEnd) {
      toast.error("Cycle end must be on or after cycle start");
      return;
    }
    try {
      await approveRequest({
        request_id: request.id,
        cycle_start: cycleStart,
        cycle_end: cycleEnd,
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
      description={`Adds ${formatCurrency(request.amount).text} to ${request.user_name || request.user_id}'s payout for the chosen cycle.`}
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Input
            label="Cycle start"
            type="date"
            value={cycleStart}
            onChange={(e) => setCycleStart(e.target.value)}
          />
          <Input
            label="Cycle end"
            type="date"
            value={cycleEnd}
            onChange={(e) => setCycleEnd(e.target.value)}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Pick the payroll cycle this reimbursement should land in. The editor
          didn&apos;t specify one at submission time.
        </p>
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
