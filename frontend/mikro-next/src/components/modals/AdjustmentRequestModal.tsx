"use client";

import { useState, useEffect } from "react";
import { Modal, Button, useToastActions } from "@/components/ui";
import { useRequestTimeAdjustment } from "@/hooks/useApi";

interface AdjustmentRequestModalProps {
  isOpen: boolean;
  entryId: number | null;
  onClose: () => void;
  /** Called after the adjustment request is successfully submitted. */
  onSubmitted?: () => void;
}

export function AdjustmentRequestModal({
  isOpen,
  entryId,
  onClose,
  onSubmitted,
}: AdjustmentRequestModalProps) {
  const toast = useToastActions();
  const { mutate: requestAdjustment, loading: submitting } =
    useRequestTimeAdjustment();

  const [adjustmentReason, setAdjustmentReason] = useState("");

  // Reset reason field each time the modal opens.
  useEffect(() => {
    if (isOpen) {
      setAdjustmentReason("");
    }
  }, [isOpen]);

  const handleSubmit = async () => {
    if (!entryId || !adjustmentReason.trim()) return;

    try {
      await requestAdjustment({
        entry_id: entryId,
        reason: adjustmentReason.trim(),
      });
      toast.success("Adjustment request submitted. An admin will review it.");
      onClose();
      onSubmitted?.();
    } catch {
      toast.error("Failed to submit adjustment request");
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Request Adjustment for Entry #${entryId}`}
      description="Describe what needs to be corrected. An admin will review and edit the entry."
      footer={
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            disabled={!adjustmentReason.trim() || submitting}
            isLoading={submitting}
          >
            Submit Request
          </Button>
        </div>
      }
    >
      <textarea
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        rows={4}
        placeholder="e.g., Forgot to clock out -- actual end time was 5:30 PM"
        value={adjustmentReason}
        onChange={(e) => setAdjustmentReason(e.target.value)}
      />
    </Modal>
  );
}
