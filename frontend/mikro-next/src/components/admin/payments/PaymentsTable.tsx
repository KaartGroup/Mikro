"use client";

import { Button } from "@/components/ui";
import { formatNumber, formatCurrency } from "@/lib/utils";
import { Val } from "@/components/ui";
import type { PaymentCycleRow, PaymentCycleStatus } from "@/types";

interface PaymentsTableProps {
  rows: PaymentCycleRow[];
  canEditStatus: boolean;
  onRowClick?: (row: PaymentCycleRow) => void;
  onApprove?: (row: PaymentCycleRow) => void;
  onHold?: (row: PaymentCycleRow) => void;
  onMarkPaid?: (row: PaymentCycleRow) => void;
  onResetPending?: (row: PaymentCycleRow) => void;
  loading?: boolean;
}

const STATUS_LABEL: Record<PaymentCycleStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  held: "Held",
  paid: "Paid",
};

const STATUS_CLASSES: Record<PaymentCycleStatus, string> = {
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200",
  approved: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
  held: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  paid: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
};

export function PaymentsTable({
  rows,
  canEditStatus,
  onRowClick,
  onApprove,
  onHold,
  onMarkPaid,
  onResetPending,
  loading,
}: PaymentsTableProps) {
  if (loading) {
    return (
      <div className="p-8 text-center text-muted-foreground text-sm">
        Loading payroll cycle…
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground text-sm">
        No contributors with hours or adjustments in this cycle.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2">Contributor</th>
            <th className="px-3 py-2 text-right">Hours</th>
            <th className="px-3 py-2 text-right">Rate</th>
            <th className="px-3 py-2 text-right">Wage</th>
            <th className="px-3 py-2 text-right">Adjustments</th>
            <th className="px-3 py-2 text-right">Total</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.user_id}
              className="border-t border-border hover:bg-muted/30 cursor-pointer"
              onClick={() => onRowClick?.(row)}
            >
              <td className="px-3 py-2">
                <div className="font-medium text-foreground">{row.name}</div>
                <div className="text-xs text-muted-foreground">
                  {row.osm_username || row.email}
                </div>
                {row.status === "held" && row.status_note && (
                  <div className="mt-1 text-xs text-red-700 dark:text-red-300">
                    On hold: {row.status_note}
                  </div>
                )}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                <Val>{formatNumber(row.hours)}</Val>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {row.hourly_rate !== null ? (
                  <Val>{formatCurrency(row.hourly_rate)}</Val>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {row.calculated_wage !== null ? (
                  <Val>{formatCurrency(row.calculated_wage)}</Val>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                <Val>{formatCurrency(row.adjustments_total)}</Val>
                {row.adjustments_count > 0 && (
                  <span className="ml-1 text-xs text-muted-foreground">
                    ({row.adjustments_count})
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-right tabular-nums font-medium">
                <Val>{formatCurrency(row.total_payable)}</Val>
              </td>
              <td className="px-3 py-2">
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                    STATUS_CLASSES[row.status]
                  }`}
                >
                  {STATUS_LABEL[row.status]}
                </span>
              </td>
              <td
                className="px-3 py-2 text-right"
                onClick={(e) => e.stopPropagation()}
              >
                {canEditStatus && (
                  <div className="flex justify-end gap-1">
                    {row.status === "pending" && (
                      <>
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => onApprove?.(row)}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onHold?.(row)}
                        >
                          Hold
                        </Button>
                      </>
                    )}
                    {row.status === "approved" && (
                      <>
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => onMarkPaid?.(row)}
                        >
                          Mark Paid
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onResetPending?.(row)}
                        >
                          Undo
                        </Button>
                      </>
                    )}
                    {row.status === "held" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onResetPending?.(row)}
                      >
                        Release
                      </Button>
                    )}
                    {row.status === "paid" && (
                      <span className="text-xs text-muted-foreground">paid</span>
                    )}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
