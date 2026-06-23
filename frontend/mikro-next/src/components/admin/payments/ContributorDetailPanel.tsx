"use client";

import { useEffect, useState } from "react";
import { Button, Val } from "@/components/ui";
import { formatCurrency, formatNumber, formatDateTime } from "@/lib/utils";
import { formatDurationHuman } from "@/lib/timeTracking";
import {
  useFetchPaymentContributor,
} from "@/hooks/useApi";
import { DirectAddReimbursementModal } from "@/components/modals/reimbursement/DirectAddReimbursementModal";
import { toast } from "sonner";
import type {
  PaymentContributorDetailResponse,
  PaymentContributorReimbursement,
  PaymentCycleRow,
  PaymentCycleStatus,
} from "@/types";

interface ContributorDetailPanelProps {
  row: PaymentCycleRow | null;
  cycleStart: string;
  cycleEnd: string;
  /** Master page filter — inherited so the drill-in can't conflict with it. */
  filters?: Record<string, string[]>;
  onChanged?: () => void;
  onApprove?: (row: PaymentCycleRow) => void;
  onHold?: (row: PaymentCycleRow) => void;
  onMarkPaid?: (row: PaymentCycleRow) => void;
  onResetPending?: (row: PaymentCycleRow) => void;
}

const STATUS_LABEL: Record<PaymentCycleStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  held: "Held",
  paid: "Paid",
};

const STATUS_CLASSES: Record<PaymentCycleStatus, string> = {
  pending:
    "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200",
  approved:
    "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
  held: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  paid: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
};

const AVATAR_COLORS = [
  "bg-blue-500",
  "bg-purple-500",
  "bg-pink-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-cyan-500",
  "bg-indigo-500",
  "bg-rose-500",
  "bg-teal-500",
  "bg-orange-500",
];
function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");
}
export function ContributorDetailPanel({
  row,
  cycleStart,
  cycleEnd,
  filters,
  onApprove,
  onHold,
  onMarkPaid,
  onResetPending,
}: ContributorDetailPanelProps) {
  const { mutate: fetchContributor, loading: fetching } =
    useFetchPaymentContributor();

  const [detail, setDetail] = useState<PaymentContributorDetailResponse | null>(
    null,
  );
  const [addReimbursementOpen, setAddReimbursementOpen] = useState(false);

  const loadDetail = (userId: string) => {
    fetchContributor({
      user_id: userId,
      cycle_start: cycleStart,
      cycle_end: cycleEnd,
      ...(filters ? { filters } : {}),
    })
      .then((res) => setDetail(res))
      .catch((err) =>
        toast.error(
          err instanceof Error
            ? `Failed to load contributor detail: ${err.message}`
            : "Failed to load contributor detail",
        ),
      );
  };

  useEffect(() => {
    if (!row) {
      setDetail(null);
      return;
    }
    loadDetail(row.user_id);
    // `fetchContributor` and `toast` are non-stable so excluded from deps.
  }, [row?.user_id, cycleStart, cycleEnd, filters]); // eslint-disable-line react-hooks/exhaustive-deps

  // Empty state — no row selected
  if (!row) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground italic">
        Click a contributor in the table above to see session breakdown,
        adjustments, and status controls here.
      </div>
    );
  }

  if (fetching || !detail) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        Loading {row.name}…
      </div>
    );
  }

  const c = detail.contributor;
  const basePay =
    c.hourly_rate !== null ? c.hours * c.hourly_rate : (c.calculated_wage ?? 0);

  

  return (
    <div className="rounded-md border border-border bg-muted/10 overflow-hidden">
      {/* Header band — identity left, money + actions right */}
      <div className="flex items-center justify-between gap-4 flex-wrap p-4 bg-muted/20 border-b border-border">
        {/* Identity */}
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`w-14 h-14 shrink-0 rounded-full flex items-center justify-center text-white text-lg font-semibold ${avatarColor(c.name || c.user_id)}`}
          >
            {initials(c.name || "??")}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-base truncate">{c.name}</span>
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[c.status]}`}
              >
                {STATUS_LABEL[c.status]}
              </span>
            </div>
            <div className="text-xs text-muted-foreground truncate">
              {c.osm_username || c.email}
            </div>
            <div className="text-[10px] text-muted-foreground italic mt-0.5">
              <span>Location</span>
            </div>
            {c.status === "held" && c.status_note && (
              <div className="text-xs text-red-700 dark:text-red-300 mt-0.5">
                On hold: {c.status_note}
              </div>
            )}
          </div>
        </div>

        {/* Money + actions */}
        <div className="flex items-center gap-5">
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Total Payable
            </div>
            <div className="text-2xl font-bold tabular-nums leading-tight">
              <Val>{formatCurrency(c.total_payable)}</Val>
            </div>
            <div className="text-[11px] text-muted-foreground">
              {c.hourly_rate !== null
                ? `${formatCurrency(c.hourly_rate).text}/hr × ${formatNumber(c.hours).text} hrs`
                : `${formatNumber(c.hours).text} hrs`}
            </div>
          </div>
            <div className="flex flex-col gap-1.5">
              {c.status === "pending" && (
                <>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => onApprove?.(c)}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onHold?.(c)}
                  >
                    Hold
                  </Button>
                </>
              )}
              {c.status === "approved" && (
                <>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => onMarkPaid?.(c)}
                  >
                    Mark Paid
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onResetPending?.(c)}
                  >
                    Undo
                  </Button>
                </>
              )}
              {c.status === "held" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onResetPending?.(c)}
                >
                  Release
                </Button>
              )}
            </div>
        </div>
      </div>
        <div className="p-4">
            <PayrollSummaryTab
              contributor={c}
              basePay={basePay}
              detail={detail}
              reimbursements={detail.reimbursements ?? []}
              onAddReimbursement={() => setAddReimbursementOpen(true)}
            />
        </div>
      {addReimbursementOpen && (
        <DirectAddReimbursementModal
          userId={c.user_id}
          userName={c.name || c.user_id}
          isOpen={addReimbursementOpen}
          onClose={() => setAddReimbursementOpen(false)}
          onAdded={() => loadDetail(c.user_id)}
        />
      )}
    </div>
  );
}

// ─── sub-components ─────────────────────────────────────────────────

// Mock placeholders removed — non-backed contributor detail tabs were deleted

interface PayrollSummaryTabProps {
  contributor: PaymentCycleRow;
  basePay: number;
  detail: PaymentContributorDetailResponse;
  reimbursements: PaymentContributorReimbursement[];
  onAddReimbursement: () => void;
}

function PayrollSummaryTab({
  contributor: c,
  basePay,
  detail,
  reimbursements,
  onAddReimbursement,
}: PayrollSummaryTabProps) {
  return (
    <div className="space-y-5">
      {/* Stat grid — Base Pay / Hourly Rate (Total lives in header band) */}
      <div className="grid grid-cols-2 gap-4 pb-4 border-b border-border">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">
            Base Pay
          </div>
          <div className="text-lg font-bold tabular-nums">
            <Val>{formatCurrency(basePay)}</Val>
          </div>
          <div className="text-[10px] text-muted-foreground">
            {formatNumber(c.hours).text} hrs
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">
            Hourly Rate
          </div>
          <div className="text-lg font-bold tabular-nums">
            {c.hourly_rate !== null ? (
              <Val>{formatCurrency(c.hourly_rate)}</Val>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </div>
          <div className="text-[10px] text-muted-foreground">per hour</div>
        </div>
      </div>

      {/* Sessions — capped at 6 rows visible, scroll for more */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
            Sessions ({detail.sessions.length})
          </h3>
          {detail.sessions.length > 6 && (
            <span className="text-[10px] text-muted-foreground italic">
              Scroll ↓ for {detail.sessions.length - 6} more
            </span>
          )}
        </div>
        {detail.sessions.length === 0 ? (
          <div className="text-xs text-muted-foreground">
            No completed sessions in this cycle.
          </div>
        ) : (
          <div className="relative">
            <div className="max-h-[200px] overflow-y-auto rounded border border-border">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground uppercase sticky top-0 bg-muted/40 backdrop-blur">
                  <tr>
                    <th className="text-left px-2 py-1.5">Clock In</th>
                    <th className="text-left px-2 py-1.5">Clock Out</th>
                    <th className="text-left px-2 py-1.5">Category</th>
                    <th className="text-left px-2 py-1.5">Task / Project</th>
                    <th className="text-right px-2 py-1.5">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.sessions.map((s) => (
                    <tr key={s.id} className="border-t border-border">
                      <td className="px-2 py-1">
                        {formatDateTime(s.clock_in)}
                      </td>
                      <td className="px-2 py-1">
                        {formatDateTime(s.clock_out)}
                      </td>
                      <td className="px-2 py-1 capitalize">{s.category}</td>
                      <td className="px-2 py-1">{s.task_name || "—"}</td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {formatDurationHuman(s.duration_seconds)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {detail.sessions.length > 6 && (
              <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-background to-transparent rounded-b" />
            )}
          </div>
        )}
      </div>

      {/* Approved Reimbursements */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
            Approved Reimbursements ({reimbursements.length})
          </h3>
          <Button size="sm" variant="outline" onClick={onAddReimbursement}>
            Add
          </Button>
        </div>
        {reimbursements.length === 0 ? (
          <div className="text-xs text-muted-foreground">
            No approved reimbursements for this contributor.
          </div>
        ) : (
          <div className="rounded border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground uppercase bg-muted/40">
                <tr>
                  <th className="text-left px-2 py-1.5">Submitted</th>
                  <th className="text-left px-2 py-1.5">Description</th>
                  <th className="text-right px-2 py-1.5">Amount</th>
                </tr>
              </thead>
              <tbody>
                {reimbursements.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-2 py-1 whitespace-nowrap text-muted-foreground">
                      {r.submitted_at ? formatDateTime(r.submitted_at) : "—"}
                    </td>
                    <td
                      className="px-2 py-1 max-w-xs truncate"
                      title={r.description}
                    >
                      {r.description}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums font-medium">
                      <Val>{formatCurrency(r.amount)}</Val>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
