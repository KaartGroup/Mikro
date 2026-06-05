"use client";

/**
 * Reimbursement-request UI for the editor.
 *
 * Two exports used by /user/payments:
 *
 *   - <ReimbursementSubmitModal />: the new-request form, rendered at
 *     page level so the "Submit Reimbursement" header button can open
 *     it regardless of which tab is active.
 *
 *   - <ReimbursementsHistoryPanel />: the editor's own-history table,
 *     mounted as the Reimbursements tab content. Re-fetches on a
 *     refresh-key bump from the parent (i.e. when the modal submits
 *     successfully we bump the key so the new row shows up).
 *
 * Receipt uploads use the DO Spaces presigned-PUT pattern: client
 * calls /reimbursements/upload-url, PUTs the file straight to
 * Spaces, then calls /reimbursements/submit with the returned
 * object key. The receipt never proxies through Flask.
 *
 * Permission/visibility is enforced by the backend — this component
 * doesn't need to know who's logged in beyond what session brings.
 *
 * No cycle picker by design (locked 2026-05-21): admin assigns the
 * cycle at approval time.
 */

import { useEffect, useState, useCallback } from "react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  Modal,
  Input,
  Skeleton,
  useToastActions,
} from "@/components/ui";
import {
  useSubmitReimbursementRequest,
  useMyReimbursementRequests,
  useWithdrawReimbursementRequest,
  useReimbursementUploadUrl,
  useReimbursementAttachmentUrl,
} from "@/hooks";
import type { ReimbursementRequest, ReimbursementStatus } from "@/types";
import { formatCurrency } from "@/lib/utils";

const ALLOWED_RECEIPT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/heic",
  "application/pdf",
]);
const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

const STATUS_BADGE: Record<
  ReimbursementStatus,
  "warning" | "success" | "destructive" | "secondary"
> = {
  pending: "warning",
  approved: "success",
  rejected: "destructive",
  withdrawn: "secondary",
};

function formatDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ─── Submit modal ─────────────────────────────────────────────────

interface SubmitModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after a successful submit so the parent can refetch the
   *  history panel + switch the active tab to Reimbursements. */
  onSubmitted?: () => void;
}

export function ReimbursementSubmitModal({
  isOpen,
  onClose,
  onSubmitted,
}: SubmitModalProps) {
  const toast = useToastActions();
  const { mutate: submit, loading: submitting } =
    useSubmitReimbursementRequest();
  const { mutate: getUploadUrl } = useReimbursementUploadUrl();

  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [receipt, setReceipt] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  // Reset when the modal opens (don't carry over stale form state).
  useEffect(() => {
    if (isOpen) {
      setAmount("");
      setDescription("");
      setReceipt(null);
      setUploading(false);
    }
  }, [isOpen]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (file) {
      if (!ALLOWED_RECEIPT_TYPES.has(file.type)) {
        toast.error("Receipt must be JPG, PNG, HEIC, or PDF");
        return;
      }
      if (file.size > MAX_RECEIPT_BYTES) {
        toast.error("Receipt is larger than 10 MB");
        return;
      }
    }
    setReceipt(file);
  };

  const handleSubmit = async () => {
    const amt = parseFloat(amount);
    if (!isFinite(amt) || amt <= 0) {
      toast.error("Amount must be greater than 0");
      return;
    }
    if (!description.trim()) {
      toast.error("Description is required");
      return;
    }

    let attachmentKey: string | undefined;
    if (receipt) {
      // Two-step: get presigned PUT URL, then PUT the file directly to
      // Spaces. The Flask backend never sees the file bytes.
      setUploading(true);
      try {
        const presigned = await getUploadUrl({
          filename: receipt.name,
          content_type: receipt.type,
        });
        if (!presigned?.url || !presigned?.key) {
          throw new Error(presigned?.message || "Failed to get upload URL");
        }
        const putRes = await fetch(presigned.url, {
          method: "PUT",
          headers: { "Content-Type": receipt.type },
          body: receipt,
        });
        if (!putRes.ok) {
          throw new Error(`Receipt upload failed (HTTP ${putRes.status})`);
        }
        attachmentKey = presigned.key;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Receipt upload failed");
        setUploading(false);
        return;
      }
      setUploading(false);
    }

    try {
      await submit({
        amount: amt,
        description: description.trim(),
        attachment_url: attachmentKey ?? null,
      });
      toast.success("Reimbursement request submitted");
      onClose();
      onSubmitted?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to submit");
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Submit Reimbursement Request"
      description="Your request enters the admin queue for review. On approval the amount is added to your next payout."
    >
      <div className="space-y-3">
        <Input
          label="Amount (USD)"
          type="number"
          step="0.01"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
        />
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Description</label>
          <textarea
            className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
            rows={4}
            maxLength={2000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What was the expense for? Include any context the admin needs to approve."
          />
          <p className="text-xs text-muted-foreground">
            {description.length} / 2000 characters
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Receipt (optional)</label>
          <input
            type="file"
            accept="image/jpeg,image/png,image/heic,application/pdf"
            onChange={handleFileChange}
            className="text-sm"
          />
          <p className="text-xs text-muted-foreground">
            JPG, PNG, HEIC, or PDF. Max 10 MB.
          </p>
          {receipt && (
            <p className="text-xs text-muted-foreground">
              Selected: <strong>{receipt.name}</strong> (
              {Math.round(receipt.size / 1024)} KB)
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={submitting || uploading}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || uploading}>
            {uploading ? "Uploading…" : submitting ? "Submitting…" : "Submit"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── My history panel ────────────────────────────────────────────

interface HistoryPanelProps {
  /** Bumped by parent after a successful submit to trigger a refetch. */
  refreshKey?: number;
}

export function ReimbursementsHistoryPanel({
  refreshKey = 0,
}: HistoryPanelProps) {
  const toast = useToastActions();
  const { mutate: fetchMy, loading } = useMyReimbursementRequests();
  const { mutate: withdraw, loading: withdrawing } =
    useWithdrawReimbursementRequest();
  const { mutate: fetchAttachmentUrl } = useReimbursementAttachmentUrl();

  const [rows, setRows] = useState<ReimbursementRequest[]>([]);

  const reload = useCallback(async () => {
    try {
      const res = await fetchMy({});
      setRows(res?.requests ?? []);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Failed to load reimbursements",
      );
      setRows([]);
    }
  }, [fetchMy, toast]);

  useEffect(() => {
    reload();
    // `reload` is intentionally excluded from the deps. It captures
    // `fetchMy` (a useApiMutation handle that returns a fresh
    // function each render) — including `reload` here would refire
    // the effect on every render and produce an infinite refetch
    // loop. `refreshKey` is the only legitimate trigger: parent
    // bumps it on a successful submit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const handleWithdraw = async (id: number) => {
    try {
      await withdraw({ request_id: id });
      toast.success("Request withdrawn");
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to withdraw");
    }
  };

  const handleViewReceipt = async (id: number) => {
    try {
      const res = await fetchAttachmentUrl({ request_id: id });
      if (res?.url) {
        window.open(res.url, "_blank", "noopener,noreferrer");
      } else {
        toast.error(res?.message || "Could not load receipt");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load receipt");
    }
  };

  if (loading && rows.length === 0) {
    return (
      <Card>
        <CardContent className="py-4 space-y-2">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
        </CardContent>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          You haven&apos;t submitted any reimbursement requests yet. Use the
          <strong> Submit Reimbursement </strong> button above to create one.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          My Reimbursement Requests
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-2 font-medium text-muted-foreground">
                  Submitted
                </th>
                <th className="text-left py-2 px-2 font-medium text-muted-foreground">
                  Amount
                </th>
                <th className="text-left py-2 px-2 font-medium text-muted-foreground">
                  Description
                </th>
                <th className="text-left py-2 px-2 font-medium text-muted-foreground">
                  Receipt
                </th>
                <th className="text-left py-2 px-2 font-medium text-muted-foreground">
                  Status
                </th>
                <th className="text-left py-2 px-2 font-medium text-muted-foreground">
                  Reviewer note
                </th>
                <th className="text-left py-2 px-2 font-medium text-muted-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-border last:border-0"
                >
                  <td className="py-2 px-2 text-muted-foreground">
                    {formatDate(row.submitted_at)}
                  </td>
                  <td className="py-2 px-2 font-mono">
                    {formatCurrency(row.amount).text}
                  </td>
                  <td
                    className="py-2 px-2 max-w-md truncate"
                    title={row.description}
                  >
                    {row.description}
                  </td>
                  <td className="py-2 px-2">
                    {row.has_attachment ? (
                      <button
                        type="button"
                        className="text-kaart-orange hover:underline text-xs"
                        onClick={() => handleViewReceipt(row.id)}
                      >
                        View
                      </button>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-2 px-2">
                    <Badge variant={STATUS_BADGE[row.status]}>
                      {row.status}
                    </Badge>
                  </td>
                  <td
                    className="py-2 px-2 text-muted-foreground max-w-xs truncate"
                    title={row.reviewer_note ?? undefined}
                  >
                    {row.reviewer_note || "—"}
                  </td>
                  <td className="py-2 px-2">
                    {row.status === "pending" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleWithdraw(row.id)}
                        disabled={withdrawing}
                      >
                        Withdraw
                      </Button>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
