"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import {
  Card,
  CardContent,
  Button,
  Badge,
  Modal,
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  Skeleton,
  Val,
} from "@/components/ui";
import { useToastActions } from "@/components/ui";
import {
  useCursorHistory,
  useRequestTimeAdjustment,
  useUpdateMyNotes,
  useUserProjects,
} from "@/hooks";
import { useFetchMyChangesetHeatmap } from "@/hooks/useApi";
import { ChangesetHeatmapCard } from "@/components/compounds/ChangesetHeatmapCard";
import { NotesButton } from "@/components/widgets/NotesButton";
import {
  formatDuration,
  resolveCategoryKey,
  CATEGORY_FILTER_LABELS,
} from "@/lib/timeTracking";
import { formatNumber } from "@/lib/utils";
import {
  localWeekStartIsoUtc,
  localWeekEndIsoUtc,
  localWeekStartAgoIsoUtc,
  localMonthStartIsoUtc,
  localMonthStartAgoIsoUtc,
  localDayEndIsoUtc,
} from "@/lib/timeTracking";
import { TimeTrackingWidget } from "@/components/widgets/TimeTrackingWidget";

// --- Date range presets ---

type DatePreset =
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "last_3_months"
  | "all_time";

const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  this_week: "This Week",
  last_week: "Last Week",
  this_month: "This Month",
  last_month: "Last Month",
  last_3_months: "Last 3 Months",
  all_time: "All Time",
};

function getDateRange(preset: DatePreset): {
  startDate: string | null;
  endDate: string | null;
} {
  switch (preset) {
    case "this_week":
      return {
        startDate: localWeekStartIsoUtc(),
        endDate: localWeekEndIsoUtc(),
      };
    case "last_week":
      return {
        startDate: localWeekStartAgoIsoUtc(1),
        endDate: localWeekStartIsoUtc(),
      };
    case "this_month":
      return {
        startDate: localMonthStartIsoUtc(),
        endDate: localDayEndIsoUtc(),
      };
    case "last_month":
      return {
        startDate: localMonthStartAgoIsoUtc(1),
        endDate: localMonthStartIsoUtc(),
      };
    case "last_3_months":
      return {
        startDate: localMonthStartAgoIsoUtc(3),
        endDate: localMonthStartIsoUtc(),
      };
    case "all_time":
      return { startDate: null, endDate: null };
  }
}

const CATEGORIES = CATEGORY_FILTER_LABELS;

function formatDateDisplay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function secondsToHours(seconds: number): number {
  return Math.round((seconds / 3600) * 10) / 10;
}

const PAGE_SIZE = 20;

export function UserDashboard() {
  const toast = useToastActions();
  const { data: projects } = useUserProjects();

  const [datePreset, setDatePreset] = useState<DatePreset>("this_month");
  const [category, setCategory] = useState<string>("All");
  const [page, setPage] = useState(0);
  const [adjustmentEntryId, setAdjustmentEntryId] = useState<number | null>(
    null,
  );
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [heatmapPoints, setHeatmapPoints] = useState<[number, number, number][]>([]);
  const [heatmapLoading, setHeatmapLoading] = useState(false);

  const history = useCursorHistory("/timetracking/my_history");
  const { mutate: fetchHeatmap } = useFetchMyChangesetHeatmap();
  const { mutate: requestAdjustment, loading: submitting } =
    useRequestTimeAdjustment();
  const { mutate: updateMyNotes } = useUpdateMyNotes();

  const handleSaveNotes = async (entryId: number, value: string | null) => {
    await updateMyNotes({ entry_id: entryId, userNotes: value });
    fetchWithFilters();
  };

  const fetchWithFilters = useCallback(async () => {
    const { startDate, endDate } = getDateRange(datePreset);
    const body: Record<string, unknown> = {};
    if (startDate) body.startDate = startDate;
    if (endDate) body.endDate = endDate;
    const categoryKey = resolveCategoryKey(category);
    if (categoryKey) body.category = categoryKey;
    await history.fetchPage(body);
  }, [datePreset, category, history.fetchPage]);

  useEffect(() => {
    fetchWithFilters();
  }, [fetchWithFilters]);

  useEffect(() => {
    const handler = () => {
      setTimeout(() => fetchWithFilters(), 500);
    };
    window.addEventListener("clock-state-changed", handler);
    return () => window.removeEventListener("clock-state-changed", handler);
  }, [fetchWithFilters]);

  useEffect(() => {
    setPage(0);
  }, [datePreset, category]);

  useEffect(() => {
    const { startDate, endDate } = getDateRange(datePreset);
    if (!startDate || !endDate) return;
    setHeatmapLoading(true);
    fetchHeatmap({ startDate, endDate })
      .then((res) => {
        if (res?.status === 200) setHeatmapPoints(res.heatmapPoints ?? []);
      })
      .finally(() => setHeatmapLoading(false));
  }, [datePreset]);

  const filteredEntries = useMemo(() => {
    let entries = history.entries;

    const { startDate, endDate } = getDateRange(datePreset);
    if (startDate) {
      const start = new Date(startDate);
      entries = entries.filter(
        (e) => e.clockIn && new Date(e.clockIn) >= start,
      );
    }
    if (endDate) {
      const end = new Date(endDate);
      entries = entries.filter((e) => e.clockIn && new Date(e.clockIn) < end);
    }

    const filterKey = resolveCategoryKey(category);
    if (filterKey) {
      entries = entries.filter(
        (e) => resolveCategoryKey(e.category) === filterKey,
      );
    }

    return entries;
  }, [history.entries, datePreset, category]);

  const stats = useMemo(() => {
    const totalSeconds = history.entries.reduce(
      (sum, e) => sum + (e.durationSeconds ?? 0),
      0,
    );

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisMonthSeconds = history.entries
      .filter((e) => e.clockIn && new Date(e.clockIn) >= monthStart)
      .reduce((sum, e) => sum + (e.durationSeconds ?? 0), 0);

    const pendingAdjustments = history.entries.filter((e) =>
      e.notes?.startsWith("[ADJUSTMENT REQUESTED]"),
    ).length;

    return {
      totalHours: secondsToHours(totalSeconds),
      thisMonthHours: secondsToHours(thisMonthSeconds),
      pendingAdjustments,
    };
  }, [history.entries]);

  const totalEntries = filteredEntries.length;
  const totalPages = Math.max(1, Math.ceil(totalEntries / PAGE_SIZE));
  const pagedEntries = filteredEntries.slice(
    page * PAGE_SIZE,
    (page + 1) * PAGE_SIZE,
  );
  const showingFrom = totalEntries === 0 ? 0 : page * PAGE_SIZE + 1;
  const showingTo = Math.min((page + 1) * PAGE_SIZE, totalEntries);

  const handleRequestAdjustment = async () => {
    if (!adjustmentEntryId || !adjustmentReason.trim()) return;

    try {
      await requestAdjustment({
        entry_id: adjustmentEntryId,
        reason: adjustmentReason.trim(),
      });
      toast.success("Adjustment request submitted. An admin will review it.");
      setAdjustmentEntryId(null);
      setAdjustmentReason("");
      fetchWithFilters();
    } catch {
      toast.error("Failed to submit adjustment request");
    }
  };

  if (history.loading && history.entries.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 md:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      {/* Clock Widget + Heatmap */}
      <div style={{ display: "flex", gap: 16, alignItems: "stretch" }}>
        <div style={{ flexShrink: 0, width: 320 }}>
          <TimeTrackingWidget
            projects={
              projects?.user_projects?.map(
                (p: {
                  id: number;
                  name: string;
                  short_name?: string;
                  last_worked_on?: string | null;
                }) => ({
                  id: p.id,
                  name: p.name,
                  short_name: p.short_name,
                  last_worked_on: p.last_worked_on ?? null,
                }),
              ) ?? []
            }
          />
        </div>
        <div style={{ flex: 1, minWidth: 0, display: "flex" }}>
          <ChangesetHeatmapCard
            heatmapPoints={heatmapPoints}
            heatmapLoading={heatmapLoading}
            className="flex-1"
          />
        </div>
      </div>

      {/* Stat Cards */}
      <div
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: "repeat(3, 1fr)",
        }}
      >
        <Card style={{ padding: 0 }}>
          <div style={{ padding: "12px 16px" }}>
            <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
              Hours
            </p>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#ff6b35" }}>
              {formatNumber(stats.totalHours).text}h
            </div>
            <p style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
              For {DATE_PRESET_LABELS[datePreset]}
            </p>
          </div>
        </Card>

        <Card style={{ padding: 0 }}>
          <div style={{ padding: "12px 16px" }}>
            <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
              This Month
            </p>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#2563eb" }}>
              {formatNumber(stats.thisMonthHours).text}h
            </div>
            <p style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
              {new Date().toLocaleDateString("en-US", {
                month: "long",
                year: "numeric",
              })}
            </p>
          </div>
        </Card>

        <Card style={{ padding: 0 }}>
          <div style={{ padding: "12px 16px" }}>
            <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
              Pending Adjustments
            </p>
            <div
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: stats.pendingAdjustments > 0 ? "#ca8a04" : "#16a34a",
              }}
            >
              <Val>{formatNumber(stats.pendingAdjustments)}</Val>
            </div>
            <p style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
              {stats.pendingAdjustments > 0
                ? "Awaiting review"
                : "No pending requests"}
            </p>
          </div>
        </Card>
      </div>

      {/* Filters */}
      <div
        style={{
          display: "flex",
          gap: 16,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label className="text-sm font-medium text-muted-foreground">
            Date Range:
          </label>
          <select
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            value={datePreset}
            onChange={(e) => setDatePreset(e.target.value as DatePreset)}
          >
            {Object.entries(DATE_PRESET_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label className="text-sm font-medium text-muted-foreground">
            Category:
          </label>
          <select
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* History Table */}
      <Card style={{ padding: 0 }}>
        <CardContent style={{ padding: 0 }}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Task</TableHead>
                <TableHead>Clock In</TableHead>
                <TableHead>Clock Out</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedEntries.map((entry) => {
                const isVoided = entry.status === "voided";
                const hasPendingAdjustment = entry.notes?.startsWith(
                  "[ADJUSTMENT REQUESTED]",
                );
                const canRequestAdjustment =
                  entry.status === "completed" && !hasPendingAdjustment;

                return (
                  <TableRow
                    key={entry.id}
                    className={isVoided ? "opacity-50" : ""}
                  >
                    <TableCell
                      className={`whitespace-nowrap ${isVoided ? "line-through" : ""}`}
                    >
                      {entry.clockIn ? formatDateDisplay(entry.clockIn) : "--"}
                    </TableCell>
                    <TableCell
                      className={`max-w-[120px] truncate ${isVoided ? "line-through" : ""}`}
                    >
                      <Val fallback="--">{entry.projectName}</Val>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        <Val fallback="--">{entry.category}</Val>
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[120px] truncate text-muted-foreground">
                      <Val>{entry.taskName}</Val>
                    </TableCell>
                    <TableCell
                      className={`whitespace-nowrap text-muted-foreground ${isVoided ? "line-through" : ""}`}
                    >
                      {entry.clockIn ? formatTime(entry.clockIn) : "--"}
                    </TableCell>
                    <TableCell
                      className={`whitespace-nowrap text-muted-foreground ${isVoided ? "line-through" : ""}`}
                    >
                      {entry.clockOut ? formatTime(entry.clockOut) : "--"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <span
                        className={`font-mono ${isVoided ? "line-through" : ""}`}
                      >
                        {formatDuration(entry.durationSeconds)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          entry.status === "completed"
                            ? "success"
                            : entry.status === "voided"
                              ? "destructive"
                              : "warning"
                        }
                      >
                        {entry.status}
                      </Badge>
                      {hasPendingAdjustment && (
                        <Badge variant="warning" className="ml-1">
                          adjustment pending
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <NotesButton
                        notes={entry.userNotes}
                        editable={!isVoided}
                        onSave={(v) => handleSaveNotes(entry.id, v)}
                        size="xs"
                      />
                    </TableCell>
                    <TableCell>
                      {canRequestAdjustment && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="whitespace-nowrap"
                          onClick={() => {
                            setAdjustmentEntryId(entry.id);
                            setAdjustmentReason("");
                          }}
                        >
                          Request Adjustment
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}

              {pagedEntries.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    style={{
                      textAlign: "center",
                      padding: "32px 16px",
                      color: "#6b7280",
                    }}
                  >
                    No time entries found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Adjustment Request Modal */}
      <Modal
        isOpen={adjustmentEntryId !== null}
        onClose={() => {
          setAdjustmentEntryId(null);
          setAdjustmentReason("");
        }}
        title={`Request Adjustment for Entry #${adjustmentEntryId}`}
        description="Describe what needs to be corrected. An admin will review and edit the entry."
        footer={
          <div className="flex gap-2 justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setAdjustmentEntryId(null);
                setAdjustmentReason("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleRequestAdjustment}
              disabled={!adjustmentReason.trim() || submitting}
              isLoading={submitting}
            >
              Submit Request
            </Button>
          </div>
        }
      >
        <textarea
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          rows={4}
          placeholder="e.g., Forgot to clock out -- actual end time was 5:30 PM"
          value={adjustmentReason}
          onChange={(e) => setAdjustmentReason(e.target.value)}
        />
      </Modal>

      {/* Pagination */}
      {totalEntries > 0 && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <p className="text-sm text-muted-foreground">
            Showing {formatNumber(showingFrom).text}-
            {formatNumber(showingTo).text} of {formatNumber(totalEntries).text}
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              isLoading={history.loadingMore}
              disabled={page >= totalPages - 1 && !history.nextCursor}
              onClick={async () => {
                if (page < totalPages - 1) {
                  setPage((p) => p + 1);
                } else if (history.nextCursor) {
                  await history.loadMore();
                  setPage((p) => p + 1);
                }
              }}
            >
              Next
            </Button>
          </div>
        </div>
      )}

    </div>
  );
}
