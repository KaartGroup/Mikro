"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import {
  Card,
  CardContent,
  Button,
  Badge,
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  Skeleton,
  Val,
} from "@/components/ui";
import {
  useCursorHistory,
  useUpdateMyNotes,
  useMyReimbursementRequests,
} from "@/hooks";
import { ReimbursementSubmitModal } from "@/components/modals/reimbursement/RequestReimbursementModal";
import { AdjustmentRequestModal } from "@/components/modals/AdjustmentRequestModal";
import { useFetchMyChangesetHeatmap, useActiveTimeSession } from "@/hooks/useApi";
import { ChangesetHeatmapCard } from "@/components/compounds/ChangesetHeatmapCard";
import { NotesButton } from "@/components/widgets/NotesButton";
import {
  formatDuration,
  resolveCategoryKey,
  CATEGORY_FILTER_LABELS,
  localWeekStartIsoUtc,
  localWeekEndIsoUtc,
  localWeekStartAgoIsoUtc,
  localMonthStartIsoUtc,
  localMonthStartAgoIsoUtc,
  localDayEndIsoUtc,
} from "@/lib/timeTracking";
import { formatNumber, formatDate, formatTime } from "@/lib/utils";
import { TimeTrackingWidget } from "@/components/widgets/TimeTrackingWidget";
import { CreateEventProposalModal } from "@/components/modals/event/CreateEventProposalModal";

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
      return { startDate: localWeekStartIsoUtc(), endDate: localWeekEndIsoUtc() };
    case "last_week":
      return { startDate: localWeekStartAgoIsoUtc(1), endDate: localWeekStartIsoUtc() };
    case "this_month":
      return { startDate: localMonthStartIsoUtc(), endDate: localDayEndIsoUtc() };
    case "last_month":
      return { startDate: localMonthStartAgoIsoUtc(1), endDate: localMonthStartIsoUtc() };
    case "last_3_months":
      return { startDate: localMonthStartAgoIsoUtc(3), endDate: localMonthStartIsoUtc() };
    case "all_time":
      return { startDate: null, endDate: null };
  }
}

const PAGE_SIZE = 20;


export function UserDashboard() {
  const [datePreset, setDatePreset] = useState<DatePreset>("this_month");
  const [category, setCategory] = useState<string>("All");
  const [page, setPage] = useState(0);
  const [adjustmentEntryId, setAdjustmentEntryId] = useState<number | null>(null);
  const [heatmapPoints, setHeatmapPoints] = useState<[number, number, number][]>([]);
  const [heatmapLoading, setHeatmapLoading] = useState(false);
  const [showReimbursementModal, setShowReimbursementModal] = useState(false);
  const [pendingReimbursements, setPendingReimbursements] = useState(0);

  const history = useCursorHistory("/timetracking/my_history");
  const { data: activeSessionData, refetch: refetchActiveSession } = useActiveTimeSession();
  const [tick, setTick] = useState(0);
  const { mutate: fetchHeatmap } = useFetchMyChangesetHeatmap();
  const { mutate: updateMyNotes } = useUpdateMyNotes();
  const { mutate: fetchMyReimbursements } = useMyReimbursementRequests();

  const refreshReimbursements = useCallback(async () => {
    const res = await fetchMyReimbursements({});
    const pending = (res?.requests ?? []).filter((r) => r.status === "pending").length;
    setPendingReimbursements(pending);
  }, [fetchMyReimbursements]);

  useEffect(() => {
    refreshReimbursements();
  }, [refreshReimbursements]);

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
      setTimeout(() => {
        fetchWithFilters();
        refetchActiveSession();
      }, 500);
    };
    window.addEventListener("clock-state-changed", handler);
    window.addEventListener("time-entry-updated", handler);
    return () => {
      window.removeEventListener("clock-state-changed", handler);
      window.removeEventListener("time-entry-updated", handler);
    };
  }, [fetchWithFilters, refetchActiveSession]);

  // Tick every 30 s so the running-clock contribution to total hours stays live.
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(interval);
  }, []);

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
      entries = entries.filter((e) => e.clockIn && new Date(e.clockIn) >= start);
    }
    if (endDate) {
      const end = new Date(endDate);
      entries = entries.filter((e) => e.clockIn && new Date(e.clockIn) < end);
    }

    const filterKey = resolveCategoryKey(category);
    if (filterKey) {
      entries = entries.filter((e) => resolveCategoryKey(e.category) === filterKey);
    }

    return entries;
  }, [history.entries, datePreset, category]);

  // Add elapsed time from any active (in-progress) session on top of the
  // server-computed completed-entries total. tick forces re-evaluation every 30 s.
  const activeClockIn = activeSessionData?.session?.clockIn;
  const { startDate, endDate } = getDateRange(datePreset);
  const activeInRange =
    activeClockIn != null &&
    (!startDate || new Date(activeClockIn) >= new Date(startDate)) &&
    (!endDate || new Date(activeClockIn) < new Date(endDate));
  const activeElapsedHours =
    activeInRange && activeClockIn
      ? Math.max(0, (Date.now() - new Date(activeClockIn).getTime()) / 3_600_000)
      : 0;
  void tick; // consumed to trigger re-render on 30-s interval

  const stats = {
    totalHours:
      Math.round(((history.stats?.totalHours ?? 0) + activeElapsedHours) * 10) / 10,
    pendingAdjustments: history.stats?.pendingAdjustments ?? 0,
  };

  const totalEntries = filteredEntries.length;
  const totalPages = Math.max(1, Math.ceil(totalEntries / PAGE_SIZE));
  const pagedEntries = filteredEntries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const showingFrom = totalEntries === 0 ? 0 : page * PAGE_SIZE + 1;
  const showingTo = Math.min((page + 1) * PAGE_SIZE, totalEntries);

  const closeAdjustmentModal = () => {
    setAdjustmentEntryId(null);
  };

  const [showCreateEventProposalModal, setShowCreateEventProposalModal] = useState(false);



  if (history.loading && history.entries.length === 0) {
    return (
      <div className="flex flex-col gap-8">
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
    <div className="flex flex-col gap-8">
      {/* Clock Widget + Heatmap */}
      <div className="flex gap-4 items-stretch">
        <div className="shrink-0 w-80">
          <TimeTrackingWidget />
        </div>
        <div className="flex flex-1 min-w-0">
          <ChangesetHeatmapCard
            heatmapPoints={heatmapPoints}
            heatmapLoading={heatmapLoading}
            className="flex-1"
          />
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid gap-4 grid-cols-3">
        <Card className="p-0">
          <div className="px-4 py-3">
            <p className="text-xs text-muted-foreground mb-1">Hours</p>
            <div className="text-xl font-bold text-[#ff6b35]">
              {formatNumber(stats.totalHours).text}h
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              For {DATE_PRESET_LABELS[datePreset]}
            </p>
          </div>
        </Card>

        <Card className="p-0">
          <div className="px-4 py-3">
            <p className="text-xs text-muted-foreground mb-1">Pending Reimbursements</p>
            <div
              className={`text-xl font-bold ${pendingReimbursements > 0 ? "text-yellow-600" : "text-green-600"}`}
            >
              {formatNumber(pendingReimbursements).text}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {pendingReimbursements > 0 ? "Awaiting review" : "None pending"}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setShowReimbursementModal(true)}
            >
              Request Reimbursement
            </Button>
          </div>
            <div className="px-4 pb-3">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setShowCreateEventProposalModal(true)}
            >
              Propose Event
            </Button>
          </div>
        </Card>

        <Card className="p-0">
          <div className="px-4 py-3">
            <p className="text-xs text-muted-foreground mb-1">Pending Adjustments</p>
            <div
              className={`text-xl font-bold ${stats.pendingAdjustments > 0 ? "text-yellow-600" : "text-green-600"}`}
            >
              <Val>{formatNumber(stats.pendingAdjustments)}</Val>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {stats.pendingAdjustments > 0 ? "Awaiting review" : "No pending requests"}
            </p>
          </div>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex gap-4 items-center flex-wrap">
        <div className="flex items-center gap-2">
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

        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-muted-foreground">
            Category:
          </label>
          <select
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {CATEGORY_FILTER_LABELS.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* History Table */}
      <Card className="p-0">
        <CardContent className="p-0">
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
                  <TableRow key={entry.id} className={isVoided ? "opacity-50" : ""}>
                    <TableCell
                      className={`whitespace-nowrap ${isVoided ? "line-through" : ""}`}
                    >
                      {entry.clockIn ? formatDate(entry.clockIn) : "--"}
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
                      <span className={`font-mono ${isVoided ? "line-through" : ""}`}>
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
                          onClick={() => setAdjustmentEntryId(entry.id)}
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
                    colSpan={10}
                    className="text-center py-8 px-4 text-muted-foreground"
                  >
                    No time entries found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalEntries > 0 && (
        <div className="flex justify-between items-center">
          <p className="text-sm text-muted-foreground">
            Showing {formatNumber(showingFrom).text}-{formatNumber(showingTo).text} of{" "}
            {formatNumber(totalEntries).text}
          </p>
          <div className="flex gap-2">
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

      {/* Adjustment Request Modal */}
      <AdjustmentRequestModal
        isOpen={adjustmentEntryId !== null}
        entryId={adjustmentEntryId}
        onClose={closeAdjustmentModal}
        onSubmitted={fetchWithFilters}
      />

      {/* Reimbursement Submit Modal */}
      <ReimbursementSubmitModal
        isOpen={showReimbursementModal}
        onClose={() => setShowReimbursementModal(false)}
        onSubmitted={() => {
          setShowReimbursementModal(false);
          refreshReimbursements();
        }}
      />

      <CreateEventProposalModal
        isOpen={showCreateEventProposalModal}
        onClose={() => setShowCreateEventProposalModal(false)}
        onSubmitted={() => {
          setShowCreateEventProposalModal(false);
        }}
      />
    </div>
  );
}
