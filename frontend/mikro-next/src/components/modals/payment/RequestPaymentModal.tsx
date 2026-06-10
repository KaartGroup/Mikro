"use client";

import { useEffect, useState } from "react";
import { Button, Modal, Val, useToastActions } from "@/components/ui";
import { useSubmitPaymentRequest } from "@/hooks";
import { formatCurrency } from "@/lib/utils";

interface RequestPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  payable: {
    payable_total?: number;
    mapping_earnings?: number;
    validation_earnings?: number;
  } | null;
  /** Called after a payment request is successfully submitted, e.g. to refresh the list. */
  onRequested?: () => void;
}

export function RequestPaymentModal({
  isOpen,
  onClose,
  payable,
  onRequested,
}: RequestPaymentModalProps) {
  const toast = useToastActions();
  const { mutate: submitPayment, loading: submitting } =
    useSubmitPaymentRequest();
  const [paymentNotes, setPaymentNotes] = useState("");

  // Reset notes whenever the modal (re)opens.
  useEffect(() => {
    if (isOpen) setPaymentNotes("");
  }, [isOpen]);

  const handleSubmit = async () => {
    if (!payable || (payable.payable_total ?? 0) <= 0) {
      toast.error("No payable amount available");
      return;
    }

    try {
      await submitPayment({ notes: paymentNotes });
      toast.success("Payment request submitted successfully");
      onClose();
      onRequested?.();
    } catch {
      toast.error("Failed to submit payment request");
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Request Payment"
      description="Submit a payment request for your available balance"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            isLoading={submitting}
            disabled={(payable?.payable_total ?? 0) <= 0}
          >
            Submit Request
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg bg-kaart-orange/10 p-4">
          <p className="text-sm text-muted-foreground">You are requesting:</p>
          <p className="text-3xl font-bold text-kaart-orange">
            <Val>{formatCurrency(payable?.payable_total)}</Val>
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Earnings Breakdown:</p>
          <div className="text-sm space-y-1 bg-muted p-3 rounded-lg">
            <div className="flex justify-between">
              <span>Mapping:</span>
              <span className="font-medium">
                <Val>{formatCurrency(payable?.mapping_earnings)}</Val>
              </span>
            </div>
            <div className="flex justify-between">
              <span>Validation:</span>
              <span className="font-medium">
                <Val>{formatCurrency(payable?.validation_earnings)}</Val>
              </span>
            </div>
            <div className="border-t border-border pt-1 mt-1 flex justify-between font-bold">
              <span>Total:</span>
              <span>
                <Val>{formatCurrency(payable?.payable_total)}</Val>
              </span>
            </div>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            Notes (optional)
          </label>
          <textarea
            className="w-full px-3 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring bg-background"
            rows={3}
            placeholder="Add any notes for this payment request..."
            value={paymentNotes}
            onChange={(e) => setPaymentNotes(e.target.value)}
          />
        </div>

        <p className="text-xs text-muted-foreground">
          Payment will be processed within 5-7 business days after approval. You
          will receive the payment to your registered payment method.
        </p>
      </div>
    </Modal>
  );
}
