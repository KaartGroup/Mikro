"use client";

import { useEffect, useState } from "react";
import { Button, Input, Select, useToastActions, Val } from "@/components/ui";
import { formatCurrency, formatNumber } from "@/lib/utils";
import {
  useFetchPaymentContributor,
  useCreatePaymentAdjustment,
  useDeletePaymentAdjustment,
} from "@/hooks/useApi";
import type {
  PaymentContributorDetailResponse,
  PaymentCycleRow,
  PaymentCycleStatus,
} from "@/types";

interface ContributorDetailPanelProps {
  row: PaymentCycleRow | null;
  cycleStart: string;
  cycleEnd: string;
  /** Master page filter — inherited so the drill-in can't conflict with it. */
  filters?: Record<string, string[]>;
  canEdit: boolean;
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
  pending: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200",
  approved: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
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
function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}
function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString();
}

export function ContributorDetailPanel({
  row,
  cycleStart,
  cycleEnd,
  filters,
  canEdit,
  onChanged,
  onApprove,
  onHold,
  onMarkPaid,
  onResetPending,
}: ContributorDetailPanelProps) {
  const toast = useToastActions();
  const { mutate: fetchContributor, loading: fetching } =
    useFetchPaymentContributor();
  const { mutate: createAdjustment, loading: creating } =
    useCreatePaymentAdjustment();
  const { mutate: deleteAdjustment } = useDeletePaymentAdjustment();

  const [detail, setDetail] = useState<PaymentContributorDetailResponse | null>(
    null,
  );

  // Adjustment form state
  const [showAdjustForm, setShowAdjustForm] = useState(false);
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustType, setAdjustType] = useState<
    "reimbursement" | "correction" | "other"
  >("reimbursement");
  const [adjustNote, setAdjustNote] = useState("");

  useEffect(() => {
    if (!row) {
      setDetail(null);
      return;
    }
    fetchContributor({
      user_id: row.user_id,
      cycle_start: cycleStart,
      cycle_end: cycleEnd,
      ...(filters ? { filters } : {}),
    })
      .then((res) => setDetail(res))
      .catch(() => toast.error("Failed to load contributor detail"));
    // `toast` is intentionally excluded from the deps: useToastActions()
    // returns a fresh object literal every render, so including it would
    // refire this effect (and refetch contributor detail) on every render.
    // `fetchContributor` is also non-stable for the same reason.
  }, [row?.user_id, cycleStart, cycleEnd, filters]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAddAdjustment = async () => {
    if (!row) return;
    const amount = parseFloat(adjustAmount);
    if (isNaN(amount) || amount === 0) {
      toast.error("Amount must be a non-zero number");
      return;
    }
    try {
      await createAdjustment({
        user_id: row.user_id,
        cycle_start: cycleStart,
        cycle_end: cycleEnd,
        amount,
        type: adjustType,
        note: adjustNote.trim() || null,
        source: "admin_entry",
      });
      toast.success("Adjustment added");
      setShowAdjustForm(false);
      setAdjustAmount("");
      setAdjustNote("");
      const refreshed = await fetchContributor({
        user_id: row.user_id,
        cycle_start: cycleStart,
        cycle_end: cycleEnd,
        ...(filters ? { filters } : {}),
      });
      setDetail(refreshed);
      onChanged?.();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to add adjustment",
      );
    }
  };

  const handleDeleteAdjustment = async (id: number) => {
    if (!row) return;
    if (!window.confirm("Remove this adjustment?")) return;
    try {
      await deleteAdjustment({ adjustment_id: id });
      toast.success("Adjustment removed");
      const refreshed = await fetchContributor({
        user_id: row.user_id,
        cycle_start: cycleStart,
        cycle_end: cycleEnd,
        ...(filters ? { filters } : {}),
      });
      setDetail(refreshed);
      onChanged?.();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to remove adjustment",
      );
    }
  };

  type DetailTab =
    | "payroll"
    | "projects"
    | "compensation"
    | "payment"
    | "history";
  const [activeTab, setActiveTab] = useState<DetailTab>("payroll");

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
    c.hourly_rate !== null ? c.hours * c.hourly_rate : c.calculated_wage ?? 0;

  const tabs: { id: DetailTab; label: string; mock: boolean }[] = [
    { id: "payroll", label: "Payroll Summary", mock: false },
    { id: "projects", label: "Project Allocations", mock: true },
    { id: "compensation", label: "Compensation Breakdown", mock: true },
    { id: "payment", label: "Payment Info", mock: true },
    { id: "history", label: "History", mock: true },
  ];

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
            <div className="text-[10px] text-muted-foreground italic mt-0.5 flex items-center gap-1">
              <span>Location</span>
              <span className="inline-flex items-center px-1 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 not-italic">
                Mock
              </span>
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
          {canEdit && (
            <div className="flex flex-col gap-1.5">
              {c.status === "pending" && (
                <>
                  <Button size="sm" variant="primary" onClick={() => onApprove?.(c)}>
                    Approve
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => onHold?.(c)}>
                    Hold
                  </Button>
                </>
              )}
              {c.status === "approved" && (
                <>
                  <Button size="sm" variant="primary" onClick={() => onMarkPaid?.(c)}>
                    Mark Paid
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => onResetPending?.(c)}>
                    Undo
                  </Button>
                </>
              )}
              {c.status === "held" && (
                <Button size="sm" variant="outline" onClick={() => onResetPending?.(c)}>
                  Release
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Tabs + content */}
      <div>
        <div className="border-b border-border bg-muted/20 px-3">
          <nav className="flex -mb-px overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`whitespace-nowrap px-3 py-2.5 text-sm border-b-2 transition-colors flex items-center gap-1.5 ${
                  activeTab === tab.id
                    ? "border-primary text-foreground font-semibold"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
                {tab.mock && (
                  <span className="inline-flex items-center px-1 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                    Mock
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>

        <div className="p-4">
          {activeTab === "payroll" && (
            <PayrollSummaryTab
              contributor={c}
              basePay={basePay}
              detail={detail}
              canEdit={canEdit}
              showAdjustForm={showAdjustForm}
              setShowAdjustForm={setShowAdjustForm}
              adjustAmount={adjustAmount}
              setAdjustAmount={setAdjustAmount}
              adjustType={adjustType}
              setAdjustType={setAdjustType}
              adjustNote={adjustNote}
              setAdjustNote={setAdjustNote}
              handleAddAdjustment={handleAddAdjustment}
              handleDeleteAdjustment={handleDeleteAdjustment}
              creating={creating}
            />
          )}
          {activeTab === "projects" && <MockTabPlaceholder label="Project Allocations" />}
          {activeTab === "compensation" && (
            <MockTabPlaceholder label="Compensation Breakdown" />
          )}
          {activeTab === "payment" && (
            <MockTabPlaceholder label="Payment Info" />
          )}
          {activeTab === "history" && <MockTabPlaceholder label="History" />}
        </div>
      </div>
    </div>
  );
}

// ─── sub-components ─────────────────────────────────────────────────

function MockTabPlaceholder({ label }: { label: string }) {
  return (
    <div className="p-8 text-center text-sm text-muted-foreground italic border border-dashed border-border rounded-md">
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 mr-2 not-italic">
        Mock
      </span>
      <strong className="not-italic">{label}</strong> — not yet wired. Will surface
      contributor-specific {label.toLowerCase()} once endpoint is added.
    </div>
  );
}

interface PayrollSummaryTabProps {
  contributor: PaymentCycleRow;
  basePay: number;
  detail: PaymentContributorDetailResponse;
  canEdit: boolean;
  showAdjustForm: boolean;
  setShowAdjustForm: (v: boolean | ((p: boolean) => boolean)) => void;
  adjustAmount: string;
  setAdjustAmount: (v: string) => void;
  adjustType: "reimbursement" | "correction" | "other";
  setAdjustType: (v: "reimbursement" | "correction" | "other") => void;
  adjustNote: string;
  setAdjustNote: (v: string) => void;
  handleAddAdjustment: () => void;
  handleDeleteAdjustment: (id: number) => void;
  creating: boolean;
}

function PayrollSummaryTab({
  contributor: c,
  basePay,
  detail,
  canEdit,
  showAdjustForm,
  setShowAdjustForm,
  adjustAmount,
  setAdjustAmount,
  adjustType,
  setAdjustType,
  adjustNote,
  setAdjustNote,
  handleAddAdjustment,
  handleDeleteAdjustment,
  creating,
}: PayrollSummaryTabProps) {
  return (
    <div className="space-y-5">
      {/* Stat grid — Base Pay / Hourly / Adjustments (Total lives in header band) */}
      <div className="grid grid-cols-3 gap-4 pb-4 border-b border-border">
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
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">
            Adjustments
          </div>
          <div className="text-lg font-bold tabular-nums">
            <Val>{formatCurrency(c.adjustments_total)}</Val>
          </div>
          <div className="text-[10px] text-muted-foreground">
            {c.adjustments_count} entries
          </div>
        </div>
      </div>

      {/* Adjustments */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
            Adjustments ({detail.adjustments.length})
          </h3>
          {canEdit && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowAdjustForm((v) => !v)}
            >
              {showAdjustForm ? "Cancel" : "Add adjustment"}
            </Button>
          )}
        </div>
        {showAdjustForm && canEdit && (
          <div className="mb-3 p-3 rounded-md border border-input bg-muted/30 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Input
                label="Amount"
                type="number"
                step="0.01"
                value={adjustAmount}
                onChange={(e) => setAdjustAmount(e.target.value)}
                placeholder="139.00"
              />
              <Select
                label="Type"
                value={adjustType}
                onChange={(v) =>
                  setAdjustType(v as "reimbursement" | "correction" | "other")
                }
                options={[
                  { value: "reimbursement", label: "Reimbursement" },
                  { value: "correction", label: "Correction" },
                  { value: "other", label: "Other" },
                ]}
              />
            </div>
            <Input
              label="Note"
              value={adjustNote}
              onChange={(e) => setAdjustNote(e.target.value)}
              placeholder="What is this for?"
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="primary"
                onClick={handleAddAdjustment}
                isLoading={creating}
              >
                Save adjustment
              </Button>
            </div>
          </div>
        )}
        {detail.adjustments.length === 0 ? (
          <div className="text-xs text-muted-foreground">
            No adjustments for this cycle.
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-muted-foreground uppercase">
              <tr>
                <th className="text-left px-2 py-1">Date</th>
                <th className="text-left px-2 py-1">Type</th>
                <th className="text-left px-2 py-1">Note</th>
                <th className="text-left px-2 py-1">Added by</th>
                <th className="text-right px-2 py-1">Amount</th>
                {canEdit && <th />}
              </tr>
            </thead>
            <tbody>
              {detail.adjustments.map((a) => (
                <tr key={a.id} className="border-t border-border">
                  <td className="px-2 py-1">{formatDateTime(a.created_at)}</td>
                  <td className="px-2 py-1 capitalize">{a.type}</td>
                  <td className="px-2 py-1">{a.note || "—"}</td>
                  <td className="px-2 py-1">{a.added_by_name || a.added_by}</td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    <Val>{formatCurrency(a.amount)}</Val>
                  </td>
                  {canEdit && (
                    <td className="px-2 py-1 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDeleteAdjustment(a.id)}
                      >
                        Remove
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
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
                      <td className="px-2 py-1">{formatDateTime(s.clock_in)}</td>
                      <td className="px-2 py-1">{formatDateTime(s.clock_out)}</td>
                      <td className="px-2 py-1 capitalize">{s.category}</td>
                      <td className="px-2 py-1">{s.task_name || "—"}</td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {formatDuration(s.duration_seconds)}
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
    </div>
  );
}
