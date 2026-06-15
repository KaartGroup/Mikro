"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Modal, Select, Button, useToastActions } from "@/components/ui";
import { useRole } from "@/contexts/RoleContext";
import { useSubmitFeedback } from "@/hooks";
import { APP_VERSION } from "@/lib/appVersion";
import type { CapturedError } from "@/contexts/ErrorReporterContext";

interface ReportProblemModalProps {
  isOpen: boolean;
  onClose: () => void;
  lastError: CapturedError | null;
}

const CATEGORY_OPTIONS = [
  { value: "bug", label: "Bug" },
  { value: "confusing", label: "Confusing" },
  { value: "other", label: "Other" },
];

export function ReportProblemModal({
  isOpen,
  onClose,
  lastError,
}: ReportProblemModalProps) {
  const pathname = usePathname();
  const { sub, email, role } = useRole();
  const { mutate: submitFeedback, loading } = useSubmitFeedback();
  const toast = useToastActions();

  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");

  // Read-only context shared with the team. Captured errors only ever
  // include request KEYS, never values — so this block is PII-safe.
  const contextObj = {
    page: pathname,
    user: { sub, email, role },
    appVersion: APP_VERSION,
    lastError: lastError ?? undefined,
  };

  const formattedContext = JSON.stringify(contextObj, null, 2);

  const reset = () => {
    setDescription("");
    setCategory("");
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formattedContext);
      toast.success("Details copied to clipboard.");
    } catch {
      toast.error("Couldn't copy details.");
    }
  };

  const handleSubmit = async () => {
    if (!description.trim() || loading) return;
    try {
      await submitFeedback({
        description: description.trim(),
        category: category || undefined,
        context: contextObj,
      });
      toast.success("Thanks — your report was sent to the team.");
      reset();
      onClose();
    } catch {
      toast.error("Couldn't send your report. Please try again.");
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Report a problem"
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={handleClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={!description.trim() || loading}
          >
            {loading ? "Sending..." : "Send report"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label
            htmlFor="report-description"
            className="block text-sm font-medium text-foreground mb-1"
          >
            What happened?
          </label>
          <p className="text-xs text-muted-foreground mb-2">
            Write in your own language — you don&apos;t need to translate to
            English. We&apos;ll translate it for the team.
          </p>
          <textarea
            id="report-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            required
            placeholder="Describe what you were doing and what went wrong..."
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <Select
          label="Category (optional)"
          options={CATEGORY_OPTIONS}
          value={category}
          onChange={setCategory}
          placeholder="Select a category"
        />

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium text-foreground">
              Technical details
            </label>
            <button
              type="button"
              onClick={handleCopy}
              className="text-xs font-medium text-foreground rounded border border-border px-2 py-1 hover:bg-accent"
            >
              Copy details
            </button>
          </div>
          <pre className="max-h-48 overflow-auto rounded-md border border-border bg-muted/30 p-3 font-mono text-xs text-muted-foreground whitespace-pre-wrap break-words">
            {formattedContext}
          </pre>
        </div>
      </div>
    </Modal>
  );
}
