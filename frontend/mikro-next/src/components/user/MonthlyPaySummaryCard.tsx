"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { useMyMonthlySummary } from "@/hooks";
import { formatCurrency, formatNumber } from "@/lib/utils";
import type { MyMonthlySummaryResponse } from "@/types";

/**
 * F13 — monthly payment + hours summary for the logged-in user.
 * Self-scoped backend endpoint aggregates hours, tasks, and earnings
 * for the picked month (anchored to the USER's local calendar, not UTC
 * — see the TZ-correctness commit). One round-trip.
 */

const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

function buildMonthOptions(
  monthsBack = 12,
): { value: string; label: string; year: number; month: number }[] {
  const now = new Date();
  const options: {
    value: string;
    label: string;
    year: number;
    month: number;
  }[] = [];
  for (let i = 0; i < monthsBack; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = d.getFullYear();
    const month = d.getMonth(); // 0-indexed
    options.push({
      value: `${year}-${month}`,
      label: `${MONTH_LABELS[month]} ${year}`,
      year,
      month,
    });
  }
  return options;
}

/** Local month-start and month-end as ISO UTC instants — matches the
 *  helpers in lib/timeTracking.ts but scoped to a picked (year, month)
 *  rather than "now". */
function monthBoundsIsoUtc(
  year: number,
  month: number,
): { start: string; end: string } {
  return {
    start: new Date(year, month, 1).toISOString(),
    end: new Date(year, month + 1, 1).toISOString(),
  };
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <div className="text-xl font-bold">{value}</div>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

export function MonthlyPaySummaryCard() {
  const options = useMemo(() => buildMonthOptions(12), []);
  const [selected, setSelected] = useState(options[0].value);
  const [summary, setSummary] = useState<MyMonthlySummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const { mutate: fetchSummary } = useMyMonthlySummary();

  const selectedOption =
    options.find((o) => o.value === selected) || options[0];

  const load = useCallback(async () => {
    const { year, month } = selectedOption;
    const { start, end } = monthBoundsIsoUtc(year, month);
    setLoading(true);
    try {
      const result = await fetchSummary({ startDate: start, endDate: end });
      setSummary(result);
    } catch {
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [selectedOption, fetchSummary]);

  useEffect(() => {
    load();
  }, [load]);

  const owedSubtitle = summary
    ? summary.pay_mode === "hourly"
      ? `${formatNumber(summary.total_hours).text}h × ${formatCurrency(summary.hourly_rate ?? 0).text}/hr`
      : summary.pay_mode === "per_task"
        ? "From per-task rates"
        : "No rate configured"
    : undefined;

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-base">This Month</CardTitle>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          aria-label="Select month"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </CardHeader>
      <CardContent>
        {loading && !summary ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : summary ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat
              label="Hours"
              value={`${formatNumber(summary.total_hours).text}h`}
            />
            <Stat
              label="Tasks Mapped"
              value={formatNumber(summary.tasks_mapped).text}
            />
            <Stat
              label="Tasks Validated"
              value={formatNumber(summary.tasks_validated).text}
            />
            <Stat
              label="Amount Owed"
              value={
                <span className="text-kaart-orange">
                  {formatCurrency(summary.amount_owed).text}
                </span>
              }
              sub={owedSubtitle}
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Couldn&apos;t load this month&apos;s summary.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
