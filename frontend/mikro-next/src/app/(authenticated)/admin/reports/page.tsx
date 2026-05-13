"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Val,
  CardHeader,
  CardTitle,
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
  formatDateRangeShort,
} from "@/lib/timeTracking";
import { FilterBar } from "@/components/filters";
import type {
  EditingStatsResponse,
  TimekeepingStatsResponse,
  ElementAnalysisCategory,
  MapillaryStatsResponse,
} from "@/types";
import { getDateRange, formatDateTime } from "./_components/reportUtils";
import { EditingTab } from "./_components/EditingTab";
import { CommunityTab } from "./_components/CommunityTab";
import { TimekeepingTab } from "./_components/TimekeepingTab";
import { ImageryTab } from "./_components/ImageryTab";
import { MapRouletteTab } from "./_components/MapRouletteTab";
import { formatNumber } from "@/lib/utils";
import TrendOverview from "./_components/TrendOverview";

export default function AdminReportsPage() {
  const router = useRouter();

  const { role: viewerRole } = useCurrentUserRole();
  const { teams: managedTeams, loading: managedTeamsLoading } = useManagedTeams();
  const isTeamAdmin = viewerRole === "team_admin";

  // ── Shared UI state ──────────────────────────────────────────
  const [activeTab, setActiveTab] = useState("editing");
  const [datePreset, setDatePreset] = useState<"daily" | "weekly" | "monthly" | "custom">("monthly");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [snapshotTime, setSnapshotTime] = useState<string | null>(null);

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
  const { mutate: fetchTimekeeping, loading: timekeepingLoading, error: timekeepingError } = useFetchTimekeepingStats();
  const { activeFilters, setActiveFilters, filtersBody } = useFilters();
  const { data: filterOptions, loading: filterOptionsLoading } = useFetchFilterOptions();
  const { mutate: fetchHeatmap } = useFetchChangesetHeatmap();
  const { mutate: fetchElementAnalysis } = useFetchElementAnalysis();
  const { mutate: queueElementAnalysis } = useQueueElementAnalysis();
  const { mutate: checkElementAnalysisStatus } = useCheckElementAnalysisStatus();
  const { mutate: fetchMapillaryStats } = useFetchMapillaryStats();

  // ── Data fetching ────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    let startDate: string, endDate: string;
    if (datePreset === "custom") {
      if (!customStart || !customEnd) return;
      startDate = customStart;
      endDate = customEnd;
    } else {
      const range = getDateRange(datePreset);
      startDate = range.start;
      endDate = range.end;
    }

    const startIso = dateInputToLocalStartIsoUtc(startDate);
    const endIso = dateInputToLocalEndIsoUtc(endDate);

    const params: Record<string, unknown> = {
      startDate: startIso,
      endDate: endIso,
      filters: filtersBody,
    };

    if (compareEnabled) {
      const start = new Date(startDate + "T00:00:00");
      const end = new Date(endDate + "T00:00:00");
      const oneDay = 86400000;
      const periodMs = Math.max(end.getTime() - start.getTime(), oneDay);
      const compareEnd = new Date(start.getTime());
      const compareStart = new Date(start.getTime() - periodMs);
      const fmtDate = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      params.compareStartDate = dateInputToLocalStartIsoUtc(fmtDate(compareStart));
      params.compareEndDate = dateInputToLocalEndIsoUtc(fmtDate(compareEnd));
    }

    try {
      if (activeTab === "editing") {
        const res = await fetchEditing(params);
        if (res?.status === 200) {
          setEditingData(res);
          setSnapshotTime(res.snapshot_timestamp);
        }

        setHeatmapLoading(true);
        fetchHeatmap(params)
          .then((heatRes) => {
            if (heatRes?.status === 200) {
              setHeatmapPoints(heatRes.heatmapPoints || []);
              setHeatmapSummary(heatRes.summary || null);
            }
          })
          .catch(() => {})
          .finally(() => setHeatmapLoading(false));

        setElementLoading(true);
        fetchElementAnalysis({ startDate: startIso, endDate: endIso })
          .then((elRes) => {
            if (elRes?.status === 200) {
              setElementCategories(elRes.categories || []);
              setElementLastUpdated(elRes.lastUpdated);
            }
          })
          .catch(() => {})
          .finally(() => setElementLoading(false));
      } else if (activeTab === "timekeeping") {
        const res = await fetchTimekeeping(params);
        if (res?.status === 200) {
          setTimekeepingData(res);
          setSnapshotTime(res.snapshot_timestamp);
        }
      } else if (activeTab === "maproulette") {
        const res = await fetchMr(params);
        if (res?.status === 200) {
          setMrData(res);
        }
      } else if (activeTab === "imagery") {
        setMapillaryLoading(true);
        try {
          const mapRes = await fetchMapillaryStats({
            startDate: startIso,
            endDate: endIso,
            ...(filtersBody?.team ? { teamId: filtersBody.team[0] } : {}),
            ...(filtersBody?.user ? { userId: filtersBody.user[0] } : {}),
          });
          if (mapRes?.status === 200) {
            setMapillaryData(mapRes);
          }
        } catch (err) {
          console.error("Error fetching Mapillary stats:", err);
        } finally {
          setMapillaryLoading(false);
        }
      }
    } catch {
      // API errors are handled by the hook's error state
    }
  }, [
    datePreset,
    customStart,
    customEnd,
    filtersBody,
    compareEnabled,
    activeTab,
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

    useEffect(() => {
    console.log("timekeeping data", timekeepingData);
  }, [timekeepingData]);

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
                let startDate: string, endDate: string;
                if (datePreset === "custom") {
                  startDate = customStart;
                  endDate = customEnd;
                } else {
                  const range = getDateRange(datePreset);
                  startDate = range.start;
                  endDate = range.end;
                }
                const elRes = await fetchElementAnalysis({
                  startDate: dateInputToLocalStartIsoUtc(startDate),
                  endDate: dateInputToLocalEndIsoUtc(endDate),
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
    datePreset,
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
      {/* HEADER */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Reports</h1>
          <p className="text-muted-foreground">
            {isTeamAdmin
              ? "Analytics scoped to your managed teams"
              : "Organization-wide analytics and insights"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {snapshotTime && (
            <span className="text-xs text-muted-foreground">
              Snapshot: {formatDateTime(snapshotTime)}
            </span>
          )}
          <button
            onClick={() => router.push("/admin/reports/weekly")}
            className="inline-flex items-center px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            Build Weekly Report
          </button>
          <button
            onClick={() => fetchData()}
            disabled={editingLoading || mrLoading || timekeepingLoading}
            className="inline-flex items-center px-3 py-1.5 rounded-lg bg-kaart-orange text-white text-sm font-medium hover:bg-kaart-orange-dark transition-colors disabled:opacity-50"
          >
            {editingLoading || mrLoading || timekeepingLoading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {/* CONTROLS ROW */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            {/* Date range presets */}
            <div className="flex items-center gap-2">
              {(["daily", "weekly", "monthly", "custom"] as const).map((preset) => {
                let range = "";
                if (preset === "custom") {
                  range = formatDateRangeShort(customStart, customEnd, { emptyLabel: "" });
                } else {
                  const r = getDateRange(preset);
                  range = formatDateRangeShort(r.start, r.end, { emptyLabel: "" });
                }
                return (
                  <button
                    key={preset}
                    onClick={() => setDatePreset(preset)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      datePreset === preset
                        ? "bg-kaart-orange text-white"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    {preset.charAt(0).toUpperCase() + preset.slice(1)}
                    {range && (
                      <span
                        className={`ml-1.5 text-xs font-normal ${
                          datePreset === preset ? "text-white/80" : "text-muted-foreground/70"
                        }`}
                      >
                        ({range})
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {datePreset === "custom" && (
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
            )}

            {/* Resolved-range caption */}
            {(() => {
              const r =
                datePreset === "custom"
                  ? { start: customStart, end: customEnd }
                  : getDateRange(datePreset);
              const range = formatDateRangeShort(r.start, r.end, { emptyLabel: "" });
              if (!range) return null;
              return (
                <div className="basis-full text-xs text-muted-foreground">
                  Showing data from{" "}
                  <span className="font-medium text-foreground">{range}</span>
                </div>
              );
            })()}

            {/* Compare toggle */}
            <div className="flex items-center gap-2">
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
              {compareEnabled &&
                (() => {
                  let s: string, e: string;
                  if (datePreset === "custom") {
                    s = customStart;
                    e = customEnd;
                  } else {
                    const r = getDateRange(datePreset);
                    s = r.start;
                    e = r.end;
                  }
                  const start = new Date(s + "T00:00:00");
                  const end = new Date(e + "T00:00:00");
                  const oneDay = 86400000;
                  const periodMs = Math.max(end.getTime() - start.getTime(), oneDay);
                  const cEnd = new Date(start.getTime());
                  const cStart = new Date(start.getTime() - periodMs);
                  const fmt = (d: Date) =>
                    d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                  const sameDay = periodMs <= oneDay;
                  return (
                    <span className="text-xs text-muted-foreground">
                      {sameDay ? fmt(start) : `${fmt(start)} – ${fmt(end)}`}
                      {" vs "}
                      {sameDay ? fmt(cStart) : `${fmt(cStart)} – ${fmt(cEnd)}`}
                    </span>
                  );
                })()}
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
      <div className="flex flex-row">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Total Hours</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">
              <Val>{formatNumber(timekeepingData?.summary.total_hours ?? 0)}</Val>h
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Total Changesets</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">
              <Val>{formatNumber(timekeepingData?.summary.total_changesets ?? 0)}</Val>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Total Changes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">
              <Val>{formatNumber(timekeepingData?.summary.total_changes ?? 0)}</Val>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Average Changes / Changeset</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">
              <Val>{formatNumber((timekeepingData?.summary.total_changes ?? 0) / (timekeepingData?.summary.total_changesets ?? 1))}</Val>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Average Changes / Hours</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">
              <Val>{formatNumber((timekeepingData?.summary.total_changes ?? 0) / (timekeepingData?.summary.total_hours ?? 1))}</Val>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Total Tasks</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">
              <Val>{formatNumber(overallProgress?.totalTasks ?? 0)}</Val>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tasks Completed</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">
              <Val>{formatNumber(overallProgress?.totalMapped ?? 0)}</Val>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">% complete</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">
              <Val>{formatNumber(overallProgress?.pct ?? 0)}</Val>
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <TrendOverview
          title="Total Changes"
          data={(timekeepingData?.weekly_activity ?? []).map((d) => ({
            date: d.week,
            value: d.changes,
          }))}
          color="#f97316"
          loading={timekeepingLoading}
          compareEnabled={compareEnabled}
          compareTotal={timekeepingData?.comparison?.summary.total_changes ?? null}
        />
        <TrendOverview
          title="Total Changesets"
          data={(timekeepingData?.weekly_activity ?? []).map((d) => ({
            date: d.week,
            value: d.changesets,
          }))}
          color="#3b82f6"
          loading={timekeepingLoading}
          compareEnabled={compareEnabled}
          compareTotal={timekeepingData?.comparison?.summary.total_changesets ?? null}
        />
        <TrendOverview
          title="Tasks Completed"
          data={(editingData?.tasks_over_time ?? []).map((d) => ({
            date: d.week,
            value: d.mapped,
          }))}
          color="#10b981"
          loading={editingLoading}
          compareEnabled={compareEnabled}
          compareTotal={editingData?.comparison?.summary.total_mapped ?? null}
        />
        <TrendOverview
          title="Validation Rate"
          data={(editingData?.tasks_over_time ?? []).map((d) => ({
            date: d.week,
            value: d.mapped > 0 ? Math.round((d.validated / d.mapped) * 100) : 0,
          }))}
          color="#8b5cf6"
          unit="%"
          loading={editingLoading}
          compareEnabled={compareEnabled}
          compareTotal={
            editingData?.comparison?.summary &&
            editingData.comparison.summary.total_mapped > 0
              ? Math.round(
                  (editingData.comparison.summary.total_validated /
                    editingData.comparison.summary.total_mapped) *
                    100
                )
              : null
          }
        />
      </div>

      {/* TABS */}
      <Tabs defaultValue="editing" value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="editing">Editing</TabsTrigger>
          <TabsTrigger value="community">Community</TabsTrigger>
          <TabsTrigger value="timekeeping">Timekeeping</TabsTrigger>
          <TabsTrigger value="imagery">Imagery</TabsTrigger>
          <TabsTrigger value="maproulette">MapRoulette</TabsTrigger>
        </TabsList>

        <TabsContent value="editing">
          <EditingTab
            loading={editingLoading}
            error={editingError}
            data={editingData}
            heatmapPoints={heatmapPoints}
            heatmapLoading={heatmapLoading}
            heatmapSummary={heatmapSummary}
            elementCategories={elementCategories}
            elementLastUpdated={elementLastUpdated}
            elementLoading={elementLoading}
            elementRefreshing={elementRefreshing}
            elementProgress={elementProgress}
            showRefreshModal={showRefreshModal}
            setShowRefreshModal={setShowRefreshModal}
            onStartAnalysis={handleStartAnalysis}
          />
        </TabsContent>

        <TabsContent value="community">
          <CommunityTab />
        </TabsContent>

        <TabsContent value="timekeeping">
          <TimekeepingTab
            loading={timekeepingLoading}
            error={timekeepingError}
            data={timekeepingData}
          />
        </TabsContent>

        <TabsContent value="imagery">
          <ImageryTab data={mapillaryData} loading={mapillaryLoading} />
        </TabsContent>

        <TabsContent value="maproulette">
          <MapRouletteTab loading={mrLoading} error={mrError} data={mrData} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
