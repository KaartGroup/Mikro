"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, Val } from "@/components/ui";
import { KpiCard } from "@/components/ui/KpiCard";
import {
  useFetchEditingStats,
  useFetchMrStats,
  useFetchTimekeepingStats,
  useFetchFilterOptions,
  useFetchChangesetHeatmap,
  useFetchElementAnalysis,
  useQueueElementAnalysis,
  useCheckElementAnalysisStatus,
  useQueueElementAnalysisBackfill,
  useCheckElementAnalysisBackfillStatus,
} from "@/hooks/useApi";
import { useFilters, useCurrentUserRole, useManagedTeams } from "@/hooks";
import { TeamAdminEmptyState } from "@/components/admin/TeamAdminEmptyState";
import {
  dateInputToLocalStartIsoUtc,
  dateInputToLocalEndIsoUtc,
} from "@/lib/timeTracking";
import { FilterBar } from "@/components/filters";
import type {
  EditingStatsResponse,
  TimekeepingStatsResponse,
  ElementAnalysisCategory,
} from "@/types";
import { formatNumber } from "@/lib/utils";
import TrendOverview from "./_components/TrendOverview";
import { LoadingSpinner } from "./_components/LoadingSpinner";
import { ChangesetHeatmapCard } from "../../compounds/ChangesetHeatmapCard";
import { ElementActivitySection } from "./_components/ElementActivitySection";
import { TeamActivityCard } from "./_components/TeamActivityCard";
import { TaskHoursByCategoryCard } from "./_components/TaskHoursByCategoryCard";
import { CommunityOutreachCard } from "./_components/CommunityOutreachCard";
import { ExportDropdown } from "./_components/ExportDropdown";
import { ProjectSnapshotTable } from "@/components/tables/reports/ProjectSnapshotTable";
import {
  sortProjectsAlphabetical,
  projectDisplayName,
} from "@/lib/sortProjects";
import { dynamicRoutes } from "@/lib/routes";

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function prevWeekRange() {
  const today = new Date();
  const dow = today.getDay(); // 0=Sun ... 6=Sat
  const daysToLastSat = dow === 6 ? 7 : dow + 1;
  const lastSat = new Date(today);
  lastSat.setDate(today.getDate() - daysToLastSat);
  const prevSun = new Date(lastSat);
  prevSun.setDate(lastSat.getDate() - 6);
  return { start: localDateStr(prevSun), end: localDateStr(lastSat) };
}

function twoWeeksAgoRange() {
  const today = new Date();
  const dow = today.getDay();
  const daysToLastSat = dow === 6 ? 7 : dow + 1;
  const lastSat = new Date(today);
  lastSat.setDate(today.getDate() - daysToLastSat);
  const end = new Date(lastSat);
  end.setDate(lastSat.getDate() - 7);
  const start = new Date(end);
  start.setDate(end.getDate() - 6);
  return { start: localDateStr(start), end: localDateStr(end) };
}

export function AdminReports() {
  const { role: viewerRole } = useCurrentUserRole();
  const { teams: managedTeams, loading: managedTeamsLoading } =
    useManagedTeams();
  const isTeamAdmin = viewerRole === "team_admin";

  // ── Shared UI state ──────────────────────────────────────────
  // Committed dates drive fetches; draft dates are edited in inputs and applied on button click.
  const [customStart, setCustomStart] = useState(() => prevWeekRange().start);
  const [customEnd, setCustomEnd] = useState(() => prevWeekRange().end);
  const [compareEnabled, setCompareEnabled] = useState(true);
  const [compareStart, setCompareStart] = useState(
    () => twoWeeksAgoRange().start,
  );
  const [compareEnd, setCompareEnd] = useState(() => twoWeeksAgoRange().end);

  const [draftStart, setDraftStart] = useState(customStart);
  const [draftEnd, setDraftEnd] = useState(customEnd);
  const [draftCompareStart, setDraftCompareStart] = useState(compareStart);
  const [draftCompareEnd, setDraftCompareEnd] = useState(compareEnd);
  const [timekeepingGranularity, setTimekeepingGranularity] = useState<
    "weekly" | "daily"
  >("weekly");

  // ── Tab data state ───────────────────────────────────────────
  const [editingData, setEditingData] = useState<EditingStatsResponse | null>(
    null,
  );
  const [timekeepingData, setTimekeepingData] =
    useState<TimekeepingStatsResponse | null>(null);

  // ── Heatmap state ────────────────────────────────────────────
  const [heatmapPoints, setHeatmapPoints] = useState<
    [number, number, number][]
  >([]);
  const [heatmapLoading, setHeatmapLoading] = useState(false);

  // ── Element analysis state ───────────────────────────────────
  const [elementCategories, setElementCategories] = useState<
    ElementAnalysisCategory[]
  >([]);
  const [elementLastUpdated, setElementLastUpdated] = useState<string | null>(
    null,
  );
  const [elementLoading, setElementLoading] = useState(false);
  const [elementRefreshing, setElementRefreshing] = useState(false);
  const [elementProgress, setElementProgress] = useState<string | null>(null);
  const [showRefreshModal, setShowRefreshModal] = useState(false);
  const [showBackfillModal, setShowBackfillModal] = useState(false);
  const elementPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reportContentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      if (elementPollRef.current) clearInterval(elementPollRef.current);
    };
  }, []);

  // ── Hooks ────────────────────────────────────────────────────
  const {
    mutate: fetchEditing,
    loading: editingLoading,
    error: editingError,
  } = useFetchEditingStats();
  const { mutate: fetchMr } = useFetchMrStats();
  const { mutate: fetchTimekeeping, loading: timekeepingLoading } =
    useFetchTimekeepingStats();
  const { activeFilters, setActiveFilters, filtersBody } = useFilters();
  const { data: filterOptions, loading: filterOptionsLoading } =
    useFetchFilterOptions();
  const { mutate: fetchHeatmap } = useFetchChangesetHeatmap();
  const { mutate: fetchElementAnalysis } = useFetchElementAnalysis();
  const { mutate: queueElementAnalysis } = useQueueElementAnalysis();
  const { mutate: checkElementAnalysisStatus } =
    useCheckElementAnalysisStatus();
  const { mutate: queueElementAnalysisBackfill } =
    useQueueElementAnalysisBackfill();
  const { mutate: checkElementAnalysisBackfillStatus } =
    useCheckElementAnalysisBackfillStatus();
  // ── Data fetching ────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!customStart || !customEnd) return;

    const startIso = dateInputToLocalStartIsoUtc(customStart);
    const endIso = dateInputToLocalEndIsoUtc(customEnd);

    const params: Record<string, unknown> = {
      startDate: startIso,
      endDate: endIso,
      filters: filtersBody,
    };

    if (compareEnabled && compareStart && compareEnd) {
      params.compareStartDate = dateInputToLocalStartIsoUtc(compareStart);
      params.compareEndDate = dateInputToLocalEndIsoUtc(compareEnd);
    }

    setHeatmapLoading(true);
    setElementLoading(true);

    await Promise.allSettled([
      fetchEditing(params).then((res) => {
        if (res?.status === 200) setEditingData(res);
      }),
      fetchTimekeeping(params).then((res) => {
        if (res?.status === 200) setTimekeepingData(res);
      }),
      fetchMr(params),
      fetchHeatmap(params)
        .then((res) => {
          if (res?.status === 200) {
            console.log(res);
            setHeatmapPoints(res.heatmapPoints || []);
          }
        })
        .finally(() => setHeatmapLoading(false)),
      fetchElementAnalysis({ startDate: startIso, endDate: endIso })
        .then((res) => {
          if (res?.status === 200) {
            setElementCategories(res.categories || []);
            setElementLastUpdated(res.lastUpdated);
          }
        })
        .finally(() => setElementLoading(false)),
    ]);
  }, [
    customStart,
    customEnd,
    filtersBody,
    compareEnabled,
    compareStart,
    compareEnd,
    fetchEditing,
    fetchMr,
    fetchTimekeeping,
    fetchHeatmap,
    fetchElementAnalysis,
  ]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Element analysis refresh ─────────────────────────────────
  const handleStartAnalysis = useCallback(async () => {
    setShowRefreshModal(false);
    setElementRefreshing(true);
    setElementProgress("Queuing analysis...");
    try {
      const queueRes = await queueElementAnalysis({});
      if (queueRes?.status === 200 && queueRes.job_id) {
        if (elementPollRef.current) clearInterval(elementPollRef.current);
        elementPollRef.current = setInterval(async () => {
          try {
            const statusRes = await checkElementAnalysisStatus({});
            if (statusRes?.status === 200) {
              setElementProgress(statusRes.progress || "Processing...");
              if (statusRes.sync_status === "completed") {
                if (elementPollRef.current)
                  clearInterval(elementPollRef.current);
                elementPollRef.current = null;
                setElementRefreshing(false);
                setElementProgress(null);
                const elRes = await fetchElementAnalysis({
                  startDate: dateInputToLocalStartIsoUtc(customStart),
                  endDate: dateInputToLocalEndIsoUtc(customEnd),
                });
                if (elRes?.status === 200) {
                  setElementCategories(elRes.categories || []);
                  setElementLastUpdated(elRes.lastUpdated);
                }
              } else if (statusRes.sync_status === "failed") {
                if (elementPollRef.current)
                  clearInterval(elementPollRef.current);
                elementPollRef.current = null;
                setElementRefreshing(false);
                setElementProgress(null);
              }
            }
          } catch {
            if (elementPollRef.current) clearInterval(elementPollRef.current);
            elementPollRef.current = null;
            setElementRefreshing(false);
            setElementProgress(null);
          }
        }, 5000);
      }
    } catch {
      setElementRefreshing(false);
      setElementProgress(null);
    }
  }, [
    queueElementAnalysis,
    checkElementAnalysisStatus,
    fetchElementAnalysis,
    customStart,
    customEnd,
  ]);

  const handleStartBackfill = useCallback(async () => {
    setShowBackfillModal(false);
    setElementRefreshing(true);
    setElementProgress("Queuing backfill...");
    try {
      const queueRes = await queueElementAnalysisBackfill({});
      if (queueRes?.status === 200 && queueRes.job_id) {
        if (elementPollRef.current) clearInterval(elementPollRef.current);
        elementPollRef.current = setInterval(async () => {
          try {
            const statusRes = await checkElementAnalysisBackfillStatus({});
            if (statusRes?.status === 200) {
              setElementProgress(statusRes.progress || "Processing...");
              if (
                statusRes.sync_status === "completed" ||
                statusRes.sync_status === "failed"
              ) {
                if (elementPollRef.current)
                  clearInterval(elementPollRef.current);
                elementPollRef.current = null;
                setElementRefreshing(false);
                setElementProgress(null);
              }
            }
          } catch {
            if (elementPollRef.current) clearInterval(elementPollRef.current);
            elementPollRef.current = null;
            setElementRefreshing(false);
            setElementProgress(null);
          }
        }, 5000);
      }
    } catch {
      setElementRefreshing(false);
      setElementProgress(null);
    }
  }, [queueElementAnalysisBackfill, checkElementAnalysisBackfillStatus]);

  // ── Derived data ─────────────────────────────────────────────
  const overallProgress = useMemo(() => {
    if (!editingData) return null;
    const totalTasks = editingData.projects.reduce(
      (s, p) => s + p.total_tasks,
      0,
    );
    const totalMapped = editingData.projects.reduce(
      (s, p) => s + p.tasks_mapped,
      0,
    );
    const totalValidated = editingData.projects.reduce(
      (s, p) => s + p.tasks_validated,
      0,
    );
    const pct =
      totalTasks > 0 ? Math.round((totalMapped / totalTasks) * 100) : 0;
    return { totalTasks, totalMapped, totalValidated, pct };
  }, [editingData]);

  const trendSeries = useMemo(() => {
    const isWeekly = timekeepingGranularity === "weekly";
    const tkData = isWeekly
      ? (timekeepingData?.weekly_activity ?? []).map((d) => ({
          date: d.week,
          changes: d.changes,
          changesets: d.changesets,
        }))
      : (timekeepingData?.daily_activity ?? []).map((d) => ({
          date: d.day,
          changes: d.changes,
          changesets: d.changesets,
        }));
    const tkCmp = isWeekly
      ? (timekeepingData?.comparison?.weekly_activity ?? []).map((d) => ({
          date: d.week,
          changes: d.changes,
          changesets: d.changesets,
        }))
      : (timekeepingData?.comparison?.daily_activity ?? []).map((d) => ({
          date: d.day,
          changes: d.changes,
          changesets: d.changesets,
        }));
    const edData = isWeekly
      ? (editingData?.tasks_over_time ?? []).map((d) => ({
          date: d.week,
          mapped: d.mapped,
          validated: d.validated,
        }))
      : (editingData?.tasks_over_time_daily ?? []).map((d) => ({
          date: d.day,
          mapped: d.mapped,
          validated: d.validated,
        }));
    const edCmp = isWeekly
      ? (editingData?.comparison?.tasks_over_time ?? []).map((d) => ({
          date: d.week,
          mapped: d.mapped,
          validated: d.validated,
        }))
      : (editingData?.comparison?.tasks_over_time_daily ?? []).map((d) => ({
          date: d.day,
          mapped: d.mapped,
          validated: d.validated,
        }));
    return { tkData, tkCmp, edData, edCmp };
  }, [timekeepingData, editingData, timekeepingGranularity]);

  // ── KPI anomaly helpers ───────────────────────────────────────
  const kpiStats = useMemo(() => {
    function anomalyFor(currentVal: number, cmpWeekly: number[]) {
      if (cmpWeekly.length === 0) return { delta: null, anomaly: false };
      const cmpTotal = cmpWeekly.reduce((s, v) => s + v, 0);
      const mean = cmpTotal / cmpWeekly.length;
      const variance =
        cmpWeekly.reduce((s, v) => s + (v - mean) ** 2, 0) / cmpWeekly.length;
      const sigma = Math.sqrt(variance);
      const delta =
        cmpTotal > 0 ? ((currentVal - cmpTotal) / cmpTotal) * 100 : null;
      const currentAvg = currentVal / Math.max(1, cmpWeekly.length);
      const anomaly = sigma > 0 && Math.abs(currentAvg - mean) > sigma;
      return { delta, anomaly };
    }

    const cmpTkWeekly = timekeepingData?.comparison?.weekly_activity ?? [];
    const cmpEdWeekly = editingData?.comparison?.tasks_over_time ?? [];

    return {
      hours: anomalyFor(
        timekeepingData?.summary.total_hours ?? 0,
        cmpTkWeekly.map((w) => w.hours),
      ),
      changesets: anomalyFor(
        timekeepingData?.summary.total_changesets ?? 0,
        cmpTkWeekly.map((w) => w.changesets),
      ),
      changes: anomalyFor(
        timekeepingData?.summary.total_changes ?? 0,
        cmpTkWeekly.map((w) => w.changes),
      ),
      tasksMapped: anomalyFor(
        overallProgress?.totalMapped ?? 0,
        cmpEdWeekly.map((w) => w.mapped),
      ),
    };
  }, [timekeepingData, editingData, overallProgress]);

  const projectsClockedInto = useMemo(
    () =>
      sortProjectsAlphabetical(timekeepingData?.projects_clocked_into ?? []),
    [timekeepingData],
  );

  useEffect(() => {
    console.log(heatmapPoints);
  }, [heatmapPoints]);

  useEffect(() => {
    console.log(heatmapLoading);
  }, [heatmapLoading]);

  // ── team_admin with no managed teams → empty state ───────────
  // NOTE: every hook must run before this early return — React requires the
  // same hook order on every render, so no hooks may live below this guard.
  if (isTeamAdmin && !managedTeamsLoading && managedTeams.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Reports</h1>
        <TeamAdminEmptyState context="reports" />
      </div>
    );
  }

  const totalChangesets = timekeepingData?.summary.total_changesets ?? 0;
  const totalHours = timekeepingData?.summary.total_hours ?? 0;
  const totalChanges = timekeepingData?.summary.total_changes ?? 0;

  return (
    <div className="space-y-6">
      {/* CONTROLS ROW */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={draftStart}
                onChange={(e) => setDraftStart(e.target.value)}
                className="px-3 py-1.5 border border-input rounded-lg text-sm"
              />
              <span className="text-sm text-muted-foreground">to</span>
              <input
                type="date"
                value={draftEnd}
                onChange={(e) => setDraftEnd(e.target.value)}
                className="px-3 py-1.5 border border-input rounded-lg text-sm"
              />
            </div>

            {/* Granularity toggle */}
            <div className="flex rounded-md border border-border overflow-hidden text-sm">
              <button
                onClick={() => setTimekeepingGranularity("weekly")}
                className={`px-3 py-1.5 transition-colors ${timekeepingGranularity === "weekly" ? "bg-kaart-orange text-white" : "bg-background text-muted-foreground hover:bg-muted"}`}
              >
                Weekly
              </button>
              <button
                onClick={() => setTimekeepingGranularity("daily")}
                className={`px-3 py-1.5 transition-colors ${timekeepingGranularity === "daily" ? "bg-kaart-orange text-white" : "bg-background text-muted-foreground hover:bg-muted"}`}
              >
                Daily
              </button>
            </div>

            {/* Compare toggle */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setCompareEnabled((prev) => !prev)}
                className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors bg-blue-600 text-white hover:bg-blue-700"
              >
                {compareEnabled ? "Compare ON" : "Compare OFF"}
              </button>
              {compareEnabled && (
                <>
                  <input
                    type="date"
                    value={draftCompareStart}
                    onChange={(e) => setDraftCompareStart(e.target.value)}
                    className="px-3 py-1.5 border border-input rounded-lg text-sm"
                  />
                  <span className="text-sm text-muted-foreground">to</span>
                  <input
                    type="date"
                    value={draftCompareEnd}
                    onChange={(e) => setDraftCompareEnd(e.target.value)}
                    className="px-3 py-1.5 border border-input rounded-lg text-sm"
                  />
                </>
              )}
            </div>

            {/* Update Dates */}
            <button
              onClick={() => {
                setCustomStart(draftStart);
                setCustomEnd(draftEnd);
                setCompareStart(draftCompareStart);
                setCompareEnd(draftCompareEnd);
              }}
              className="px-3 py-1.5 rounded-lg text-sm font-medium bg-kaart-orange text-white hover:bg-kaart-orange/90 transition-colors"
            >
              Update Dates
            </button>

            {/* Universal FilterBar + Export */}
            <div className="ml-auto flex items-center gap-2">
              <ExportDropdown
                contentRef={reportContentRef}
                dateRange={`${customStart} to ${customEnd}`}
              />
              <FilterBar
                dimensions={
                  filterOptions?.dimensions
                    ? Object.entries(filterOptions.dimensions).map(
                        ([key, values]) => ({
                          key,
                          label: key.charAt(0).toUpperCase() + key.slice(1),
                          options: Array.isArray(values)
                            ? values.map((v) =>
                                typeof v === "string"
                                  ? { value: v, label: v }
                                  : {
                                      value: String(v.id ?? v.value ?? v.name),
                                      label: v.name,
                                    },
                              )
                            : [],
                        }),
                      )
                    : []
                }
                activeFilters={activeFilters}
                onChange={setActiveFilters}
                loading={filterOptionsLoading}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Report content captured for PDF export */}
      <div ref={reportContentRef}>
        {/* KPI Summary */}
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-8 gap-2">
            <KpiCard
              label="Total Hours"
              value={formatNumber(totalHours)}
              subtitle=""
              delta={kpiStats.hours.delta}
              anomalyFlag={kpiStats.hours.anomaly}
              info="Sum of all logged timekeeping entries for the selected period and filtered scope."
            />
            <KpiCard
              label="Total Changesets"
              value={formatNumber(totalChangesets)}
              subtitle=""
              delta={kpiStats.changesets.delta}
              anomalyFlag={kpiStats.changesets.anomaly}
              info="Count of OSM changesets submitted by contributors in the selected period."
            />
            <KpiCard
              label="Total Changes"
              value={formatNumber(totalChanges)}
              subtitle=""
              delta={kpiStats.changes.delta}
              anomalyFlag={kpiStats.changes.anomaly}
              info="OSM element-level edits (added + modified + deleted) from linked changesets."
            />
            <KpiCard
              label="Avg Changes / Changeset"
              value={
                totalChangesets > 0
                  ? formatNumber(totalChanges / totalChangesets)
                  : "—"
              }
              subtitle=""
              info="Total changes divided by total changesets for the period."
            />
            <KpiCard
              label="Avg Changes / Hour"
              value={
                totalHours > 0 ? formatNumber(totalChanges / totalHours) : "—"
              }
              subtitle=""
              info="Total changes divided by total logged hours for the period."
            />
            <KpiCard
              label="Total Tasks"
              value={formatNumber(overallProgress?.totalTasks ?? 0)}
              subtitle=""
              info="Sum of all task slots across active projects in the selected scope."
            />
            <KpiCard
              label="Tasks Completed"
              value={formatNumber(overallProgress?.totalMapped ?? 0)}
              subtitle=""
              delta={kpiStats.tasksMapped.delta}
              anomalyFlag={kpiStats.tasksMapped.anomaly}
              info="Tasks marked as mapped (completed) within the selected period and scope."
            />
            <KpiCard
              label="% Complete"
              value={`${overallProgress?.pct ?? 0}%`}
              subtitle=""
              info="Percentage of total task slots that have been mapped across all active projects."
            />
          </div>

          {/* ── Trends + Activity ── */}
          <div className="flex flex-row gap-4">
            <TrendOverview
              title="Total Changes"
              data={trendSeries.tkData.map((d) => ({
                date: d.date,
                value: d.changes,
              }))}
              compareData={trendSeries.tkCmp.map((d) => ({
                date: d.date,
                value: d.changes,
              }))}
              color="#f97316"
              loading={timekeepingLoading}
            />
            <TrendOverview
              title="Total Changesets"
              data={trendSeries.tkData.map((d) => ({
                date: d.date,
                value: d.changesets,
              }))}
              compareData={trendSeries.tkCmp.map((d) => ({
                date: d.date,
                value: d.changesets,
              }))}
              color="#3b82f6"
              loading={timekeepingLoading}
            />
            <TrendOverview
              title="Tasks Completed"
              data={trendSeries.edData.map((d) => ({
                date: d.date,
                value: d.mapped,
              }))}
              compareData={trendSeries.edCmp.map((d) => ({
                date: d.date,
                value: d.mapped,
              }))}
              color="#10b981"
              loading={editingLoading}
            />
            <TrendOverview
              title="Validation Rate"
              data={trendSeries.edData.map((d) => ({
                date: d.date,
                value:
                  d.mapped > 0 ? Math.round((d.validated / d.mapped) * 100) : 0,
              }))}
              compareData={trendSeries.edCmp.map((d) => ({
                date: d.date,
                value:
                  d.mapped > 0 ? Math.round((d.validated / d.mapped) * 100) : 0,
              }))}
              color="#8b5cf6"
              unit="%"
              loading={editingLoading}
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            {timekeepingData ? (
              <>
                <TeamActivityCard
                  data={timekeepingData}
                  granularity={timekeepingGranularity}
                />
                <TaskHoursByCategoryCard
                  data={timekeepingData}
                  granularity={timekeepingGranularity}
                />
                <CommunityOutreachCard
                  data={timekeepingData}
                  granularity={timekeepingGranularity}
                />
              </>
            ) : timekeepingLoading ? (
              <div className="col-span-3">
                <LoadingSpinner />
              </div>
            ) : null}
          </div>
        </div>

        {/* ── Editing Section ── */}
        {editingLoading && !editingData ? (
          <LoadingSpinner />
        ) : editingError ? (
          <Card>
            <CardContent className="p-8 text-center text-red-500">
              Failed to load editing stats: {editingError}
            </CardContent>
          </Card>
        ) : editingData ? (
          <ElementActivitySection
            elementCategories={elementCategories}
            elementLastUpdated={elementLastUpdated}
            elementLoading={elementLoading}
            elementRefreshing={elementRefreshing}
            elementProgress={elementProgress}
            showRefreshModal={showRefreshModal}
            setShowRefreshModal={setShowRefreshModal}
            showBackfillModal={showBackfillModal}
            setShowBackfillModal={setShowBackfillModal}
            onStartAnalysis={handleStartAnalysis}
            onStartBackfill={handleStartBackfill}
            granularity={timekeepingGranularity}
          />
        ) : null}
      </div>
      {/* end reportContentRef */}

      {/* ── Project Snapshot ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {editingData && editingData.projects.length > 0 && (
          <div className="lg:col-span-2 h-full">
            <ProjectSnapshotTable projects={editingData.projects} />
          </div>
        )}

        <Card className="h-full">
          <CardHeader className="px-4 pt-4 pb-0">
            <CardTitle className="text-base">Projects This Period</CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            {projectsClockedInto.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No projects clocked into this period.
              </p>
            ) : (
              <ul className="overflow-y-auto max-h-72 divide-y divide-border">
                {projectsClockedInto.map((p) => (
                  <li key={p.id} className="py-2">
                    <Link
                      href={dynamicRoutes.project(p.id)}
                      className="text-sm text-foreground hover:text-kaart-orange hover:underline font-medium"
                    >
                      {projectDisplayName(p)}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <ChangesetHeatmapCard
        heatmapPoints={heatmapPoints}
        heatmapLoading={heatmapLoading}
        className="h-[600px]"
      />
    </div>
  );
}
