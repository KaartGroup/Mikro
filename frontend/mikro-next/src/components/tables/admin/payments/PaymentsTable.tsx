"use client";

import { Button } from "@/components/ui";
import { formatNumber, formatCurrency } from "@/lib/utils";
import { Val } from "@/components/ui";
import type { PaymentCycleRow, PaymentCycleStatus } from "@/types";

// Toggleable columns (Contributor is always shown — it's the row
// identity). Single source of truth shared with the Columns menu so the
// menu can never drift from what the table actually renders.
export const PAYMENTS_TABLE_COLUMNS: { key: string; label: string }[] = [
  { key: "hours", label: "Hours" },
  { key: "rate", label: "Rate" },
  { key: "wage", label: "Wage" },
  { key: "reimbursements", label: "Reimbursements" },
  { key: "total", label: "Total" },
  { key: "status", label: "Status" },
  { key: "actions", label: "Actions" },
];

interface PaymentsTableProps {
  rows: PaymentCycleRow[];
  canEditStatus: boolean;
  onRowClick?: (row: PaymentCycleRow) => void;
  onApprove?: (row: PaymentCycleRow) => void;
  onHold?: (row: PaymentCycleRow) => void;
  onMarkPaid?: (row: PaymentCycleRow) => void;
  onResetPending?: (row: PaymentCycleRow) => void;
  /** Column keys to hide (from PAYMENTS_TABLE_COLUMNS). Empty = all shown. */
  hiddenColumns?: Set<string>;
  loading?: boolean;
}

// Deterministic avatar color from a name string
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

export function PaymentsTable({
  rows,
  canEditStatus,
  onRowClick,
  onApprove,
  onHold,
  onMarkPaid,
  onResetPending,
  hiddenColumns,
  loading,
}: PaymentsTableProps) {
  const show = (key: string) => !hiddenColumns?.has(key);
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
        No contributors with hours in this cycle.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2">Contributor</th>
            {show("hours") && <th className="px-3 py-2 text-right">Hours</th>}
            {show("rate") && <th className="px-3 py-2 text-right">Rate</th>}
            {show("wage") && <th className="px-3 py-2 text-right">Wage</th>}
            {show("reimbursements") && (
              <th className="px-3 py-2 text-right">Reimbursements</th>
            )}
            {show("total") && <th className="px-3 py-2 text-right">Total</th>}
            {show("status") && <th className="px-3 py-2">Status</th>}
            {show("actions") && (
              <th className="px-3 py-2 text-right">Actions</th>
            )}
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
                <div className="flex items-center gap-2.5">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold ${avatarColor(row.name || row.user_id)}`}
                  >
                    {initials(row.name || "??")}
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium text-foreground truncate">
                      {row.name}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {row.osm_username || row.email}
                    </div>
                    {row.status === "held" && row.status_note && (
                      <div className="mt-1 text-xs text-red-700 dark:text-red-300">
                        On hold: {row.status_note}
                      </div>
                    )}
                  </div>
                </div>
              </td>
              {show("hours") && (
                <td className="px-3 py-2 text-right tabular-nums">
                  <Val>{formatNumber(row.hours)}</Val>
                </td>
              )}
              {show("rate") && (
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.hourly_rate !== null ? (
                    <Val>{formatCurrency(row.hourly_rate)}</Val>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              )}
              {show("wage") && (
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.calculated_wage !== null ? (
                    <Val>{formatCurrency(row.calculated_wage)}</Val>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              )}
              {show("reimbursements") && (
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.reimbursements_count > 0 ? (
                    <>
                      <Val>{formatCurrency(row.reimbursements_total)}</Val>
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({row.reimbursements_count})
                      </span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              )}
              {show("total") && (
                <td className="px-3 py-2 text-right tabular-nums font-medium">
                  <Val>{formatCurrency(row.total_payable)}</Val>
                </td>
              )}
              {show("status") && (
                <td className="px-3 py-2">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      STATUS_CLASSES[row.status]
                    }`}
                  >
                    {STATUS_LABEL[row.status]}
                  </span>
                </td>
              )}
              {show("actions") && (
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
                        <span className="text-xs text-muted-foreground">
                          paid
                        </span>
                      )}
                    </div>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
