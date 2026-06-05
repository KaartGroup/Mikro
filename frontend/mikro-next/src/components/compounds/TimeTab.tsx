"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, StatCard, Button } from "@/components/ui";
import { TimeEntryStatusBadge } from "@/components/atoms/TimeEntryStatusBadge";
import { TablePaginator } from "@/components/molecules/TablePaginator";
import {
  formatDuration,
  localDayEndIsoUtc,
  localWeekStartIsoUtc,
  localMonthStartIsoUtc,
} from "@/lib/timeTracking";
import type { TimeEntry } from "@/types";

const PAGE_SIZE = 10;

interface TimeTabProps {
  loading: boolean;
  entries: TimeEntry[];
}

export function TimeTab({ loading, entries }: TimeTabProps) {
  const [page, setPage] = useState(1);

  const computed = useMemo(() => {
    const completed = entries.filter(
      (e) => e.status === "completed" && (e.durationSeconds ?? 0) > 0,
    );
    const totalSeconds = completed.reduce(
      (s, e) => s + (e.durationSeconds ?? 0),
      0,
    );
    const avgSessionSeconds = completed.length
      ? Math.round(totalSeconds / completed.length)
      : 0;

    const weekStartIso = localWeekStartIsoUtc();
    const monthStartIso = localMonthStartIsoUtc();
    const dayEndIso = localDayEndIsoUtc();

    const inWindow = (clockIn: string | null, start: string, end: string) => {
      if (!clockIn) return false;
      return clockIn >= start && clockIn < end;
    };

    const hoursThisWeek = completed
      .filter((e) => inWindow(e.clockIn, weekStartIso, dayEndIso))
      .reduce((s, e) => s + (e.durationSeconds ?? 0), 0);
    const hoursThisMonth = completed
      .filter((e) => inWindow(e.clockIn, monthStartIso, dayEndIso))
      .reduce((s, e) => s + (e.durationSeconds ?? 0), 0);

    const TWELVE_HOURS = 12 * 3600;
    const nowMs = Date.now();
    const anomalies: { entry: TimeEntry; reason: string }[] = [];
    for (const e of entries) {
      if (e.status === "active" && e.clockIn) {
        const elapsedSec = Math.floor(
          (nowMs - new Date(e.clockIn).getTime()) / 1000,
        );
        if (elapsedSec > TWELVE_HOURS) {
          anomalies.push({
            entry: e,
            reason: `Active session running ${formatDuration(elapsedSec)} — likely forgot to clock out`,
          });
        }
      } else if (
        e.status === "completed" &&
        (e.durationSeconds ?? 0) > TWELVE_HOURS
      ) {
        anomalies.push({
          entry: e,
          reason: `Completed session of ${formatDuration(e.durationSeconds ?? 0)} — unusually long`,
        });
      }
    }

    const recent = [...entries].sort((a, b) => {
      const ai = a.clockIn ?? "";
      const bi = b.clockIn ?? "";
      return ai < bi ? 1 : ai > bi ? -1 : 0;
    });

    return {
      hoursThisWeek,
      hoursThisMonth,
      avgSessionSeconds,
      avgSessionDenom: completed.length,
      anomalies,
      recent,
    };
  }, [entries]);

  const totalPages = Math.max(1, Math.ceil(computed.recent.length / PAGE_SIZE));
  const pagedRecent = computed.recent.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE,
  );

  if (loading && entries.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-kaart-orange" />
        Loading time data…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          label="Hours This Week"
          value={formatDuration(computed.hoursThisWeek)}
        />
        <StatCard
          label="Hours This Month"
          value={formatDuration(computed.hoursThisMonth)}
        />
        <StatCard
          label="Average Session"
          value={
            computed.avgSessionDenom > 0
              ? formatDuration(computed.avgSessionSeconds)
              : "—"
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Anomalies
            {computed.anomalies.length > 0 && (
              <span className="ml-2 inline-flex items-center justify-center min-w-[1.5rem] px-1.5 rounded-full text-xs bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                {computed.anomalies.length}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {computed.anomalies.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              No anomalies detected in the last 90 days.
            </p>
          ) : (
            <ul className="space-y-2">
              {computed.anomalies.map(({ entry, reason }) => (
                <li
                  key={entry.id}
                  className="flex items-start gap-3 rounded-md border border-border bg-muted/40 p-3 text-sm"
                >
                  <span className="mt-0.5 inline-flex h-2 w-2 rounded-full bg-red-600 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{reason}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {entry.projectName || "—"}
                      {entry.clockIn
                        ? ` · clocked in ${new Date(entry.clockIn).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}`
                        : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Entries</CardTitle>
        </CardHeader>
        <CardContent>
          {computed.recent.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              No time entries in the last 90 days.
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
                        Project
                      </th>
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground">
                        Category
                      </th>
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground">
                        Duration
                      </th>
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {pagedRecent.map((entry) => (
                      <tr
                        key={entry.id}
                        className={
                          entry.status === "voided" ? "opacity-50" : ""
                        }
                      >
                        <td className="px-3 py-2 whitespace-nowrap">
                          {entry.clockIn
                            ? new Date(entry.clockIn).toLocaleDateString(
                                "en-US",
                                {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                },
                              )
                            : "—"}
                        </td>
                        <td className="px-3 py-2">
                          {entry.projectName || "—"}
                        </td>
                        <td className="px-3 py-2">{entry.category || "—"}</td>
                        <td className="px-3 py-2 font-mono whitespace-nowrap">
                          {formatDuration(entry.durationSeconds)}
                        </td>
                        <td className="px-3 py-2">
                          <TimeEntryStatusBadge
                            status={
                              entry.status as "completed" | "active" | "voided"
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {computed.recent.length > PAGE_SIZE && (
                <TablePaginator
                  page={page}
                  totalItems={computed.recent.length}
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
