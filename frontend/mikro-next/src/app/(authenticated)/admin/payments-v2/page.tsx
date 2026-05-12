"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Modal,
  Input,
  Skeleton,
  useToastActions,
  Val,
} from "@/components/ui";
import { formatCurrency } from "@/lib/utils";
import {
  useFetchPaymentCycle,
  useFetchPaymentCycleKpis,
  useSetPaymentCycleStatus,
  useExportPaymentCycle,
  useCurrentUserRole,
} from "@/hooks";
import { isOrgAdminOrAbove } from "@/types";
import type {
  PaymentCycleKpis,
  PaymentCycleResponse,
  PaymentCycleRow,
  PaymentCycleStatus,
} from "@/types";
import { PaymentsTable } from "@/components/admin/payments/PaymentsTable";
import { ContributorDetailDrawer } from "@/components/admin/payments/ContributorDetailDrawer";

// ─── helpers ────────────────────────────────────────────────────────

function firstOfMonthIso(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function lastOfMonthIso(d = new Date()): string {
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-${String(
    last.getDate(),
  ).padStart(2, "0")}`;
}

function firstOfLastMonthIso(d = new Date()): string {
  const target = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return firstOfMonthIso(target);
}

function lastOfLastMonthIso(d = new Date()): string {
  const target = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return lastOfMonthIso(target);
}

// ─── page ───────────────────────────────────────────────────────────

export default function AdminPaymentsV2Page() {
  const toast = useToastActions();
  const { role: viewerRole } = useCurrentUserRole();
  const canEdit = isOrgAdminOrAbove(viewerRole);

  // Cycle state
  const [cycleStart, setCycleStart] = useState(firstOfMonthIso());
  const [cycleEnd, setCycleEnd] = useState(lastOfMonthIso());
  const [includeZeroHours, setIncludeZeroHours] = useState(false);

  // Data
  const [rows, setRows] = useState<PaymentCycleRow[]>([]);
  const [kpis, setKpis] = useState<PaymentCycleKpis | null>(null);
  const { mutate: fetchCycle, loading: cycleLoading } = useFetchPaymentCycle();
  const { mutate: fetchKpis } = useFetchPaymentCycleKpis();
  const { mutate: setStatus } = useSetPaymentCycleStatus();
  const { download: exportCsv, loading: exporting } = useExportPaymentCycle();

  // Drill-in drawer
  const [drillRow, setDrillRow] = useState<PaymentCycleRow | null>(null);

  // Hold modal
  const [holdTarget, setHoldTarget] = useState<PaymentCycleRow | null>(null);
  const [holdNote, setHoldNote] = useState("");

  // Load cycle + KPIs
  const reload = async () => {
    try {
      const [cycle, kpisRes] = await Promise.all([
        fetchCycle({
          cycle_start: cycleStart,
          cycle_end: cycleEnd,
          include_zero_hours: includeZeroHours,
        }),
        fetchKpis({ cycle_start: cycleStart, cycle_end: cycleEnd }),
      ]);
      setRows((cycle as PaymentCycleResponse).rows);
      setKpis(kpisRes.kpis);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to load payroll cycle",
      );
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycleStart, cycleEnd, includeZeroHours]);

  // Status setters
  const setRowStatus = async (
    row: PaymentCycleRow,
    status: PaymentCycleStatus,
    note?: string,
  ) => {
    try {
      await setStatus({
        user_id: row.user_id,
        cycle_start: cycleStart,
        cycle_end: cycleEnd,
        status,
        note: note ?? null,
      });
      toast.success(`Marked ${row.name} as ${status}`);
      reload();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update status",
      );
    }
  };

  const onApprove = (row: PaymentCycleRow) => setRowStatus(row, "approved");
  const onHold = (row: PaymentCycleRow) => {
    setHoldTarget(row);
    setHoldNote("");
  };
  const onConfirmHold = async () => {
    if (!holdTarget) return;
    if (!holdNote.trim()) {
      toast.error("Hold reason is required");
      return;
    }
    await setRowStatus(holdTarget, "held", holdNote.trim());
    setHoldTarget(null);
  };
  const onMarkPaid = (row: PaymentCycleRow) => setRowStatus(row, "paid");
  const onResetPending = (row: PaymentCycleRow) =>
    setRowStatus(row, "pending");

  const onExport = async () => {
    try {
      await exportCsv(cycleStart, cycleEnd);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    }
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Payroll & Financial Operations</h1>
          <p className="text-sm text-muted-foreground">
            Hourly contractor payroll for the selected cycle. New page —
            existing /admin/payments is unchanged.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && (
            <Button
              variant="primary"
              onClick={onExport}
              isLoading={exporting}
              disabled={!kpis || kpis.approved_count === 0}
            >
              Export approved (CSV)
            </Button>
          )}
        </div>
      </div>

      {/* Cycle selector */}
      <Card>
        <CardHeader>
          <CardTitle>Cycle</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-3 flex-wrap">
            <Input
              label="Cycle start"
              type="date"
              value={cycleStart}
              onChange={(e) => setCycleStart(e.target.value)}
              className="w-44"
            />
            <Input
              label="Cycle end"
              type="date"
              value={cycleEnd}
              onChange={(e) => setCycleEnd(e.target.value)}
              className="w-44"
            />
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setCycleStart(firstOfMonthIso());
                  setCycleEnd(lastOfMonthIso());
                }}
              >
                This month
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setCycleStart(firstOfLastMonthIso());
                  setCycleEnd(lastOfLastMonthIso());
                }}
              >
                Last month
              </Button>
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground ml-auto cursor-pointer">
              <input
                type="checkbox"
                checked={includeZeroHours}
                onChange={(e) => setIncludeZeroHours(e.target.checked)}
              />
              Show contributors with zero hours
            </label>
          </div>
        </CardContent>
      </Card>

      {/* KPI strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Total Payable</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">
              {kpis ? (
                <Val>{formatCurrency(kpis.total_payable)}</Val>
              ) : (
                <Skeleton className="h-7 w-24" />
              )}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              All cohort rows in this cycle
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Approved</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">
              {kpis ? (
                <Val>{formatCurrency(kpis.approved_total)}</Val>
              ) : (
                <Skeleton className="h-7 w-24" />
              )}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {kpis
                ? `${kpis.approved_count} approved · ${kpis.paid_count} paid · ${kpis.held_count} held · ${kpis.pending_count} pending`
                : "—"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Adjustments</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">
              {kpis ? (
                <Val>{formatCurrency(kpis.adjustments_total)}</Val>
              ) : (
                <Skeleton className="h-7 w-24" />
              )}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Reimbursements + corrections applied
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle>Contributors</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <PaymentsTable
            rows={rows}
            canEditStatus={canEdit}
            loading={cycleLoading}
            onRowClick={setDrillRow}
            onApprove={onApprove}
            onHold={onHold}
            onMarkPaid={onMarkPaid}
            onResetPending={onResetPending}
          />
        </CardContent>
      </Card>

      {/* Hold-reason modal */}
      <Modal
        isOpen={!!holdTarget}
        onClose={() => setHoldTarget(null)}
        title={holdTarget ? `Hold ${holdTarget.name}` : ""}
        footer={
          <>
            <Button variant="outline" onClick={() => setHoldTarget(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={onConfirmHold}>
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

      {/* Drill-in drawer */}
      <ContributorDetailDrawer
        row={drillRow}
        cycleStart={cycleStart}
        cycleEnd={cycleEnd}
        canEdit={canEdit}
        onClose={() => setDrillRow(null)}
        onChanged={reload}
      />
    </div>
  );
}
