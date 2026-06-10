"use client";

import { useEffect, useState } from "react";
import { Modal, Button, Input, useToastActions } from "@/components/ui";
import { useSetPaymentCycleStatus } from "@/hooks";
import type { PaymentCycleRow } from "@/types";

interface HoldPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  holdTarget: PaymentCycleRow | null;
  cycleStart: string;
  cycleEnd: string;
  /** Called after the hold is successfully applied, e.g. to refresh the table. */
  onHeld?: () => void;
}

export function HoldPaymentModal({
  isOpen,
  onClose,
  holdTarget,
  cycleStart,
  cycleEnd,
  onHeld,
}: HoldPaymentModalProps) {
  const toast = useToastActions();
  const { mutate: setStatus, loading } = useSetPaymentCycleStatus();
  const [holdNote, setHoldNote] = useState("");

  // Reset the note field whenever the modal (re)opens.
  useEffect(() => {
    if (isOpen) setHoldNote("");
  }, [isOpen]);

  const handleConfirm = async () => {
    if (!holdTarget) return;
    if (!holdNote.trim()) {
      toast.error("Hold reason is required");
      return;
    }
    try {
      await setStatus({
        user_id: holdTarget.user_id,
        cycle_start: cycleStart,
        cycle_end: cycleEnd,
        status: "held",
        note: holdNote.trim(),
      });
      toast.success(`Marked ${holdTarget.name} as held`);
      onClose();
      onHeld?.();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update status",
      );
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={holdTarget?.name ? `Hold ${holdTarget.name}` : ""}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleConfirm} isLoading={loading}>
            Confirm hold
          </Button>
        </>
      }
    >
      <Input
        label="Reason"
        value={holdNote}
        onChange={(e) => setHoldNote(e.target.value)}
        placeholder="Waiting on receipt, pay-period mismatch, etc."
      />
    </Modal>
  );
}
