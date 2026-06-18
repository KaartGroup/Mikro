"use client";

import { useEffect, useState } from "react";
import { Button, Modal, useToastActions } from "@/components/ui";
import { useDirectAddReimbursement } from "@/hooks";
import { formatCurrency } from "@/lib/utils";

interface DirectAddReimbursementModalProps {
  userId: string;
  userName: string;
  isOpen: boolean;
  onClose: () => void;
  onAdded?: () => void;
}

export function DirectAddReimbursementModal({
  userId,
  userName,
  isOpen,
  onClose,
  onAdded,
}: DirectAddReimbursementModalProps) {
  const toast = useToastActions();
  const { mutate: directAdd, loading } = useDirectAddReimbursement();

  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (isOpen) {
      setAmount("");
      setDescription("");
      setNote("");
    }
  }, [isOpen]);

  const parsedAmount = parseFloat(amount);
  const amountValid = !isNaN(parsedAmount) && parsedAmount > 0;

  const handleSubmit = async () => {
    if (!amountValid || !description.trim()) return;
    try {
      await directAdd({
        user_id: userId,
        amount: parsedAmount,
        description: description.trim(),
        note: note.trim() || undefined,
      });
      toast.success(
        `Added ${formatCurrency(parsedAmount).text} reimbursement for ${userName}`,
      );
      onClose();
      onAdded?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add reimbursement");
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add reimbursement"
      description={`Directly add an approved reimbursement for ${userName}. This bypasses the normal proposal and approval process.`}
    >
      <div className="space-y-3">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Amount</label>
          <input
            type="number"
            min="0.01"
            step="0.01"
            className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Description</label>
          <textarea
            className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
            rows={3}
            maxLength={2000}
            placeholder="What is this reimbursement for?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Admin note (optional)</label>
          <textarea
            className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
            rows={2}
            maxLength={2000}
            placeholder="Any context to record alongside this reimbursement."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={loading || !amountValid || !description.trim()}
          >
            {loading ? "Adding…" : "Add reimbursement"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
