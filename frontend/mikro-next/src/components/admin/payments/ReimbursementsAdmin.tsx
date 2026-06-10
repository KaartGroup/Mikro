"use client";

/**
 * Admin-side reimbursement queue UI.
 *
 * Two exports used by /admin/payments:
 *
 *   - <ReimbursementsAdminPanel />: the full Reimbursements tab —
 *     filter by status, table with approve/reject actions, modal
 *     for each action so the admin picks the cycle (approve) or
 *     types a reason (reject).
 *
 *   - <ReimbursementsAdminSummary />: a small "Pending: N" widget
 *     that replaces the old "Reimbursement Inbox" stub on the
 *     Payments tab. Clicking it switches the parent to the
 *     Reimbursements tab.
 *
 * Pay-visibility is enforced server-side (the /pending endpoint
 * filters via can_view_pay_for); this component renders whatever the
 * backend returns.
 *
 * The receipt fetch uses a presigned GET URL — backend signs on
 * demand, frontend opens in a new tab. Bucket stays private.
 */

import { useEffect, useState, useCallback } from "react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  Select,
  Skeleton,
  useToastActions,
} from "@/components/ui";
import {
  usePendingReimbursements,
  useReimbursementAttachmentUrl,
} from "@/hooks";
import type { ReimbursementRequest, ReimbursementStatus } from "@/types";
import { formatCurrency, formatDate } from "@/lib/utils";
import { ApproveReimbursementModal } from "@/components/modals/reimbursement/ApproveReimbursementModal";
import { RejectReimbursementModal } from "@/components/modals/reimbursement/RejectReimbursementModal";

const STATUS_BADGE: Record<
  ReimbursementStatus,
  "warning" | "success" | "destructive" | "secondary"
> = {
  pending: "warning",
  approved: "success",
  rejected: "destructive",
  withdrawn: "secondary",
};

// ─── Small summary widget (lives on the Payments tab) ─────────────

interface SummaryProps {
  /** Parent passes this so the widget can switch tabs on click. */
  onNavigate: () => void;
}

export function ReimbursementsAdminSummary({ onNavigate }: SummaryProps) {
  const { mutate: fetchPending } = usePendingReimbursements();
  const [pendingCount, setPendingCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchPending({ status: "pending" })
      .then((res) => {
        if (cancelled) return;
        setPendingCount(res?.pending_count ?? 0);
      })
      .catch(() => {
        if (!cancelled) setPendingCount(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card
      className="cursor-pointer hover:border-kaart-orange/60 transition-colors"
      onClick={onNavigate}
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Reimbursement Inbox
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold">
            {pendingCount === null ? "—" : pendingCount}
          </span>
          <span className="text-sm text-muted-foreground">
            pending {pendingCount === 1 ? "request" : "requests"}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Click to open the Reimbursements tab →
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Full panel (lives on the Reimbursements tab) ────────────────

const STATUS_FILTER_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "withdrawn", label: "Withdrawn" },
  { value: "all", label: "All" },
];

interface ApproveModalState {
  request: ReimbursementRequest;
}

interface RejectModalState {
  request: ReimbursementRequest;
}

export function ReimbursementsAdminPanel() {
  const toast = useToastActions();
  const { mutate: fetchPending, loading } = usePendingReimbursements();
  const { mutate: fetchAttachmentUrl } = useReimbursementAttachmentUrl();

  const [rows, setRows] = useState<ReimbursementRequest[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [approveTarget, setApproveTarget] = useState<ApproveModalState | null>(
    null,
  );
  const [rejectTarget, setRejectTarget] = useState<RejectModalState | null>(
    null,
  );

  const reload = useCallback(async () => {
    try {
      const res = await fetchPending({ status: statusFilter });
      setRows(res?.requests ?? []);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Failed to load reimbursements",
      );
      setRows([]);
    }
  }, [statusFilter, fetchPending, toast]);

  useEffect(() => {
    reload();
    // `reload` is intentionally excluded from the deps. It captures
    // `fetchPending` (a useApiMutation handle that returns a fresh
    // function each render) — including `reload` here would refire
    // the effect on every render. `statusFilter` is the only
    // legitimate trigger: admin flips the dropdown, we refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

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

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <p className="text-muted-foreground max-w-2xl">
          Editor-submitted reimbursement requests. Approve to add the amount to
          the editor&apos;s next payout as an adjustment. Reject with a reviewer
          note so the editor sees the reason.
        </p>
        <div className="min-w-[200px]">
          <Select
            label="Status filter"
            value={statusFilter}
            onChange={setStatusFilter}
            options={STATUS_FILTER_OPTIONS}
          />
        </div>
      </div>

      {loading && rows.length === 0 ? (
        <Card>
          <CardContent className="py-4 space-y-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No reimbursement requests match this filter.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Reimbursement Requests ({rows.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-2 font-medium text-muted-foreground">
                      Editor
                    </th>
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
                      <td className="py-2 px-2">
                        <div className="font-medium">
                          {row.user_name || row.user_id}
                        </div>
                        {row.user_osm_username && (
                          <div className="text-xs text-muted-foreground">
                            {row.user_osm_username}
                          </div>
                        )}
                      </td>
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
                      <td className="py-2 px-2 space-x-2">
                        {row.status === "pending" ? (
                          <>
                            <Button
                              size="sm"
                              onClick={() => setApproveTarget({ request: row })}
                            >
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => setRejectTarget({ request: row })}
                            >
                              Reject
                            </Button>
                          </>
                        ) : (
                          <span className="text-muted-foreground text-xs">
                            —
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Approve modal — admin picks the cycle window. */}
      {approveTarget && (
        <ApproveReimbursementModal
          request={approveTarget.request}
          isOpen={!!approveTarget}
          onClose={() => setApproveTarget(null)}
          onApproved={reload}
        />
      )}

      {/* Reject modal — reviewer note required. */}
      {rejectTarget && (
        <RejectReimbursementModal
          request={rejectTarget.request}
          isOpen={!!rejectTarget}
          onClose={() => setRejectTarget(null)}
          onRejected={reload}
        />
      )}
    </div>
  );
}

