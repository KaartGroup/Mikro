"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Card,
  CardContent,
  Val,
} from "@/components/ui";
import {
  useFetchEditingStats,
  useFetchMrStats,
  useFetchTimekeepingStats,
  useFetchFilterOptions,
  useFetchChangesetHeatmap,
  useFetchElementAnalysis,
  useQueueElementAnalysis,
  useCheckElementAnalysisStatus,
  useFetchMapillaryStats,
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
  MapillaryStatsResponse,
} from "@/types";
import { formatNumber } from "@/lib/utils";
import TrendOverview from "./_components/TrendOverview";
import { LoadingSpinner } from "./_components/LoadingSpinner";
import { ProjectProgressDonut } from "./_components/ProjectProgressDonut";
import { ChangesetHeatmapCard } from "./_components/ChangesetHeatmapCard";
import { ElementActivitySection } from "./_components/ElementActivitySection";
import { TeamActivityCard } from "./_components/TeamActivityCard";
import { TaskHoursByCategoryCard } from "./_components/TaskHoursByCategoryCard";
import { CommunityOutreachCard } from "./_components/CommunityOutreachCard";

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function lastWeekRange() {
  const today = new Date();
  const lastSunday = new Date(today);
  lastSunday.setDate(today.getDate() - today.getDay() - 7);
  const lastSaturday = new Date(lastSunday);
  lastSaturday.setDate(lastSunday.getDate() + 6);
  return { start: localDateStr(lastSunday), end: localDateStr(lastSaturday) };
}

function prevWeekRange() {
  const { start } = lastWeekRange();
  const lastSunday = new Date(start + "T00:00:00");
  const prevSat = new Date(lastSunday);
  prevSat.setDate(lastSunday.getDate() - 1);
  const prevSun = new Date(prevSat);
  prevSun.setDate(prevSat.getDate() - 6);
  return { start: localDateStr(prevSun), end: localDateStr(prevSat) };
}

export default function AdminReportsPage() {
  const { role: viewerRole } = useCurrentUserRole();
  const { teams: managedTeams, loading: managedTeamsLoading } = useManagedTeams();
  const isTeamAdmin = viewerRole === "team_admin";

  // ── Shared UI state ──────────────────────────────────────────
  const [customStart, setCustomStart] = useState(() => lastWeekRange().start);
  const [customEnd, setCustomEnd] = useState(() => lastWeekRange().end);
  const [compareEnabled, setCompareEnabled] = useState(true);
  const [compareStart, setCompareStart] = useState(() => prevWeekRange().start);
  const [compareEnd, setCompareEnd] = useState(() => prevWeekRange().end);
  const [snapshotTime, setSnapshotTime] = useState<string | null>(null);
  const [timekeepingGranularity, setTimekeepingGranularity] = useState<"weekly" | "daily">("daily");

  // ── Tab data state ───────────────────────────────────────────
  const [editingData, setEditingData] = useState<EditingStatsResponse | null>(null);
  const [timekeepingData, setTimekeepingData] = useState<TimekeepingStatsResponse | null>(null);
  const [mrData, setMrData] = useState<EditingStatsResponse | null>(null);
  const [mapillaryData, setMapillaryData] = useState<MapillaryStatsResponse | null>(null);
  const [mapillaryLoading, setMapillaryLoading] = useState(false);

  // ── Heatmap state (editing tab) ──────────────────────────────
  const [heatmapPoints, setHeatmapPoints] = useState<[number, number, number][]>([]);
  const [heatmapLoading, setHeatmapLoading] = useState(false);
  const [heatmapSummary, setHeatmapSummary] = useState<{
    totalChangesets: number;
    totalChanges: number;
    usersWithData: number;
  } | null>(null);

  // ── Element analysis state (editing tab) ────────────────────
  const [elementCategories, setElementCategories] = useState<ElementAnalysisCategory[]>([]);
  const [elementLastUpdated, setElementLastUpdated] = useState<string | null>(null);
  const [elementLoading, setElementLoading] = useState(false);
  const [elementRefreshing, setElementRefreshing] = useState(false);
  const [elementProgress, setElementProgress] = useState<string | null>(null);
  const [showRefreshModal, setShowRefreshModal] = useState(false);
  const elementPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (elementPollRef.current) clearInterval(elementPollRef.current);
    };
  }, []);

  // ── Hooks ────────────────────────────────────────────────────
  const { mutate: fetchEditing, loading: editingLoading, error: editingError } = useFetchEditingStats();
  const { mutate: fetchMr, loading: mrLoading, error: mrError } = useFetchMrStats();
  const { mutate: fetchTimekeeping, loading: timekeepingLoading } = useFetchTimekeepingStats();
  const { activeFilters, setActiveFilters, filtersBody } = useFilters();
  const { data: filterOptions, loading: filterOptionsLoading } = useFetchFilterOptions();
  const { mutate: fetchHeatmap } = useFetchChangesetHeatmap();
  const { mutate: fetchElementAnalysis } = useFetchElementAnalysis();
  const { mutate: queueElementAnalysis } = useQueueElementAnalysis();
  const { mutate: checkElementAnalysisStatus } = useCheckElementAnalysisStatus();
  const { mutate: fetchMapillaryStats } = useFetchMapillaryStats();

  // ── Data fetching ────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!customStart || !customEnd) return;
    const startDate = customStart;
    const endDate = customEnd;

    const startIso = dateInputToLocalStartIsoUtc(startDate);
    const endIso = dateInputToLocalEndIsoUtc(endDate);

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
    setMapillaryLoading(true);

    await Promise.allSettled([
      fetchEditing(params).then((res) => {
        if (res?.status === 200) {
          setEditingData(res);
          setSnapshotTime(res.snapshot_timestamp);
        }
      }),
      fetchTimekeeping(params).then((res) => {
        if (res?.status === 200) {
          setTimekeepingData(res);
          setSnapshotTime(res.snapshot_timestamp);
        }
      }),
      fetchMr(params).then((res) => {
        if (res?.status === 200) setMrData(res);
      }),
      fetchHeatmap(params).then((res) => {
        if (res?.status === 200) {
          setHeatmapPoints(res.heatmapPoints || []);
          setHeatmapSummary(res.summary || null);
        }
      }).finally(() => setHeatmapLoading(false)),
      fetchElementAnalysis({ startDate: startIso, endDate: endIso }).then((res) => {
        if (res?.status === 200) {
          console.log("Fetched element analysis:", res);
          setElementCategories(res.categories || []);
          setElementLastUpdated(res.lastUpdated);
        } else {
          console.error("Failed to fetch element analysis:", res);
        }
      }).finally(() => setElementLoading(false)),
      fetchMapillaryStats({
        startDate: startIso,
        endDate: endIso,
        ...(filtersBody?.team ? { teamId: filtersBody.team[0] } : {}),
        ...(filtersBody?.user ? { userId: filtersBody.user[0] } : {}),
      }).then((res) => {
        if (res?.status === 200) setMapillaryData(res);
      }).finally(() => setMapillaryLoading(false)),
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
    fetchMapillaryStats,
  ]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Element analysis refresh (triggered from EditingTab modal) ──
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
                if (elementPollRef.current) clearInterval(elementPollRef.current);
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
                if (elementPollRef.current) clearInterval(elementPollRef.current);
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

    const overallProgress = editingData
    ? (() => {
        const totalTasks = editingData.projects.reduce((s, p) => s + p.total_tasks, 0);
        const totalMapped = editingData.projects.reduce((s, p) => s + p.tasks_mapped, 0);
        const totalValidated = editingData.projects.reduce((s, p) => s + p.tasks_validated, 0);
        const pct = totalTasks > 0 ? Math.round((totalMapped / totalTasks) * 100) : 0;
        return { totalTasks, totalMapped, totalValidated, pct };
      })()
    : null;

  // ── team_admin with no managed teams → empty state ───────────
  if (isTeamAdmin && !managedTeamsLoading && managedTeams.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Reports</h1>
        <TeamAdminEmptyState context="reports" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* CONTROLS ROW */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="px-3 py-1.5 border border-input rounded-lg text-sm"
              />
              <span className="text-sm text-muted-foreground">to</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="px-3 py-1.5 border border-input rounded-lg text-sm"
              />
            </div>

            {/* Compare toggle */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setCompareEnabled((prev) => !prev)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  compareEnabled
                    ? "bg-blue-600 text-white"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {compareEnabled ? "Compare ON" : "Compare"}
              </button>
              {compareEnabled && (
                <>
                  <input
                    type="date"
                    value={compareStart}
                    onChange={(e) => setCompareStart(e.target.value)}
                    className="px-3 py-1.5 border border-input rounded-lg text-sm"
                  />
                  <span className="text-sm text-muted-foreground">to</span>
                  <input
                    type="date"
                    value={compareEnd}
                    onChange={(e) => setCompareEnd(e.target.value)}
                    className="px-3 py-1.5 border border-input rounded-lg text-sm"
                  />
                </>
              )}
            </div>

            {/* Universal FilterBar */}
            <div className="ml-auto">
              <FilterBar
                dimensions={
                  filterOptions?.dimensions
                    ? Object.entries(filterOptions.dimensions).map(([key, values]) => ({
                        key,
                        label: key.charAt(0).toUpperCase() + key.slice(1),
                        options: Array.isArray(values)
                          ? values.map((v) =>
                              typeof v === "string"
                                ? { value: v, label: v }
                                : {
                                    value: String(v.id ?? v.value ?? v.name),
                                    label: v.name,
                                  }
                            )
                          : [],
                      }))
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

      {/* KPI Summary */}
      <div className="flex flex-row gap-2">
        {[
          { label: "Total Hours", value: formatNumber(timekeepingData?.summary.total_hours ?? 0) },
          { label: "Total Changesets", value: formatNumber(timekeepingData?.summary.total_changesets ?? 0) },
          { label: "Total Changes", value: formatNumber(timekeepingData?.summary.total_changes ?? 0) },
          { label: "Avg Changes / Changeset", value: formatNumber((timekeepingData?.summary.total_changes ?? 0) / (timekeepingData?.summary.total_changesets ?? 1)) },
          { label: "Avg Changes / Hour", value: formatNumber((timekeepingData?.summary.total_changes ?? 0) / (timekeepingData?.summary.total_hours ?? 1)) },
          { label: "Total Tasks", value: formatNumber(overallProgress?.totalTasks ?? 0) },
          { label: "Tasks Completed", value: formatNumber(overallProgress?.totalMapped ?? 0) },
          { label: "% Complete", value: formatNumber(overallProgress?.pct ?? 0), suffix: "%" },
        ].map(({ label, value, suffix }) => (
          <Card key={label} className="flex-1">
            <CardContent className="px-4 py-3">
              <p className="text-xs text-muted-foreground mb-1">{label}</p>
              <p className="text-xl font-bold leading-none">
                <Val>{value}</Val>{suffix}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Trends (left) + Daily Charts (right) ── */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-row gap-4">
          <TrendOverview
            title="Total Changes"
            data={(timekeepingData?.daily_activity ?? []).map((d) => ({ date: d.day, value: d.changes }))}
            compareData={(timekeepingData?.comparison?.daily_activity ?? []).map((d) => ({ date: d.day, value: d.changes }))}
            color="#f97316"
            loading={timekeepingLoading}
          />
          <TrendOverview
            title="Total Changesets"
            data={(timekeepingData?.daily_activity ?? []).map((d) => ({ date: d.day, value: d.changesets }))}
            compareData={(timekeepingData?.comparison?.daily_activity ?? []).map((d) => ({ date: d.day, value: d.changesets }))}
            color="#3b82f6"
            loading={timekeepingLoading}
          />
          <TrendOverview
            title="Tasks Completed"
            data={(editingData?.tasks_over_time_daily ?? []).map((d) => ({ date: d.day, value: d.mapped }))}
            compareData={(editingData?.comparison?.tasks_over_time_daily ?? []).map((d) => ({ date: d.day, value: d.mapped }))}
            color="#10b981"
            loading={editingLoading}
          />
          <TrendOverview
            title="Validation Rate"
            data={(editingData?.tasks_over_time_daily ?? []).map((d) => ({
              date: d.day,
              value: d.mapped > 0 ? Math.round((d.validated / d.mapped) * 100) : 0,
            }))}
            compareData={(editingData?.comparison?.tasks_over_time_daily ?? []).map((d) => ({
              date: d.day,
              value: d.mapped > 0 ? Math.round((d.validated / d.mapped) * 100) : 0,
            }))}
            color="#8b5cf6"
            unit="%"
            loading={editingLoading}
          />
        </div>

        <div className="flex flex-row gap-4 justify-between">
          {timekeepingData ? (
            <>
              <TeamActivityCard
                data={timekeepingData}
                granularity={timekeepingGranularity}
                setGranularity={setTimekeepingGranularity}
              />
              <TaskHoursByCategoryCard
                data={timekeepingData}
                granularity={timekeepingGranularity}
              />
                        <ChangesetHeatmapCard
            heatmapPoints={heatmapPoints}
            heatmapLoading={heatmapLoading}
            heatmapSummary={heatmapSummary}
          />
            </>
          ) : timekeepingLoading ? (
            <LoadingSpinner />
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
        <div className="space-y-6">

          <ElementActivitySection
            elementCategories={elementCategories}
            elementLastUpdated={elementLastUpdated}
            elementLoading={elementLoading}
            elementRefreshing={elementRefreshing}
            elementProgress={elementProgress}
            showRefreshModal={showRefreshModal}
            setShowRefreshModal={setShowRefreshModal}
            onStartAnalysis={handleStartAnalysis}
          />
        </div>
      ) : null}
    </div>
  );
}
