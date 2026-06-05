"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, StatCard, Val } from "@/components/ui";
import { TablePaginator } from "@/components/molecules/TablePaginator";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { UserPaymentSummaryResponse } from "@/types";

const PAGE_SIZE = 10;

type PaymentSummary = UserPaymentSummaryResponse["summary"];

interface PaymentTabProps {
  paymentSummary: PaymentSummary | null;
  loading: boolean;
}

export function PaymentTab({ paymentSummary, loading }: PaymentTabProps) {
  const [page, setPage] = useState(1);

  if (loading && !paymentSummary) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-kaart-orange" />
        Loading payment data…
      </div>
    );
  }

  if (!paymentSummary) {
    return (
      <p className="text-sm text-muted-foreground italic py-8">
        Payment data unavailable.
      </p>
    );
  }

  const totalPages = Math.max(
    1,
    Math.ceil(paymentSummary.recent_payments.length / PAGE_SIZE),
  );
  const safePage = Math.min(page, totalPages);
  const pagedPayments = paymentSummary.recent_payments.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          label="Lifetime Paid"
          value={formatCurrency(paymentSummary.lifetime_paid)}
        />
        <StatCard
          label="Pending Balance"
          value={formatCurrency(paymentSummary.pending_balance)}
        />
        <StatCard
          label="Open Requests"
          value={formatCurrency(paymentSummary.open_request_total)}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pay Rate &amp; Last Payment</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Hourly Rate</p>
              <p className="font-medium mt-1">
                {paymentSummary.hourly_rate != null ? (
                  <>
                    <Val>{formatCurrency(paymentSummary.hourly_rate)}</Val>/hr
                  </>
                ) : (
                  <span className="text-muted-foreground italic">
                    Per-task (varies by project)
                  </span>
                )}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Last Payment</p>
              {paymentSummary.last_payment ? (
                <p className="font-medium mt-1">
                  <Val>
                    {formatCurrency(paymentSummary.last_payment.amount)}
                  </Val>
                  <span className="text-muted-foreground">
                    {" "}
                    · {formatDate(paymentSummary.last_payment.date)}
                  </span>
                  {paymentSummary.last_payment.payment_email && (
                    <span className="text-xs text-muted-foreground block mt-0.5">
                      {paymentSummary.last_payment.payment_email}
                    </span>
                  )}
                </p>
              ) : (
                <p className="text-muted-foreground italic mt-1">
                  No payments yet
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Anomalies — Unpaid &gt; 30 days
            {paymentSummary.anomalies.unpaid_over_30d_count > 0 && (
              <span className="ml-2 inline-flex items-center justify-center min-w-[1.5rem] px-1.5 rounded-full text-xs bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                {paymentSummary.anomalies.unpaid_over_30d_count}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {paymentSummary.anomalies.unpaid_over_30d_count === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              No validated tasks older than 30 days are awaiting payment.
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground mb-3">
                Total unpaid:{" "}
                <Val>
                  {formatCurrency(
                    paymentSummary.anomalies.unpaid_over_30d_amount,
                  )}
                </Val>
                {paymentSummary.anomalies.tasks.length <
                  paymentSummary.anomalies.unpaid_over_30d_count && (
                  <span className="ml-2 text-xs">
                    (showing first {paymentSummary.anomalies.tasks.length} of{" "}
                    {paymentSummary.anomalies.unpaid_over_30d_count})
                  </span>
                )}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" style={{ minWidth: 500 }}>
                  <thead className="bg-muted border-b border-border">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground">
                        Task
                      </th>
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground">
                        Project
                      </th>
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground">
                        Type
                      </th>
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground">
                        Validated
                      </th>
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground">
                        Rate
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {paymentSummary.anomalies.tasks.map((a) => (
                      <tr key={`${a.task_id}-${a.type}`}>
                        <td className="px-3 py-2 font-mono">#{a.task_id}</td>
                        <td className="px-3 py-2">{a.project}</td>
                        <td className="px-3 py-2 capitalize">{a.type}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {formatDate(a.date_validated)}
                        </td>
                        <td className="px-3 py-2">
                          <Val>{formatCurrency(a.rate)}</Val>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Open Pay Requests
            {paymentSummary.open_requests.length > 0 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({paymentSummary.open_requests.length})
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {paymentSummary.open_requests.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              No open pay requests.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: 500 }}>
                <thead className="bg-muted border-b border-border">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground">
                      Date
                    </th>
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground">
                      Amount
                    </th>
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground">
                      Tasks
                    </th>
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground">
                      Notes
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {paymentSummary.open_requests.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {formatDate(r.date_requested)}
                      </td>
                      <td className="px-3 py-2">
                        <Val>{formatCurrency(r.amount_requested)}</Val>
                      </td>
                      <td className="px-3 py-2">{r.task_count}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {r.notes || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Payments</CardTitle>
        </CardHeader>
        <CardContent>
          {paymentSummary.recent_payments.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              No payments yet.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" style={{ minWidth: 500 }}>
                  <thead className="bg-muted border-b border-border">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground">
                        Date
                      </th>
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground">
                        Amount
                      </th>
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground">
                        Projects
                      </th>
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground">
                        Tasks
                      </th>
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground">
                        Notes
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {pagedPayments.map((p) => (
                      <tr key={p.id}>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {formatDate(p.date)}
                        </td>
                        <td className="px-3 py-2">
                          <Val>{formatCurrency(p.amount)}</Val>
                        </td>
                        <td className="px-3 py-2">
                          {p.projects.length > 0 ? p.projects.join(", ") : "—"}
                        </td>
                        <td className="px-3 py-2">{p.task_count}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {p.notes || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {paymentSummary.recent_payments.length > PAGE_SIZE && (
                <TablePaginator
                  page={safePage}
                  totalItems={paymentSummary.recent_payments.length}
                  pageSize={PAGE_SIZE}
                  onPrev={() => setPage((p) => p - 1)}
                  onNext={() => setPage((p) => p + 1)}
                />
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
