"use client";

import { useEffect, useState } from "react";
import { Modal, Button, Input, Select, useToastActions } from "@/components/ui";
import { Val } from "@/components/ui";
import { formatCurrency, formatNumber } from "@/lib/utils";
import {
  useFetchPaymentContributor,
  useCreatePaymentAdjustment,
  useDeletePaymentAdjustment,
} from "@/hooks/useApi";
import type {
  PaymentContributorDetailResponse,
  PaymentCycleRow,
} from "@/types";

interface ContributorDetailDrawerProps {
  row: PaymentCycleRow | null;
  cycleStart: string;
  cycleEnd: string;
  canEdit: boolean;
  onClose: () => void;
  onChanged?: () => void;
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

export function ContributorDetailDrawer({
  row,
  cycleStart,
  cycleEnd,
  canEdit,
  onClose,
  onChanged,
}: ContributorDetailDrawerProps) {
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
  const [adjustType, setAdjustType] = useState<"reimbursement" | "correction" | "other">(
    "reimbursement",
  );
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
    })
      .then((res) => setDetail(res))
      .catch(() => toast.error("Failed to load contributor detail"));
    // `toast` is intentionally excluded from the deps: useToastActions()
    // returns a fresh object literal every render, so including it would
    // refire this effect (and refetch contributor detail) on every render.
    // `fetchContributor` is also non-stable for the same reason.
  }, [row?.user_id, cycleStart, cycleEnd]); // eslint-disable-line react-hooks/exhaustive-deps

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
      // Reload detail + table
      const refreshed = await fetchContributor({
        user_id: row.user_id,
        cycle_start: cycleStart,
        cycle_end: cycleEnd,
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
      });
      setDetail(refreshed);
      onChanged?.();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to remove adjustment",
      );
    }
  };

  return (
    <Modal
      isOpen={!!row}
      onClose={onClose}
      title={row ? `${row.name} — ${cycleStart} to ${cycleEnd}` : ""}
      size="lg"
      footer={
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      }
    >
      {!row ? null : fetching || !detail ? (
        <div className="p-8 text-center text-muted-foreground text-sm">
          Loading…
        </div>
      ) : (
        <div className="space-y-6">
          {/* Header summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Hours</div>
              <div className="font-medium tabular-nums">
                <Val>{formatNumber(detail.contributor.hours)}</Val>
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Rate</div>
              <div className="font-medium tabular-nums">
                {detail.contributor.hourly_rate !== null ? (
                  <Val>{formatCurrency(detail.contributor.hourly_rate)}</Val>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Wage</div>
              <div className="font-medium tabular-nums">
                {detail.contributor.calculated_wage !== null ? (
                  <Val>{formatCurrency(detail.contributor.calculated_wage)}</Val>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Total Payable</div>
              <div className="font-semibold tabular-nums">
                <Val>{formatCurrency(detail.contributor.total_payable)}</Val>
              </div>
            </div>
          </div>

          {/* Adjustments */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">
                Adjustments ({detail.adjustments.length})
              </h3>
              {canEdit && (
                <Button
                  size="sm"
                  variant="primary"
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

          {/* Session breakdown */}
          <div>
            <h3 className="text-sm font-semibold mb-2">
              Sessions ({detail.sessions.length})
            </h3>
            {detail.sessions.length === 0 ? (
              <div className="text-xs text-muted-foreground">
                No completed sessions in this cycle.
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground uppercase sticky top-0 bg-background">
                    <tr>
                      <th className="text-left px-2 py-1">Clock In</th>
                      <th className="text-left px-2 py-1">Clock Out</th>
                      <th className="text-left px-2 py-1">Category</th>
                      <th className="text-left px-2 py-1">Task / Project</th>
                      <th className="text-right px-2 py-1">Duration</th>
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
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
