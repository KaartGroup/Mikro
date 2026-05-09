"use client";

import { useState, useEffect, useCallback, useRef, Fragment } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
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
  useSyncCommunitySheet,
  useFetchCommunityEntries,
  useFetchChannels,
  useAddChannel,
  useRemoveChannel,
  useFetchChannelContent,
  useSummarizeChannel,
  useFetchAllSummaries,
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
  ChangesetHeatmapResponse,
  ElementAnalysisCategory,
  MapillaryStatsResponse,
  CommunityEntry,
  MonitoredChannel,
} from "@/types";
import {
  BarChart,
  Bar,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
} from "recharts";
import { formatNumber, formatCurrency } from "@/lib/utils";
import {
  COLORS,
  MR_COLORS,
  CATEGORY_COLORS,
  WEEKLY_TASK_COLORS,
  COMMUNITY_OUTREACH_COLORS,
} from "@/lib/chartColors";
import { ChartExportButton } from "@/components/admin/ChartExportButton";
import { TableExportButton } from "@/components/admin/TableExportButton";
import dynamic from "next/dynamic";

// Numeric axis-tick + tooltip formatter — keeps large numbers readable
// in charts (UI16). Applied to every Tooltip and to YAxis ticks where
// the domain is numeric. Signatures match the ones Recharts expects.
const chartNumberFmt = (n: number) => formatNumber(n).text;
const chartTooltipFmt = (v: number | string | undefined) => {
  if (typeof v === "number") return formatNumber(v).text;
  if (v == null) return "";
  return String(v);
};

const MappingHeatmap = dynamic(() => import("@/components/MappingHeatmap"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-48 bg-muted rounded-lg animate-pulse flex items-center justify-center">
      <p className="text-sm text-muted-foreground">Loading map...</p>
    </div>
  ),
});

// Color constants now live in `src/lib/chartColors.ts` so both this
// page and /admin/reports/weekly stay in sync on palette changes.

// ─── Mock Data (charts requiring Kibana / external sources) ──

const MOCK_COMMUNITY_EVENTS = [
  {
    id: 1,
    title: "Local Govt Mapping - Pesolis Renesta Pessidos Pestled",
    categories: ["Discussion", "OSM Community"],
    summary:
      "Discussed government mapping priorities with local officials. Focused on road network and administrative boundary improvements.",
    participants: { new: 4, return: 3, key: 2, total: 9 },
  },
  {
    id: 2,
    title: "Nentanga Group Makdedirps - Rafai Overt Reduce All Environments",
    categories: ["Event", "University"],
    summary:
      "University outreach event introducing OSM to geography students. Hands-on mapping session with tutorial walkthrough.",
    participants: { new: 8, return: 5, key: 1, total: 14 },
  },
  {
    id: 3,
    title: "Pessint bor Aggressive TTracking",
    categories: ["1:1 Interaction", "New User"],
    summary:
      "One-on-one onboarding session with new community mapper. Covered JOSM setup and basic editing workflow.",
    participants: { new: 1, return: 0, key: 0, total: 1 },
  },
];

const MOCK_OVERWRITES = [
  {
    id: 1,
    title: "Local Govt Mapping - Pesolis Renesta Pessidos Pestled",
    link: "#",
  },
];


const MOCK_COMMUNITY_OUTREACH = [
  {
    week: "1/19",
    "Wiki / OSM Documentation": 20,
    "Community QC": 40,
    "Community Events / Trainings / Meetings": 120,
    "Community Outreach - General": 231,
    newParticipants: 15,
    returnParticipants: 10,
  },
  {
    week: "1/26",
    "Wiki / OSM Documentation": 15,
    "Community QC": 35,
    "Community Events / Trainings / Meetings": 166,
    "Community Outreach - General": 244,
    newParticipants: 20,
    returnParticipants: 12,
  },
  {
    week: "2/2",
    "Wiki / OSM Documentation": 25,
    "Community QC": 50,
    "Community Events / Trainings / Meetings": 140,
    "Community Outreach - General": 177,
    newParticipants: 18,
    returnParticipants: 15,
  },
  {
    week: "2/9",
    "Wiki / OSM Documentation": 30,
    "Community QC": 45,
    "Community Events / Trainings / Meetings": 150,
    "Community Outreach - General": 200,
    newParticipants: 22,
    returnParticipants: 14,
  },
];

// ─── Helper Components ───────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  compareValue,
}: {
  label: string;
  value: string | number;
  sub?: string;
  compareValue?: number | null;
}) {
  const numValue = typeof value === "string" ? parseFloat(value.replace(/,/g, "")) : value;
  const delta =
    compareValue != null && compareValue > 0
      ? ((numValue - compareValue) / compareValue) * 100
      : null;

  return (
    <Card>
      <CardContent className="p-4 text-center">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold mt-1">{value}</p>
        {delta != null && (
          <p
            className={`text-xs font-medium mt-1 ${delta >= 0 ? "text-green-600" : "text-red-600"}`}
          >
            {delta >= 0 ? "\u25B2" : "\u25BC"} {Math.abs(delta).toFixed(1)}%
            <span className="text-muted-foreground font-normal ml-1">
              vs prior
            </span>
          </p>
        )}
        {sub && (
          <p className="text-xs text-muted-foreground mt-1">{sub}</p>
        )}
      </CardContent>
    </Card>
  );
}

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-kaart-orange" />
    </div>
  );
}

function CategoryBadge({ label }: { label: string }) {
  const colorMap: Record<string, string> = {
    Discussion: "bg-blue-600",
    "OSM Community": "bg-green-600",
    Event: "bg-purple-600",
    University: "bg-indigo-600",
    "1:1 Interaction": "bg-orange-600",
    "New User": "bg-teal-600",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-white ${colorMap[label] || "bg-gray-600"}`}
    >
      {label}
    </span>
  );
}

function MiniActivityChart({
  title,
  data,
}: {
  title: string;
  data: { week: string; deleted: number; added: number; modified: number }[];
}) {
  return (
    <Card>
      <CardContent className="p-3">
        <p className="text-xs font-semibold text-foreground mb-2">
          Team Activity: {title}
        </p>
        <div style={{ width: "100%", height: 140 }}>
          <ResponsiveContainer>
            <BarChart data={data} barSize={12}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="week" tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 9 }} width={35} />
              <Tooltip contentStyle={{ fontSize: 11 }} />
              <Legend
                wrapperStyle={{ fontSize: 9 }}
                iconSize={8}
              />
              <Bar
                dataKey="deleted"
                name="Deleted"
                fill={COLORS.deleted}
                stackId="a"
              />
              <Bar
                dataKey="added"
                name="Added"
                fill={COLORS.added}
                stackId="a"
              />
              <Bar
                dataKey="modified"
                name="Modified"
                fill={COLORS.modified}
                stackId="a"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function getProjectStatus(proj: {
  percent_mapped: number;
  percent_validated: number;
  status: boolean;
}): { label: string; className: string } {
  if (proj.percent_mapped >= 95 && proj.percent_validated >= 90)
    return {
      label: "Complete",
      className: "bg-green-100 text-green-800",
    };
  if (!proj.status)
    return {
      label: "Inactive",
      className: "bg-muted text-muted-foreground",
    };
  if (proj.percent_mapped < 15)
    return {
      label: "Stagnant",
      className: "bg-yellow-100 text-yellow-800",
    };
  return {
    label: "In Progress",
    className: "bg-blue-100 text-blue-800",
  };
}

// ─── Helper Functions ────────────────────────────────────────

// Calendar-aligned semantics (locked 2026-04-21 meeting):
//   Daily   = today (single day)
//   Weekly  = Sun → Sat of the CURRENT week (calendar week, NOT
//             rolling 7-day)
//   Monthly = month-to-date (1st of current month → today, calendar
//             month, NOT rolling 30-day)
function getDateRange(preset: "daily" | "weekly" | "monthly"): {
  start: string;
  end: string;
} {
  const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const now = new Date();
  const today = ymd(now);

  switch (preset) {
    case "daily":
      return { start: today, end: today };
    case "weekly": {
      const day = now.getDay(); // 0 = Sunday
      const sunday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
      const saturday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 6);
      return { start: ymd(sunday), end: ymd(saturday) };
    }
    case "monthly": {
      const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start: ymd(firstOfMonth), end: today };
    }
  }
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "\u2014";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Main Page Component ─────────────────────────────────────

export default function AdminReportsPage() {
  const router = useRouter();

  // Role-aware UI (F3 Phase 3.4): team_admin's reports are server-
  // scoped to managed-team members. Show empty state when they
  // manage no teams.
  const { role: viewerRole } = useCurrentUserRole();
  const { teams: managedTeams, loading: managedTeamsLoading } = useManagedTeams();
  const isTeamAdmin = viewerRole === "team_admin";

  // ── State ────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState("editing");
  const [datePreset, setDatePreset] = useState<
    "daily" | "weekly" | "monthly" | "custom"
  >("monthly");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [snapshotTime, setSnapshotTime] = useState<string | null>(null);
  const [editingData, setEditingData] =
    useState<EditingStatsResponse | null>(null);
  const [timekeepingData, setTimekeepingData] =
    useState<TimekeepingStatsResponse | null>(null);
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(
    new Set()
  );
  const [expandedEvents, setExpandedEvents] = useState<Set<number>>(
    new Set()
  );
  const [heatmapPoints, setHeatmapPoints] = useState<[number, number, number][]>([]);
  const [heatmapLoading, setHeatmapLoading] = useState(false);
  const [heatmapSummary, setHeatmapSummary] = useState<{ totalChangesets: number; totalChanges: number; usersWithData: number } | null>(null);
  const [elementCategories, setElementCategories] = useState<ElementAnalysisCategory[]>([]);
  const [elementLastUpdated, setElementLastUpdated] = useState<string | null>(null);
  const [elementLoading, setElementLoading] = useState(false);
  const [elementRefreshing, setElementRefreshing] = useState(false);
  const [elementProgress, setElementProgress] = useState<string | null>(null);
  const [showRefreshModal, setShowRefreshModal] = useState(false);
  const elementPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Pagination for tables
  const ROWS_PER_PAGE = 10;
  const [projectsTablePage, setProjectsTablePage] = useState(1);
  const [contributorsTablePage, setContributorsTablePage] = useState(1);
  const [timeTrackingPage, setTimeTrackingPage] = useState(1);
  const [tripsPage, setTripsPage] = useState(1);
  const [mrProjectsPage, setMrProjectsPage] = useState(1);
  const [mrContributorsPage, setMrContributorsPage] = useState(1);

  // Chart container refs — each wraps a ResponsiveContainer so the
  // ChartExportButton can grab the inner <svg> for PNG serialization.
  const editingTasksOverTimeRef = useRef<HTMLDivElement>(null);
  const timekeepingHoursByCategoryRef = useRef<HTMLDivElement>(null);
  const timekeepingTaskBreakdownRef = useRef<HTMLDivElement>(null);
  const timekeepingWeeklyActivityRef = useRef<HTMLDivElement>(null);
  const timekeepingWeeklyHoursRef = useRef<HTMLDivElement>(null);
  const timekeepingCommunityOutreachRef = useRef<HTMLDivElement>(null);
  const imageryWeeklyUploadsRef = useRef<HTMLDivElement>(null);
  const imageryByContributorRef = useRef<HTMLDivElement>(null);
  const mrTasksOverTimeRef = useRef<HTMLDivElement>(null);

  const [mrData, setMrData] = useState<EditingStatsResponse | null>(null);
  const [mapillaryData, setMapillaryData] = useState<MapillaryStatsResponse | null>(null);
  const [mapillaryLoading, setMapillaryLoading] = useState(false);

  // Cleanup polling interval on unmount
  useEffect(() => {
    return () => {
      if (elementPollRef.current) clearInterval(elementPollRef.current);
    };
  }, []);

  // ── Hooks ────────────────────────────────────────────────
  const {
    mutate: fetchEditing,
    loading: editingLoading,
    error: editingError,
  } = useFetchEditingStats();
  const {
    mutate: fetchMr,
    loading: mrLoading,
    error: mrError,
  } = useFetchMrStats();
  const {
    mutate: fetchTimekeeping,
    loading: timekeepingLoading,
    error: timekeepingError,
  } = useFetchTimekeepingStats();
  const { activeFilters, setActiveFilters, filtersBody, clearFilters } = useFilters();
  const { data: filterOptions, loading: filterOptionsLoading } = useFetchFilterOptions();
  const { mutate: fetchHeatmap } = useFetchChangesetHeatmap();
  const { mutate: fetchElementAnalysis } = useFetchElementAnalysis();
  const { mutate: queueElementAnalysis } = useQueueElementAnalysis();
  const { mutate: checkElementAnalysisStatus } = useCheckElementAnalysisStatus();
  const { mutate: fetchMapillaryStats } = useFetchMapillaryStats();
  const { mutate: syncCommunitySheet, loading: communitySyncLoading } = useSyncCommunitySheet();
  const { mutate: fetchCommunityEntries } = useFetchCommunityEntries();
  const [communityEntries, setCommunityEntries] = useState<CommunityEntry[]>([]);
  const [communityLoading, setCommunityLoading] = useState(false);

  // Channel monitor hooks
  const { data: channelsData, refetch: refetchChannels } = useFetchChannels();
  const { mutate: addChannel } = useAddChannel();
  const { mutate: removeChannel } = useRemoveChannel();
  const { mutate: fetchChannelContent } = useFetchChannelContent();
  const { mutate: summarizeChannel } = useSummarizeChannel();
  const { mutate: fetchAllSummaries } = useFetchAllSummaries();
  const [showManageChannels, setShowManageChannels] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelUrl, setNewChannelUrl] = useState("");
  const [channelSummaries, setChannelSummaries] = useState<Array<{ id: number; name: string; summary: string | null; summary_date: string | null; post_count: number; last_fetched: string | null }>>([]);
  const [refreshingChannelId, setRefreshingChannelId] = useState<number | null>(null);

  // ── Data Fetching ────────────────────────────────────────
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

    // Convert picked calendar days to local-midnight ISO UTC instants so
    // the backend's window lines up with the admin's wall clock.
    const startIso = dateInputToLocalStartIsoUtc(startDate);
    const endIso = dateInputToLocalEndIsoUtc(endDate);

    const params: Record<string, unknown> = {
      startDate: startIso,
      endDate: endIso,
      filters: filtersBody,
    };

    // Add comparison period if enabled (same length, immediately prior).
    if (compareEnabled) {
      const start = new Date(startDate + "T00:00:00");
      const end = new Date(endDate + "T00:00:00");
      const oneDay = 86400000;
      const periodMs = Math.max(end.getTime() - start.getTime(), oneDay);
      const compareEnd = new Date(start.getTime());
      const compareStart = new Date(start.getTime() - periodMs);
      const fmtDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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

        // Fetch heatmap data (non-blocking — runs alongside editing stats)
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

        // Fetch element analysis cache (non-blocking)
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

  // ── Computed: editing donut ──────────────────────────────
  const overallProgress = editingData
    ? (() => {
        const totalTasks = editingData.projects.reduce(
          (s, p) => s + p.total_tasks,
          0
        );
        const totalMapped = editingData.projects.reduce(
          (s, p) => s + p.tasks_mapped,
          0
        );
        const pct = totalTasks > 0 ? Math.round((totalMapped / totalTasks) * 100) : 0;
        return { totalTasks, totalMapped, pct };
      })()
    : null;

  const donutData = overallProgress
    ? [
        { name: "Completed", value: overallProgress.pct },
        { name: "Remaining", value: 100 - overallProgress.pct },
      ]
    : [];

  // ── Render ───────────────────────────────────────────────

  // team_admin with no managed teams → empty state.
  if (
    isTeamAdmin &&
    !managedTeamsLoading &&
    managedTeams.length === 0
  ) {
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
            {editingLoading || mrLoading || timekeepingLoading
              ? "Refreshing..."
              : "Refresh"}
          </button>
        </div>
      </div>

      {/* CONTROLS ROW */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            {/* Date range picker. Each preset's resolved date window
                is appended to its label so admins can verify the
                semantics at a glance ("Monthly (Apr 1 – 30, 2026)").
                Active range is also shown as a caption row below. */}
            <div className="flex items-center gap-2">
              {(["daily", "weekly", "monthly", "custom"] as const).map(
                (preset) => {
                  let range = "";
                  if (preset === "custom") {
                    range = formatDateRangeShort(customStart, customEnd, {
                      emptyLabel: "",
                    });
                  } else {
                    const r = getDateRange(preset);
                    range = formatDateRangeShort(r.start, r.end, {
                      emptyLabel: "",
                    });
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
                            datePreset === preset
                              ? "text-white/80"
                              : "text-muted-foreground/70"
                          }`}
                        >
                          ({range})
                        </span>
                      )}
                    </button>
                  );
                }
              )}
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

            {/* Resolved-range caption — explicit statement of the date
                window the active preset implies. */}
            {(() => {
              const r =
                datePreset === "custom"
                  ? { start: customStart, end: customEnd }
                  : getDateRange(datePreset);
              const range = formatDateRangeShort(r.start, r.end, {
                emptyLabel: "",
              });
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
              {compareEnabled && (() => {
                let s: string, e: string;
                if (datePreset === "custom") {
                  s = customStart; e = customEnd;
                } else {
                  const r = getDateRange(datePreset);
                  s = r.start; e = r.end;
                }
                const start = new Date(s + "T00:00:00");
                const end = new Date(e + "T00:00:00");
                const oneDay = 86400000;
                const periodMs = Math.max(end.getTime() - start.getTime(), oneDay);
                const cEnd = new Date(start.getTime());
                const cStart = new Date(start.getTime() - periodMs);
                const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
                dimensions={filterOptions?.dimensions ? Object.entries(filterOptions.dimensions).map(([key, values]) => ({
                  key,
                  label: key.charAt(0).toUpperCase() + key.slice(1),
                  options: Array.isArray(values)
                    ? values.map((v) =>
                        typeof v === 'string'
                          ? { value: v, label: v }
                          : { value: String(v.id ?? v.value ?? v.name), label: v.name }
                      )
                    : [],
                })) : []}
                activeFilters={activeFilters}
                onChange={setActiveFilters}
                loading={filterOptionsLoading}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* TABS */}
      <Tabs
        defaultValue="editing"
        value={activeTab}
        onValueChange={setActiveTab}
      >
        <TabsList>
          <TabsTrigger value="editing">Editing</TabsTrigger>
          <TabsTrigger value="community">Community</TabsTrigger>
          <TabsTrigger value="timekeeping">Timekeeping</TabsTrigger>
          <TabsTrigger value="imagery">Imagery</TabsTrigger>
          <TabsTrigger value="maproulette">MapRoulette</TabsTrigger>
        </TabsList>

        {/* ═══════ EDITING TAB ═══════ */}
        <TabsContent value="editing">
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
              {/* ── Hero Row: Donut + Heatmap + Changeset Totals ── */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Project Progress Donut */}
                <Card>
                  <CardHeader className="pb-0">
                    <CardTitle className="text-base">
                      Project Progress
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col items-center">
                    <div style={{ width: 180, height: 180, position: "relative" }}>
                      <ResponsiveContainer>
                        <PieChart>
                          <Pie
                            data={donutData}
                            cx="50%"
                            cy="50%"
                            innerRadius={55}
                            outerRadius={80}
                            startAngle={90}
                            endAngle={-270}
                            dataKey="value"
                            strokeWidth={0}
                          >
                            <Cell fill={COLORS.mapped} />
                            <Cell fill="#e5e7eb" />
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-3xl font-bold text-foreground">
                          {overallProgress?.pct ?? 0}%
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Completed
                        </span>
                      </div>
                    </div>
                    <div className="text-center mt-2 space-y-1">
                      <p className="text-sm text-muted-foreground">
                        <Val>{formatNumber(overallProgress?.totalMapped)}</Val> /{" "}
                        <Val>{formatNumber(overallProgress?.totalTasks)}</Val> tasks
                      </p>
                      <p className="text-sm font-medium">
                        <Val>{formatNumber(editingData.summary.active_projects)}</Val> active projects
                      </p>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-0">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">
                        Map of changeset centroids
                      </CardTitle>
                      {heatmapSummary && !heatmapLoading && (
                        <span className="text-xs text-muted-foreground">
                          {heatmapSummary.usersWithData} users &middot;{" "}
                          <Val>{formatNumber(heatmapSummary.totalChangesets)}</Val> changesets
                        </span>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    {heatmapLoading ? (
                      <div className="w-full h-48 flex items-center justify-center gap-2">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-kaart-orange" />
                        <span className="text-sm text-muted-foreground">
                          Fetching changesets from OSM...
                        </span>
                      </div>
                    ) : (
                      <MappingHeatmap points={heatmapPoints} height="200px" />
                    )}
                  </CardContent>
                </Card>

                {/* Changeset Totals */}
                <Card>
                  <CardHeader className="pb-0">
                    <CardTitle className="text-base">
                      Changeset totals
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-foreground leading-relaxed mt-2">
                      During this time period, a total of{" "}
                      <span className="font-bold text-foreground">
                        <Val>{formatNumber(editingData.summary.total_mapped)}</Val>
                      </span>{" "}
                      tasks were mapped across{" "}
                      <span className="font-bold text-foreground">
                        <Val>{formatNumber(editingData.summary.active_projects)}</Val>
                      </span>{" "}
                      active projects, with{" "}
                      <span className="font-bold text-foreground">
                        <Val>{formatNumber(editingData.summary.total_validated)}</Val>
                      </span>{" "}
                      tasks validated and{" "}
                      <span className="font-bold text-foreground">
                        <Val>{formatNumber(editingData.summary.total_invalidated)}</Val>
                      </span>{" "}
                      invalidated.
                    </p>
                    <div className="grid grid-cols-2 gap-3 mt-4">
                      <div className="bg-muted rounded-lg p-3 text-center">
                        <p className="text-xl font-bold text-foreground">
                          <Val>{formatNumber(editingData.summary.total_mapped)}</Val>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Tasks Mapped
                        </p>
                        {editingData.comparison?.summary && (() => {
                          const prev = editingData.comparison.summary.total_mapped;
                          const curr = editingData.summary.total_mapped;
                          const delta = prev > 0 ? ((curr - prev) / prev) * 100 : null;
                          return delta != null ? (
                            <p className={`text-xs font-medium mt-1 ${delta >= 0 ? "text-green-600" : "text-red-600"}`}>
                              {delta >= 0 ? "\u25B2" : "\u25BC"} {Math.abs(delta).toFixed(1)}%
                            </p>
                          ) : null;
                        })()}
                      </div>
                      <div className="bg-muted rounded-lg p-3 text-center">
                        <p className="text-xl font-bold text-foreground">
                          <Val>{formatNumber(editingData.summary.total_validated)}</Val>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Validated
                        </p>
                        {editingData.comparison?.summary && (() => {
                          const prev = editingData.comparison.summary.total_validated;
                          const curr = editingData.summary.total_validated;
                          const delta = prev > 0 ? ((curr - prev) / prev) * 100 : null;
                          return delta != null ? (
                            <p className={`text-xs font-medium mt-1 ${delta >= 0 ? "text-green-600" : "text-red-600"}`}>
                              {delta >= 0 ? "\u25B2" : "\u25BC"} {Math.abs(delta).toFixed(1)}%
                            </p>
                          ) : null;
                        })()}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Tasks Over Time Bar Chart */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>Tasks Over Time</CardTitle>
                  <ChartExportButton containerRef={editingTasksOverTimeRef} filename="editing-tasks-over-time" />
                </CardHeader>
                <CardContent>
                  {editingData.tasks_over_time.length > 0 ? (
                    <div ref={editingTasksOverTimeRef} style={{ width: "100%", height: 300 }}>
                      <ResponsiveContainer>
                        <BarChart data={editingData.tasks_over_time}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis
                            dataKey="week"
                            tick={{ fontSize: 12 }}
                            tickFormatter={(v: string) =>
                              new Date(
                                v + "T00:00:00"
                              ).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                              })
                            }
                          />
                          <YAxis tick={{ fontSize: 12 }} tickFormatter={chartNumberFmt} />
                          <Tooltip
                            labelFormatter={(v) =>
                              new Date(
                                String(v) + "T00:00:00"
                              ).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              })
                            }
                            formatter={chartTooltipFmt}
                          />
                          <Legend />
                          <Bar
                            dataKey="mapped"
                            name="Mapped"
                            fill={COLORS.mapped}
                          />
                          <Bar
                            dataKey="validated"
                            name="Validated"
                            fill={COLORS.validated}
                          />
                          <Bar
                            dataKey="invalidated"
                            name="Invalidated"
                            fill={COLORS.invalidated}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No task data for this period.
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Detailed Project Table */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>
                    Detailed Project Table (
                    {editingData.projects.length})
                  </CardTitle>
                  <TableExportButton
                    rows={editingData.projects as unknown as Array<Record<string, unknown>>}
                    columns={[
                      { key: "name", label: "Project" },
                      { key: "total_tasks", label: "Total Tasks" },
                      { key: "mapped_tasks", label: "Mapped" },
                      { key: "validated_tasks", label: "Validated" },
                      { key: "invalidated_tasks", label: "Invalidated" },
                      { key: "mapping_rate_per_task", label: "Mapping Rate" },
                      { key: "validation_rate_per_task", label: "Validation Rate" },
                    ]}
                    filename="editing-projects"
                  />
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm" style={{ minWidth: 500 }}>
                      <thead className="bg-muted border-b border-border">
                        <tr>
                          <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">
                            Project Name
                          </th>
                          <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">
                            Status
                          </th>
                          <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">
                            Progress
                          </th>
                          <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">
                            % Validated
                          </th>
                          <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">
                            Time per Task
                          </th>
                          <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">
                            Map Rate
                          </th>
                          <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">
                            Val Rate
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border bg-card">
                        {editingData.projects.slice((projectsTablePage - 1) * ROWS_PER_PAGE, projectsTablePage * ROWS_PER_PAGE).map((proj) => {
                          const status = getProjectStatus(proj);
                          return (
                            <tr key={proj.id}>
                              <td className="px-6 py-4">
                                <div className="flex items-center gap-2">
                                  <Link
                                    href={`/admin/projects/${proj.id}`}
                                    className="font-medium text-kaart-orange hover:underline"
                                    title="View project details"
                                  >
                                    {proj.name}
                                  </Link>
                                  {proj.url && (
                                    <a
                                      href={proj.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-muted-foreground hover:text-foreground"
                                      title={proj.url?.includes("maproulette") ? "Open in MapRoulette" : "Open in Tasking Manager"}
                                    >
                                      ↗
                                    </a>
                                  )}
                                </div>
                              </td>
                              <td className="px-6 py-4">
                                <span
                                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${status.className}`}
                                >
                                  {status.label}
                                </span>
                              </td>
                              <td className="px-6 py-4">
                                <div className="flex items-center gap-2">
                                  <div
                                    className="flex-1 h-2 bg-muted rounded-full overflow-hidden"
                                    style={{ minWidth: 80 }}
                                  >
                                    <div
                                      className="h-full bg-kaart-orange rounded-full transition-all"
                                      style={{
                                        width: `${Math.min(proj.percent_mapped, 100)}%`,
                                      }}
                                    />
                                  </div>
                                  <span className="text-xs text-muted-foreground w-10 text-right">
                                    {Math.min(proj.percent_mapped, 100)}%
                                  </span>
                                </div>
                              </td>
                              <td className="px-6 py-4">
                                <div className="flex items-center gap-2">
                                  <div
                                    className="flex-1 h-2 bg-muted rounded-full overflow-hidden"
                                    style={{ minWidth: 60 }}
                                  >
                                    <div
                                      className="h-full bg-blue-500 rounded-full transition-all"
                                      style={{
                                        width: `${Math.min(proj.percent_validated, 100)}%`,
                                      }}
                                    />
                                  </div>
                                  <span className="text-xs text-muted-foreground w-10 text-right">
                                    {Math.min(proj.percent_validated, 100)}%
                                  </span>
                                </div>
                              </td>
                              <td className="px-6 py-4 text-sm text-muted-foreground">
                                {proj.avg_time_per_task
                                  ? proj.avg_time_per_task >= 3600
                                    ? `${Math.floor(proj.avg_time_per_task / 3600)}h ${Math.floor((proj.avg_time_per_task % 3600) / 60)}m`
                                    : proj.avg_time_per_task >= 60
                                      ? `${Math.floor(proj.avg_time_per_task / 60)}m`
                                      : `${proj.avg_time_per_task}s`
                                  : "\u2014"}
                              </td>
                              <td className="px-6 py-4 text-foreground">
                                <Val>{formatCurrency(proj.mapping_rate)}</Val>
                              </td>
                              <td className="px-6 py-4 text-foreground">
                                <Val>{formatCurrency(proj.validation_rate)}</Val>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {editingData.projects.length > ROWS_PER_PAGE && (
                    <div className="flex items-center justify-between px-6 py-3 text-sm text-muted-foreground">
                      <span>Showing {(projectsTablePage - 1) * ROWS_PER_PAGE + 1}-{Math.min(projectsTablePage * ROWS_PER_PAGE, editingData.projects.length)} of {editingData.projects.length}</span>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" disabled={projectsTablePage === 1}
                          onClick={() => setProjectsTablePage(p => p - 1)}>Previous</Button>
                        <span className="flex items-center px-2">Page {projectsTablePage} of {Math.ceil(editingData.projects.length / ROWS_PER_PAGE)}</span>
                        <Button variant="outline" size="sm" disabled={projectsTablePage === Math.ceil(editingData.projects.length / ROWS_PER_PAGE)}
                          onClick={() => setProjectsTablePage(p => p + 1)}>Next</Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Top Contributors Table */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>Top Contributors</CardTitle>
                  <TableExportButton
                    rows={editingData.top_contributors as unknown as Array<Record<string, unknown>>}
                    columns={[
                      { key: "name", label: "Name" },
                      { key: "osm_username", label: "OSM Username" },
                      { key: "mapped", label: "Mapped" },
                      { key: "validated", label: "Validated" },
                      { key: "invalidated", label: "Invalidated" },
                      { key: "hours", label: "Hours" },
                    ]}
                    filename="editing-top-contributors"
                  />
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm" style={{ minWidth: 500 }}>
                      <thead className="bg-muted border-b border-border">
                        <tr>
                          <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">
                            Name
                          </th>
                          <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">
                            OSM Username
                          </th>
                          <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">
                            Mapped
                          </th>
                          <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">
                            Validated
                          </th>
                          <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">
                            Invalidated
                          </th>
                          <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">
                            Hours
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border bg-card">
                        {editingData.top_contributors.slice((contributorsTablePage - 1) * ROWS_PER_PAGE, contributorsTablePage * ROWS_PER_PAGE).map((c) => (
                          <tr
                            key={c.osm_username}
                            className={
                              c.user_id
                                ? "cursor-pointer hover:bg-muted/50 transition-colors"
                                : ""
                            }
                            onClick={() =>
                              c.user_id &&
                              router.push(
                                `/admin/users/${encodeURIComponent(c.user_id)}`
                              )
                            }
                          >
                            <td className="px-6 py-4">
                              <span
                                className={
                                  c.user_id
                                    ? "font-medium text-kaart-orange"
                                    : "font-medium text-foreground"
                                }
                              >
                                {c.user_name}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-foreground">
                              {c.osm_username}
                            </td>
                            <td className="px-6 py-4 text-foreground">
                              <Val>{formatNumber(c.tasks_mapped)}</Val>
                            </td>
                            <td className="px-6 py-4 text-foreground">
                              <Val>{formatNumber(c.tasks_validated)}</Val>
                            </td>
                            <td className="px-6 py-4 text-foreground">
                              <Val>{formatNumber(c.tasks_invalidated)}</Val>
                            </td>
                            <td className="px-6 py-4 text-foreground">
                              <Val>{formatNumber(c.total_hours)}</Val>h
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {editingData.top_contributors.length > ROWS_PER_PAGE && (
                    <div className="flex items-center justify-between px-6 py-3 text-sm text-muted-foreground">
                      <span>Showing {(contributorsTablePage - 1) * ROWS_PER_PAGE + 1}-{Math.min(contributorsTablePage * ROWS_PER_PAGE, editingData.top_contributors.length)} of {editingData.top_contributors.length}</span>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" disabled={contributorsTablePage === 1}
                          onClick={() => setContributorsTablePage(p => p - 1)}>Previous</Button>
                        <span className="flex items-center px-2">Page {contributorsTablePage} of {Math.ceil(editingData.top_contributors.length / ROWS_PER_PAGE)}</span>
                        <Button variant="outline" size="sm" disabled={contributorsTablePage === Math.ceil(editingData.top_contributors.length / ROWS_PER_PAGE)}
                          onClick={() => setContributorsTablePage(p => p + 1)}>Next</Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* ── 8 Team Activity Charts (live from worker cache) ── */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-lg font-semibold">
                      Editing Activity by Element Type
                    </h3>
                    {elementLastUpdated && (
                      <p className="text-xs text-muted-foreground">
                        Last updated: {formatDateTime(elementLastUpdated)}
                      </p>
                    )}
                    {!elementLastUpdated && !elementLoading && (
                      <p className="text-xs text-muted-foreground">
                        No cached data yet — click Refresh to run analysis
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {elementRefreshing && elementProgress && (
                      <span className="text-xs text-muted-foreground">
                        {elementProgress}
                      </span>
                    )}
                    <button
                      onClick={() => setShowRefreshModal(true)}
                      disabled={elementRefreshing}
                      className="inline-flex items-center px-3 py-1.5 rounded-lg bg-muted text-foreground text-sm font-medium hover:bg-muted/80 transition-colors disabled:opacity-50"
                    >
                      {elementRefreshing ? (
                        <>
                          <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-kaart-orange mr-2" />
                          Analyzing...
                        </>
                      ) : (
                        "Refresh Analysis"
                      )}
                    </button>
                  </div>
                </div>
                {elementLoading ? (
                  <div className="flex items-center justify-center h-32 gap-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-kaart-orange" />
                    <span className="text-sm text-muted-foreground">Loading cached data...</span>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {elementCategories.map((chart) => (
                      <MiniActivityChart
                        key={chart.title}
                        title={chart.title}
                        data={chart.data}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Refresh Analysis Warning Modal */}
              {showRefreshModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                  <div className="bg-card border border-border rounded-xl shadow-xl max-w-md mx-4 p-6">
                    <h3 className="text-lg font-semibold text-foreground mb-3">
                      Refresh Element Analysis
                    </h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      This will re-analyze all changesets from the OSM API for
                      the last 4 weeks. The process runs in the background and
                      typically takes 2-5 minutes depending on the number of
                      active mappers and their changeset volume.
                    </p>
                    <p className="text-sm text-muted-foreground mb-6">
                      This analysis also runs automatically every night at
                      midnight MST.
                    </p>
                    <div className="flex justify-end gap-3">
                      <button
                        onClick={() => setShowRefreshModal(false)}
                        className="px-4 py-2 rounded-lg bg-muted text-foreground text-sm font-medium hover:bg-muted/80 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={async () => {
                          setShowRefreshModal(false);
                          setElementRefreshing(true);
                          setElementProgress("Queuing analysis...");
                          try {
                            const queueRes = await queueElementAnalysis({});
                            if (queueRes?.status === 200 && queueRes.job_id) {
                              // Poll for status every 5 seconds
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
                                      // Refetch cached data
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
                        }}
                        className="px-4 py-2 rounded-lg bg-kaart-orange text-white text-sm font-medium hover:bg-kaart-orange-dark transition-colors"
                      >
                        Start Analysis
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <Card>
              <CardContent className="p-12 text-center">
                <p className="text-muted-foreground">
                  Select a date range and click Refresh to load editing
                  statistics.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ═══════ COMMUNITY TAB ═══════ */}
        <TabsContent value="community">
          <div className="space-y-6">
            {/* Header with sync controls */}
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {communityEntries.length > 0
                  ? `${communityEntries.length} entries synced from Google Sheet`
                  : "No community data synced yet — click Sync to pull from Google Sheet"}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={async () => {
                    try {
                      await syncCommunitySheet({});
                      // Re-fetch entries after sync
                      setCommunityLoading(true);
                      const result = await fetchCommunityEntries({});
                      if (result?.entries) setCommunityEntries(result.entries);
                      setCommunityLoading(false);
                    } catch {
                      setCommunityLoading(false);
                    }
                  }}
                  disabled={communitySyncLoading}
                  className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {communitySyncLoading ? "Syncing..." : "Sync from Sheet"}
                </button>
                <button
                  onClick={async () => {
                    setCommunityLoading(true);
                    try {
                      const result = await fetchCommunityEntries({});
                      if (result?.entries) setCommunityEntries(result.entries);
                    } catch { /* ignore */ }
                    setCommunityLoading(false);
                  }}
                  disabled={communityLoading}
                  className="px-3 py-1.5 rounded-lg bg-muted text-sm font-medium hover:bg-muted/80 transition-colors disabled:opacity-50"
                >
                  {communityLoading ? "Loading..." : "Refresh"}
                </button>
              </div>
            </div>

            {/* Stat Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <StatCard
                label="Total Entries"
                value={communityEntries.length}
              />
              <StatCard
                label="Edited"
                value={communityEntries.filter((e) => e.is_edited).length}
              />
              <StatCard
                label="Entry Types"
                value={[...new Set(communityEntries.map((e) => e.entry_type))].length}
              />
            </div>

            {/* Entries Table */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Community Entries</CardTitle>
              </CardHeader>
              <CardContent>
                {communityEntries.length > 0 ? (
                  <div className="space-y-2" style={{ maxHeight: 600, overflowY: "auto" }}>
                    {communityEntries.map((entry) => {
                      const data = entry.edited_data || entry.original_data;
                      const isExpanded = expandedEvents.has(entry.id);
                      return (
                        <div
                          key={entry.id}
                          className={`border rounded-lg p-3 ${entry.is_edited ? "border-l-4 border-l-blue-500" : "border-border"}`}
                        >
                          <div
                            className="flex items-center justify-between cursor-pointer"
                            onClick={() => {
                              const next = new Set(expandedEvents);
                              if (isExpanded) next.delete(entry.id);
                              else next.add(entry.id);
                              setExpandedEvents(next);
                            }}
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground text-xs">
                                {isExpanded ? "\u25BC" : "\u25B6"}
                              </span>
                              <span className="text-sm font-medium">
                                {Object.values(data)[1] || Object.values(data)[0] || "Entry"}
                              </span>
                              <span className="text-xs bg-muted px-2 py-0.5 rounded">
                                {entry.entry_type}
                              </span>
                              {entry.is_edited && (
                                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                                  Edited
                                </span>
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {entry.submitted_at
                                ? new Date(entry.submitted_at).toLocaleDateString()
                                : "No date"}
                            </span>
                          </div>
                          {isExpanded && (
                            <div className="mt-2 pt-2 border-t border-border">
                              <div className="grid grid-cols-2 gap-2 text-sm">
                                {Object.entries(data).map(([key, value]) => (
                                  <div key={key}>
                                    <span className="text-xs text-muted-foreground">{key}:</span>
                                    <p className="text-sm">{value || "\u2014"}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-8">
                    No community entries. Click &quot;Sync from Sheet&quot; to import data from Google Sheets.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* ── Channel Summaries Section ── */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Channel Summaries</CardTitle>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={async () => {
                        try {
                          const result = await fetchAllSummaries({});
                          if (result?.summaries) setChannelSummaries(result.summaries);
                        } catch { /* ignore */ }
                      }}
                      className="text-xs px-2 py-1 rounded bg-muted hover:bg-muted/80 transition-colors"
                    >
                      Load Summaries
                    </button>
                    <button
                      onClick={() => setShowManageChannels(true)}
                      className="text-xs px-2 py-1 rounded bg-muted hover:bg-muted/80 transition-colors"
                      title="Manage Channels"
                    >
                      Manage Channels
                    </button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {channelSummaries.length > 0 ? (
                  <div className="space-y-3">
                    {channelSummaries.map((ch) => (
                      <div key={ch.id} className="border border-border rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{ch.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {ch.post_count} posts
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                              {ch.summary_date
                                ? `Summarized ${new Date(ch.summary_date).toLocaleDateString()}`
                                : "Not yet summarized"}
                            </span>
                            <button
                              onClick={async () => {
                                setRefreshingChannelId(ch.id);
                                try {
                                  await fetchChannelContent({ channel_id: ch.id });
                                  await summarizeChannel({ channel_id: ch.id });
                                  const result = await fetchAllSummaries({});
                                  if (result?.summaries) setChannelSummaries(result.summaries);
                                } catch { /* ignore */ }
                                setRefreshingChannelId(null);
                              }}
                              disabled={refreshingChannelId === ch.id}
                              className="text-xs px-2 py-1 rounded bg-kaart-orange text-white hover:bg-kaart-orange-dark transition-colors disabled:opacity-50"
                            >
                              {refreshingChannelId === ch.id ? "..." : "Refresh"}
                            </button>
                          </div>
                        </div>
                        {ch.summary ? (
                          <p className="text-sm text-muted-foreground whitespace-pre-line">
                            {ch.summary}
                          </p>
                        ) : (
                          <p className="text-sm text-muted-foreground italic">
                            No summary yet — click Refresh to fetch and summarize
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-4 text-sm">
                    {channelsData?.channels?.length
                      ? "Click \"Load Summaries\" to view channel summaries"
                      : "No channels configured. Click \"Manage Channels\" to add OSM channels to monitor."}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Manage Channels Modal */}
            {showManageChannels && (
              <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                <div className="bg-background rounded-xl shadow-xl max-w-lg w-full max-h-[80vh] overflow-y-auto">
                  <div className="p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold">Manage Channels</h3>
                      <button
                        onClick={() => setShowManageChannels(false)}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        &times;
                      </button>
                    </div>

                    {/* Add channel form */}
                    <div className="border border-border rounded-lg p-3 space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Add Channel</p>
                      <input
                        type="text"
                        value={newChannelName}
                        onChange={(e) => setNewChannelName(e.target.value)}
                        placeholder="Channel name (e.g. OSM Forum - Albania)"
                        className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-kaart-orange"
                      />
                      <input
                        type="text"
                        value={newChannelUrl}
                        onChange={(e) => setNewChannelUrl(e.target.value)}
                        placeholder="RSS feed URL"
                        className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-kaart-orange"
                      />
                      <button
                        onClick={async () => {
                          if (!newChannelName || !newChannelUrl) return;
                          try {
                            await addChannel({ name: newChannelName, url: newChannelUrl, channel_type: "rss" });
                            setNewChannelName("");
                            setNewChannelUrl("");
                            refetchChannels();
                          } catch { /* ignore */ }
                        }}
                        className="px-3 py-1.5 text-sm rounded-lg bg-kaart-orange text-white hover:bg-kaart-orange-dark transition-colors"
                      >
                        Add
                      </button>
                    </div>

                    {/* Channel list */}
                    <div className="space-y-2">
                      {channelsData?.channels?.map((ch) => (
                        <div
                          key={ch.id}
                          className="flex items-center justify-between p-2 border border-border rounded-lg"
                        >
                          <div>
                            <p className="text-sm font-medium">{ch.name}</p>
                            <p className="text-xs text-muted-foreground truncate max-w-xs">
                              {ch.url}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={async () => {
                                try {
                                  await removeChannel({ channel_id: ch.id });
                                  refetchChannels();
                                } catch { /* ignore */ }
                              }}
                              className="text-xs text-red-500 hover:text-red-700"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}
                      {(!channelsData?.channels || channelsData.channels.length === 0) && (
                        <p className="text-sm text-muted-foreground text-center py-2">
                          No channels configured yet
                        </p>
                      )}
                    </div>

                    <button
                      onClick={() => setShowManageChannels(false)}
                      className="w-full px-3 py-1.5 text-sm rounded-lg bg-muted hover:bg-muted/80 transition-colors"
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ═══════ TIMEKEEPING TAB ═══════ */}
        <TabsContent value="timekeeping">
          {timekeepingLoading && !timekeepingData ? (
            <LoadingSpinner />
          ) : timekeepingError ? (
            <Card>
              <CardContent className="p-8 text-center text-red-500">
                Failed to load timekeeping stats: {timekeepingError}
              </CardContent>
            </Card>
          ) : timekeepingData ? (
            <div className="space-y-6">
              {/* ── Top Row: Totals + Task Breakdown ── */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Total Team Hours + Summary Text */}
                <Card>
                  <CardHeader className="pb-0">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">Totals</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground mb-1">
                      Total Team Hours
                    </p>
                    <div className="flex items-baseline gap-3">
                      <p className="text-3xl font-bold">
                        <Val>{formatNumber(timekeepingData.summary.total_hours)}</Val>h
                      </p>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          timekeepingData.summary
                            .weekly_rate_change_percent >= 0
                            ? "bg-green-100 text-green-800"
                            : "bg-red-100 text-red-800"
                        }`}
                      >
                        {timekeepingData.summary
                          .weekly_rate_change_percent >= 0
                          ? "+"
                          : ""}
                        {timekeepingData.summary.weekly_rate_change_percent}
                        %
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      <Val>{formatNumber(timekeepingData.summary.total_entries)}</Val>{" "}
                      entries
                    </p>
                    <div className="mt-4 p-3 bg-muted rounded-lg">
                      <p className="text-sm text-foreground leading-relaxed">
                        During this time period, a total of{" "}
                        <span className="font-bold">
                          {formatNumber(timekeepingData.summary.total_hours).text}{" "}
                          hours
                        </span>{" "}
                        were logged. This is{" "}
                        <span className="font-bold">100.0%</span> of the
                        total hours logged.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3 mt-4">
                      <div className="text-center">
                        <p className="text-xl font-bold text-foreground">
                          <Val>{formatNumber(timekeepingData.summary.total_changesets)}</Val>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Changesets
                        </p>
                        {timekeepingData.comparison?.summary && (() => {
                          const prev = timekeepingData.comparison.summary.total_changesets;
                          const curr = timekeepingData.summary.total_changesets;
                          const delta = prev > 0 ? ((curr - prev) / prev) * 100 : null;
                          return delta != null ? (
                            <p className={`text-xs font-medium mt-1 ${delta >= 0 ? "text-green-600" : "text-red-600"}`}>
                              {delta >= 0 ? "\u25B2" : "\u25BC"} {Math.abs(delta).toFixed(1)}%
                            </p>
                          ) : null;
                        })()}
                      </div>
                      <div className="text-center">
                        <p className="text-xl font-bold text-foreground">
                          <Val>{formatNumber(timekeepingData.summary.total_changes)}</Val>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Changes
                        </p>
                        {timekeepingData.comparison?.summary && (() => {
                          const prev = timekeepingData.comparison.summary.total_changes;
                          const curr = timekeepingData.summary.total_changes;
                          const delta = prev > 0 ? ((curr - prev) / prev) * 100 : null;
                          return delta != null ? (
                            <p className={`text-xs font-medium mt-1 ${delta >= 0 ? "text-green-600" : "text-red-600"}`}>
                              {delta >= 0 ? "\u25B2" : "\u25BC"} {Math.abs(delta).toFixed(1)}%
                            </p>
                          ) : null;
                        })()}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Hours by Category — Horizontal BarChart */}
                <Card>
                  <CardHeader className="pb-0 flex flex-row items-center justify-between">
                    <CardTitle className="text-base">Task</CardTitle>
                    <ChartExportButton containerRef={timekeepingHoursByCategoryRef} filename="timekeeping-hours-by-category" />
                  </CardHeader>
                  <CardContent>
                    {timekeepingData.hours_by_category.length > 0 ? (
                      <div
                        ref={timekeepingHoursByCategoryRef}
                        style={{
                          width: "100%",
                          height: Math.max(
                            200,
                            timekeepingData.hours_by_category.length * 40
                          ),
                        }}
                      >
                        <ResponsiveContainer>
                          <BarChart
                            data={timekeepingData.hours_by_category}
                            layout="vertical"
                          >
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis
                              type="number"
                              tick={{ fontSize: 11 }}
                              tickFormatter={chartNumberFmt}
                            />
                            <YAxis
                              type="category"
                              dataKey="category"
                              tick={{ fontSize: 10 }}
                              width={160}
                              tickFormatter={(v: string) =>
                                v.charAt(0).toUpperCase() + v.slice(1)
                              }
                            />
                            <Tooltip
                              formatter={(value) => [
                                `${chartTooltipFmt(value as number)}h`,
                                "Hours",
                              ]}
                            />
                            <Bar dataKey="hours" name="Hours">
                              {timekeepingData.hours_by_category.map(
                                (entry, index) => (
                                  <Cell
                                    key={index}
                                    fill={
                                      CATEGORY_COLORS[
                                        entry.category
                                      ] || CATEGORY_COLORS.other
                                    }
                                  />
                                )
                              )}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-8">
                        No time tracking data for this period.
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* ── Middle Row: 3 Charts ── */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Weekly Team Activity — ComposedChart */}
                <Card>
                  <CardHeader className="pb-0 flex flex-row items-center justify-between">
                    <CardTitle className="text-base">
                      Weekly Team Activity
                    </CardTitle>
                    <ChartExportButton containerRef={timekeepingWeeklyActivityRef} filename="timekeeping-weekly-activity" />
                  </CardHeader>
                  <CardContent>
                    {timekeepingData.weekly_activity.length > 0 ? (
                      <div ref={timekeepingWeeklyActivityRef} style={{ width: "100%", height: 280 }}>
                        <ResponsiveContainer>
                          <ComposedChart
                            data={timekeepingData.weekly_activity}
                          >
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis
                              dataKey="week"
                              tick={{ fontSize: 10 }}
                              tickFormatter={(v: string) =>
                                new Date(
                                  v + "T00:00:00"
                                ).toLocaleDateString("en-US", {
                                  month: "numeric",
                                  day: "numeric",
                                })
                              }
                            />
                            <YAxis
                              yAxisId="left"
                              tick={{ fontSize: 10 }}
                              tickFormatter={chartNumberFmt}
                            />
                            <YAxis
                              yAxisId="right"
                              orientation="right"
                              tick={{ fontSize: 10 }}
                              tickFormatter={chartNumberFmt}
                            />
                            <Tooltip
                              labelFormatter={(v) =>
                                new Date(
                                  String(v) + "T00:00:00"
                                ).toLocaleDateString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                })
                              }
                              formatter={chartTooltipFmt}
                            />
                            <Legend
                              wrapperStyle={{ fontSize: 10 }}
                            />
                            <Bar
                              yAxisId="left"
                              dataKey="hours"
                              name="Hours"
                              fill={COLORS.hours}
                            />
                            <Line
                              yAxisId="right"
                              dataKey="changes_per_hour"
                              name="Changes/Hour"
                              stroke={COLORS.mapped}
                              strokeWidth={2}
                              dot={{ r: 3 }}
                            />
                            <Line
                              yAxisId="right"
                              dataKey="changes_per_changeset"
                              name="Changes/Changeset"
                              stroke={COLORS.review}
                              strokeWidth={2}
                              dot={{ r: 3 }}
                            />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-8">
                        No weekly activity data.
                      </p>
                    )}
                  </CardContent>
                </Card>

                {/* Weekly Task Hours — Stacked BarChart */}
                <Card>
                  <CardHeader className="pb-0 flex flex-row items-center justify-between">
                    <CardTitle className="text-base">
                      Weekly Task Hours by Category
                    </CardTitle>
                    <ChartExportButton containerRef={timekeepingWeeklyHoursRef} filename="timekeeping-weekly-hours" />
                  </CardHeader>
                  <CardContent>
                    {timekeepingData.weekly_category_hours?.length > 0 ? (
                      <div ref={timekeepingWeeklyHoursRef} style={{ width: "100%", height: 280 }}>
                        <ResponsiveContainer>
                          <BarChart data={timekeepingData.weekly_category_hours.map(row => ({
                            ...row,
                            week: new Date(row.week + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }),
                          }))}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis
                              dataKey="week"
                              tick={{ fontSize: 10 }}
                            />
                            <YAxis tick={{ fontSize: 10 }} tickFormatter={chartNumberFmt} label={{ value: "Hours", angle: -90, position: "insideLeft", style: { fontSize: 10 } }} />
                            <Tooltip
                              contentStyle={{ fontSize: 11 }}
                              formatter={chartTooltipFmt}
                            />
                            <Legend
                              wrapperStyle={{ fontSize: 9 }}
                              iconSize={8}
                            />
                            {(timekeepingData.weekly_category_names || []).map(
                              (cat, i) => (
                                <Bar
                                  key={cat}
                                  dataKey={cat}
                                  stackId="a"
                                  fill={
                                    WEEKLY_TASK_COLORS[
                                      i % WEEKLY_TASK_COLORS.length
                                    ]
                                  }
                                  stroke="#ffffff"
                                  strokeWidth={0.5}
                                />
                              )
                            )}
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-8">
                        No category data for this period.
                      </p>
                    )}
                  </CardContent>
                </Card>

                {/* Community Outreach Trends — Stacked Bar + Lines (mock) */}
                <Card className="border-2 border-dashed border-yellow-400 relative">
                  <div className="absolute top-2 right-2 z-10">
                    <span className="bg-yellow-400 text-yellow-900 text-xs font-bold px-2 py-1 rounded uppercase tracking-wider">Sample Data</span>
                  </div>
                  <CardHeader className="pb-0 flex flex-row items-center justify-between">
                    <CardTitle className="text-base">
                      Community Outreach Trends
                    </CardTitle>
                    <ChartExportButton containerRef={timekeepingCommunityOutreachRef} filename="timekeeping-community-outreach" />
                  </CardHeader>
                  <CardContent>
                    <div ref={timekeepingCommunityOutreachRef} style={{ width: "100%", height: 280 }}>
                      <ResponsiveContainer>
                        <ComposedChart
                          data={MOCK_COMMUNITY_OUTREACH}
                        >
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis
                            dataKey="week"
                            tick={{ fontSize: 10 }}
                          />
                          <YAxis tick={{ fontSize: 10 }} tickFormatter={chartNumberFmt} />
                          <Tooltip
                            contentStyle={{ fontSize: 11 }}
                            formatter={chartTooltipFmt}
                          />
                          <Legend
                            wrapperStyle={{ fontSize: 9 }}
                            iconSize={8}
                          />
                          {Object.entries(
                            COMMUNITY_OUTREACH_COLORS
                          ).map(([cat, color]) => (
                            <Bar
                              key={cat}
                              dataKey={cat}
                              stackId="a"
                              fill={color}
                            />
                          ))}
                          <Line
                            dataKey="newParticipants"
                            name="# of New Participants"
                            stroke="#1f2937"
                            strokeWidth={2}
                            dot={{ r: 3 }}
                          />
                          <Line
                            dataKey="returnParticipants"
                            name="# of Retained Participants"
                            stroke="#ef4444"
                            strokeWidth={2}
                            dot={{ r: 3 }}
                            strokeDasharray="5 5"
                          />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                    <p className="text-xs text-yellow-700 font-medium text-center mt-2 bg-yellow-50 rounded py-1">
                      This chart uses sample data — not connected to a real data source yet
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Per-User Time Tracking Table */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>
                    Time Tracking (
                    {timekeepingData.user_breakdown.length})
                  </CardTitle>
                  <TableExportButton
                    rows={timekeepingData.user_breakdown as unknown as Array<Record<string, unknown>>}
                    columns={[
                      { key: "name", label: "Name" },
                      { key: "hours", label: "Hours" },
                      { key: "entries", label: "Entries" },
                      { key: "avg_session_minutes", label: "Avg Session (min)" },
                    ]}
                    filename="timekeeping-user-breakdown"
                  />
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm" style={{ minWidth: 500 }}>
                      <thead className="bg-muted border-b border-border">
                        <tr>
                          <th className="px-6 py-3 text-left text-sm font-semibold text-foreground w-8"></th>
                          <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">
                            Name
                          </th>
                          <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">
                            Hours
                          </th>
                          <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">
                            Records
                          </th>
                          <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">
                            Changesets
                          </th>
                          <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">
                            Changes
                          </th>
                          <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">
                            OSM usernames
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border bg-card">
                        {timekeepingData.user_breakdown.slice((timeTrackingPage - 1) * ROWS_PER_PAGE, timeTrackingPage * ROWS_PER_PAGE).map((u) => {
                          const isExpanded = expandedUsers.has(
                            u.user_id
                          );
                          return (
                            <Fragment key={u.user_id}>
                              <tr
                                className="cursor-pointer hover:bg-muted/50 transition-colors"
                                onClick={() => {
                                  const next = new Set(
                                    expandedUsers
                                  );
                                  if (isExpanded)
                                    next.delete(u.user_id);
                                  else next.add(u.user_id);
                                  setExpandedUsers(next);
                                }}
                              >
                                <td className="px-6 py-4 text-muted-foreground">
                                  {isExpanded
                                    ? "\u25BC"
                                    : "\u25B6"}
                                </td>
                                <td className="px-6 py-4">
                                  <div className="flex items-center gap-2">
                                    <div className="w-8 h-8 rounded-full bg-kaart-orange/20 flex items-center justify-center text-kaart-orange text-xs font-bold">
                                      {(u.user_name || "?")
                                        .split(" ")
                                        .map((n) => n[0])
                                        .join("")
                                        .slice(0, 2)
                                        .toUpperCase()}
                                    </div>
                                    <span className="font-medium text-foreground">
                                      {u.user_name}
                                    </span>
                                  </div>
                                </td>
                                <td className="px-6 py-4 text-foreground">
                                  <Val>{formatNumber(u.total_hours)}</Val>h
                                </td>
                                <td className="px-6 py-4 text-foreground">
                                  <Val>{formatNumber(u.entries_count)}</Val>
                                </td>
                                <td className="px-6 py-4 text-foreground">
                                  <Val>{formatNumber(u.changeset_count)}</Val>
                                </td>
                                <td className="px-6 py-4 text-foreground">
                                  <Val>{formatNumber(u.changes_count)}</Val>
                                </td>
                                <td className="px-6 py-4 text-foreground">
                                  <Val>{u.osm_username}</Val>
                                </td>
                              </tr>
                              {isExpanded && (
                                <tr>
                                  <td
                                    colSpan={7}
                                    className="px-12 py-3 bg-muted/30"
                                  >
                                    <div className="flex flex-wrap gap-4">
                                      {Object.entries(
                                        u.category_hours
                                      ).map(([cat, hrs]) => (
                                        <div
                                          key={cat}
                                          className="flex items-center gap-2"
                                        >
                                          <div
                                            className="w-3 h-3 rounded-full"
                                            style={{
                                              backgroundColor:
                                                CATEGORY_COLORS[
                                                  cat
                                                ] ||
                                                CATEGORY_COLORS.other,
                                            }}
                                          />
                                          <span className="text-sm text-muted-foreground capitalize">
                                            {cat}:{" "}
                                            <span className="font-medium">
                                              {hrs}h
                                            </span>
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {timekeepingData.user_breakdown.length > ROWS_PER_PAGE && (
                    <div className="flex items-center justify-between px-6 py-3 text-sm text-muted-foreground">
                      <span>Showing {(timeTrackingPage - 1) * ROWS_PER_PAGE + 1}-{Math.min(timeTrackingPage * ROWS_PER_PAGE, timekeepingData.user_breakdown.length)} of {timekeepingData.user_breakdown.length}</span>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" disabled={timeTrackingPage === 1}
                          onClick={() => setTimeTrackingPage(p => p - 1)}>Previous</Button>
                        <span className="flex items-center px-2">Page {timeTrackingPage} of {Math.ceil(timekeepingData.user_breakdown.length / ROWS_PER_PAGE)}</span>
                        <Button variant="outline" size="sm" disabled={timeTrackingPage === Math.ceil(timekeepingData.user_breakdown.length / ROWS_PER_PAGE)}
                          onClick={() => setTimeTrackingPage(p => p + 1)}>Next</Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card>
              <CardContent className="p-12 text-center">
                <p className="text-muted-foreground">
                  Select a date range and click Refresh to load
                  timekeeping statistics.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ═══════ IMAGERY TAB ═══════ */}
        <TabsContent value="imagery">
          {mapillaryLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
              <span className="ml-3 text-gray-600">Loading Mapillary data...</span>
            </div>
          ) : !mapillaryData || mapillaryData.summary.total_images === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-gray-500 text-lg">No Mapillary data available</p>
                <p className="text-gray-400 text-sm mt-2">
                  {mapillaryData?.message || "Link Mapillary usernames to users in their profile to start tracking imagery uploads."}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-sm text-gray-500">Total Images</p>
                    <p className="text-3xl font-bold"><Val>{formatNumber(mapillaryData.summary.total_images)}</Val></p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-sm text-gray-500">Total Trips</p>
                    <p className="text-3xl font-bold"><Val>{formatNumber(mapillaryData.summary.total_trips)}</Val></p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-sm text-gray-500">Active Contributors</p>
                    <p className="text-3xl font-bold"><Val>{formatNumber(mapillaryData.summary.active_contributors)}</Val></p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-sm text-gray-500">Total Sequences</p>
                    <p className="text-3xl font-bold"><Val>{formatNumber(mapillaryData.summary.total_sequences)}</Val></p>
                  </CardContent>
                </Card>
              </div>

              {/* Weekly Uploads Chart */}
              {mapillaryData.weekly_uploads.length > 0 && (
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle>Weekly Image Uploads</CardTitle>
                    <ChartExportButton containerRef={imageryWeeklyUploadsRef} filename="imagery-weekly-uploads" />
                  </CardHeader>
                  <CardContent>
                    <div ref={imageryWeeklyUploadsRef} style={{ width: "100%", height: 300 }}>
                      <ResponsiveContainer>
                        <BarChart data={mapillaryData.weekly_uploads}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="week" />
                          <YAxis tickFormatter={chartNumberFmt} />
                          <Tooltip formatter={chartTooltipFmt} />
                          <Bar dataKey="images" fill="#10b981" name="Images" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Images by User Chart */}
              {mapillaryData.summary.images_by_user.length > 0 && (
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle>Images by Contributor</CardTitle>
                    <ChartExportButton containerRef={imageryByContributorRef} filename="imagery-by-contributor" />
                  </CardHeader>
                  <CardContent>
                    <div ref={imageryByContributorRef} style={{ width: "100%", height: Math.max(200, mapillaryData.summary.images_by_user.length * 40) }}>
                      <ResponsiveContainer>
                        <BarChart data={mapillaryData.summary.images_by_user} layout="vertical">
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis type="number" tickFormatter={chartNumberFmt} />
                          <YAxis type="category" dataKey="name" width={120} />
                          <Tooltip formatter={chartTooltipFmt} />
                          <Bar dataKey="count" fill="#6366f1" name="Images" radius={[0, 4, 4, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Trips Table */}
              {mapillaryData.trips.length > 0 && (
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle>Capture Trips</CardTitle>
                    <TableExportButton
                      rows={mapillaryData.trips as unknown as Array<Record<string, unknown>>}
                      columns={[
                        { key: "user_name", label: "User" },
                        { key: "mapillary_username", label: "Mapillary Username" },
                        { key: "date", label: "Date" },
                        { key: "image_count", label: "Images" },
                        { key: "sequence_count", label: "Sequences" },
                      ]}
                      filename="imagery-capture-trips"
                    />
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-left">
                            <th className="pb-2 font-medium text-gray-600">User</th>
                            <th className="pb-2 font-medium text-gray-600">Mapillary Username</th>
                            <th className="pb-2 font-medium text-gray-600">Date</th>
                            <th className="pb-2 font-medium text-gray-600 text-right">Images</th>
                            <th className="pb-2 font-medium text-gray-600 text-right">Sequences</th>
                          </tr>
                        </thead>
                        <tbody>
                          {mapillaryData.trips.slice((tripsPage - 1) * ROWS_PER_PAGE, tripsPage * ROWS_PER_PAGE).map((trip, i) => (
                            <tr key={`${trip.mapillary_username}-${trip.date}-${i}`} className="border-b last:border-0">
                              <td className="py-2">{trip.user_name}</td>
                              <td className="py-2 text-gray-500">{trip.mapillary_username}</td>
                              <td className="py-2">{trip.date}</td>
                              <td className="py-2 text-right"><Val>{formatNumber(trip.image_count)}</Val></td>
                              <td className="py-2 text-right"><Val>{formatNumber(trip.sequence_count)}</Val></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {mapillaryData.trips.length > ROWS_PER_PAGE && (
                      <div className="flex items-center justify-between mt-3 text-sm text-muted-foreground">
                        <span>Showing {(tripsPage - 1) * ROWS_PER_PAGE + 1}-{Math.min(tripsPage * ROWS_PER_PAGE, mapillaryData.trips.length)} of {mapillaryData.trips.length}</span>
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" disabled={tripsPage === 1}
                            onClick={() => setTripsPage(p => p - 1)}>Previous</Button>
                          <span className="flex items-center px-2">Page {tripsPage} of {Math.ceil(mapillaryData.trips.length / ROWS_PER_PAGE)}</span>
                          <Button variant="outline" size="sm" disabled={tripsPage === Math.ceil(mapillaryData.trips.length / ROWS_PER_PAGE)}
                            onClick={() => setTripsPage(p => p + 1)}>Next</Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </TabsContent>

        {/* ═══════ MAPROULETTE TAB ═══════ */}
        <TabsContent value="maproulette">
          {mrLoading && !mrData ? (
            <LoadingSpinner />
          ) : mrError ? (
            <Card>
              <CardContent className="p-8 text-center text-red-500">
                Failed to load MapRoulette stats: {mrError}
              </CardContent>
            </Card>
          ) : mrData ? (
            <div className="space-y-6">
              {/* Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <StatCard
                  label="Fixed"
                  value={formatNumber(mrData.summary.mr_status_summary?.["1"] ?? 0).text}
                />
                <StatCard
                  label="Already Fixed"
                  value={formatNumber(mrData.summary.mr_status_summary?.["5"] ?? 0).text}
                />
                <StatCard
                  label="Not an Issue"
                  value={formatNumber(mrData.summary.mr_status_summary?.["2"] ?? 0).text}
                />
                <StatCard
                  label="Can't Complete"
                  value={formatNumber(mrData.summary.mr_status_summary?.["6"] ?? 0).text}
                />
                <StatCard
                  label="Skipped"
                  value={formatNumber(mrData.summary.mr_status_summary?.["3"] ?? 0).text}
                />
                <StatCard
                  label="Reviewed"
                  value={formatNumber(mrData.summary.total_validated).text}
                />
              </div>

              {/* Tasks Over Time - MR Status Breakdown */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>Tasks Over Time</CardTitle>
                  <ChartExportButton containerRef={mrTasksOverTimeRef} filename="mr-tasks-over-time" />
                </CardHeader>
                <CardContent>
                  {mrData.mr_status_over_time && mrData.mr_status_over_time.length > 0 ? (
                    <div ref={mrTasksOverTimeRef} style={{ width: "100%", height: 300 }}>
                      <ResponsiveContainer>
                        <BarChart data={mrData.mr_status_over_time}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis
                            dataKey="week"
                            tick={{ fontSize: 12 }}
                            tickFormatter={(v: string) =>
                              new Date(v + "T00:00:00").toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                              })
                            }
                          />
                          <YAxis tick={{ fontSize: 12 }} tickFormatter={chartNumberFmt} />
                          <Tooltip
                            labelFormatter={(v) =>
                              new Date(String(v) + "T00:00:00").toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              })
                            }
                            formatter={chartTooltipFmt}
                          />
                          <Legend />
                          <Bar dataKey="fixed" name="Fixed" stackId="status" fill={MR_COLORS.fixed} stroke="#ffffff" strokeWidth={0.5} />
                          <Bar dataKey="already_fixed" name="Already Fixed" stackId="status" fill={MR_COLORS.already_fixed} stroke="#ffffff" strokeWidth={0.5} />
                          <Bar dataKey="false_positive" name="Not an Issue" stackId="status" fill={MR_COLORS.false_positive} stroke="#ffffff" strokeWidth={0.5} />
                          <Bar dataKey="cant_complete" name="Can't Complete" stackId="status" fill={MR_COLORS.cant_complete} stroke="#ffffff" strokeWidth={0.5} />
                          <Bar dataKey="skipped" name="Skipped" stackId="status" fill={MR_COLORS.skipped} stroke="#ffffff" strokeWidth={0.5} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No MapRoulette task data for this period.
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Challenges Table */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>
                    Challenges ({mrData.projects.length})
                  </CardTitle>
                  <TableExportButton
                    rows={mrData.projects as unknown as Array<Record<string, unknown>>}
                    columns={[
                      { key: "name", label: "Challenge" },
                      { key: "total_tasks", label: "Total Tasks" },
                      { key: "mapped_tasks", label: "Mapped" },
                      { key: "validated_tasks", label: "Validated" },
                      { key: "invalidated_tasks", label: "Invalidated" },
                      { key: "mapping_rate_per_task", label: "Mapping Rate" },
                      { key: "validation_rate_per_task", label: "Validation Rate" },
                    ]}
                    filename="mr-challenges"
                  />
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm" style={{ minWidth: 500 }}>
                      <thead className="bg-muted border-b border-border">
                        <tr>
                          <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">
                            Challenge Name
                          </th>
                          <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">
                            Status
                          </th>
                          <th className="px-6 py-3 text-right text-sm font-semibold text-foreground">
                            Fixed
                          </th>
                          <th className="px-6 py-3 text-right text-sm font-semibold text-foreground">
                            Already Fixed
                          </th>
                          <th className="px-6 py-3 text-right text-sm font-semibold text-foreground">
                            Not an Issue
                          </th>
                          <th className="px-6 py-3 text-right text-sm font-semibold text-foreground">
                            Can&#39;t Complete
                          </th>
                          <th className="px-6 py-3 text-right text-sm font-semibold text-foreground">
                            Skipped
                          </th>
                          <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">
                            Fix Rate
                          </th>
                          <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">
                            Val Rate
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border bg-card">
                        {mrData.projects.slice((mrProjectsPage - 1) * ROWS_PER_PAGE, mrProjectsPage * ROWS_PER_PAGE).map((proj) => {
                          const status = getProjectStatus(proj);
                          const bd = proj.mr_status_breakdown || {};
                          return (
                            <tr key={proj.id}>
                              <td className="px-6 py-4">
                                <div className="flex items-center gap-2">
                                  <Link
                                    href={`/admin/projects/${proj.id}`}
                                    className="font-medium text-kaart-orange hover:underline"
                                    title="View project details"
                                  >
                                    {proj.name}
                                  </Link>
                                  {proj.url && (
                                    <a
                                      href={proj.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-muted-foreground hover:text-foreground"
                                      title="Open in MapRoulette"
                                    >
                                      ↗
                                    </a>
                                  )}
                                </div>
                              </td>
                              <td className="px-6 py-4">
                                <span
                                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${status.className}`}
                                >
                                  {status.label}
                                </span>
                              </td>
                              <td className="px-6 py-4 text-right text-foreground">
                                <Val>{formatNumber(bd["1"] || 0)}</Val>
                              </td>
                              <td className="px-6 py-4 text-right text-foreground">
                                <Val>{formatNumber(bd["5"] || 0)}</Val>
                              </td>
                              <td className="px-6 py-4 text-right text-foreground">
                                <Val>{formatNumber(bd["2"] || 0)}</Val>
                              </td>
                              <td className="px-6 py-4 text-right text-foreground">
                                <Val>{formatNumber(bd["6"] || 0)}</Val>
                              </td>
                              <td className="px-6 py-4 text-right text-foreground">
                                <Val>{formatNumber(bd["3"] || 0)}</Val>
                              </td>
                              <td className="px-6 py-4 text-foreground">
                                <Val>{formatCurrency(proj.mapping_rate)}</Val>
                              </td>
                              <td className="px-6 py-4 text-foreground">
                                <Val>{formatCurrency(proj.validation_rate)}</Val>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {mrData.projects.length > ROWS_PER_PAGE && (
                    <div className="flex items-center justify-between px-6 py-3 text-sm text-muted-foreground">
                      <span>Showing {(mrProjectsPage - 1) * ROWS_PER_PAGE + 1}-{Math.min(mrProjectsPage * ROWS_PER_PAGE, mrData.projects.length)} of {mrData.projects.length}</span>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" disabled={mrProjectsPage === 1}
                          onClick={() => setMrProjectsPage(p => p - 1)}>Previous</Button>
                        <span className="flex items-center px-2">Page {mrProjectsPage} of {Math.ceil(mrData.projects.length / ROWS_PER_PAGE)}</span>
                        <Button variant="outline" size="sm" disabled={mrProjectsPage === Math.ceil(mrData.projects.length / ROWS_PER_PAGE)}
                          onClick={() => setMrProjectsPage(p => p + 1)}>Next</Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Top Contributors Table */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>Top Contributors</CardTitle>
                  <TableExportButton
                    rows={mrData.top_contributors as unknown as Array<Record<string, unknown>>}
                    columns={[
                      { key: "name", label: "Name" },
                      { key: "osm_username", label: "OSM Username" },
                      { key: "fixed", label: "Fixed" },
                      { key: "already_fixed", label: "Already Fixed" },
                      { key: "false_positive", label: "Not an Issue" },
                      { key: "cant_complete", label: "Can't Complete" },
                      { key: "skipped", label: "Skipped" },
                      { key: "total_contributions", label: "Total" },
                    ]}
                    filename="mr-top-contributors"
                  />
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm" style={{ minWidth: 500 }}>
                      <thead className="bg-muted border-b border-border">
                        <tr>
                          <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">
                            Name
                          </th>
                          <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">
                            OSM Username
                          </th>
                          <th className="px-6 py-3 text-right text-sm font-semibold text-foreground">
                            Fixed
                          </th>
                          <th className="px-6 py-3 text-right text-sm font-semibold text-foreground">
                            Already Fixed
                          </th>
                          <th className="px-6 py-3 text-right text-sm font-semibold text-foreground">
                            Not an Issue
                          </th>
                          <th className="px-6 py-3 text-right text-sm font-semibold text-foreground">
                            Can&#39;t Complete
                          </th>
                          <th className="px-6 py-3 text-right text-sm font-semibold text-foreground">
                            Skipped
                          </th>
                          <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">
                            Hours
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border bg-card">
                        {mrData.top_contributors.slice((mrContributorsPage - 1) * ROWS_PER_PAGE, mrContributorsPage * ROWS_PER_PAGE).map((c) => {
                          const bd = c.mr_status_breakdown || {};
                          return (
                            <tr
                              key={c.osm_username}
                              className={
                                c.user_id
                                  ? "cursor-pointer hover:bg-muted/50 transition-colors"
                                  : ""
                              }
                              onClick={() =>
                                c.user_id &&
                                router.push(
                                  `/admin/users/${encodeURIComponent(c.user_id)}`
                                )
                              }
                            >
                              <td className="px-6 py-4">
                                <span
                                  className={
                                    c.user_id
                                      ? "font-medium text-kaart-orange"
                                      : "font-medium text-foreground"
                                  }
                                >
                                  {c.user_name}
                                </span>
                              </td>
                              <td className="px-6 py-4 text-foreground">
                                {c.osm_username}
                              </td>
                              <td className="px-6 py-4 text-right text-foreground">
                                <Val>{formatNumber(bd["1"] || 0)}</Val>
                              </td>
                              <td className="px-6 py-4 text-right text-foreground">
                                <Val>{formatNumber(bd["5"] || 0)}</Val>
                              </td>
                              <td className="px-6 py-4 text-right text-foreground">
                                <Val>{formatNumber(bd["2"] || 0)}</Val>
                              </td>
                              <td className="px-6 py-4 text-right text-foreground">
                                <Val>{formatNumber(bd["6"] || 0)}</Val>
                              </td>
                              <td className="px-6 py-4 text-right text-foreground">
                                <Val>{formatNumber(bd["3"] || 0)}</Val>
                              </td>
                              <td className="px-6 py-4 text-foreground">
                                <Val>{formatNumber(c.total_hours)}</Val>h
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {mrData.top_contributors.length > ROWS_PER_PAGE && (
                    <div className="flex items-center justify-between px-6 py-3 text-sm text-muted-foreground">
                      <span>Showing {(mrContributorsPage - 1) * ROWS_PER_PAGE + 1}-{Math.min(mrContributorsPage * ROWS_PER_PAGE, mrData.top_contributors.length)} of {mrData.top_contributors.length}</span>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" disabled={mrContributorsPage === 1}
                          onClick={() => setMrContributorsPage(p => p - 1)}>Previous</Button>
                        <span className="flex items-center px-2">Page {mrContributorsPage} of {Math.ceil(mrData.top_contributors.length / ROWS_PER_PAGE)}</span>
                        <Button variant="outline" size="sm" disabled={mrContributorsPage === Math.ceil(mrData.top_contributors.length / ROWS_PER_PAGE)}
                          onClick={() => setMrContributorsPage(p => p + 1)}>Next</Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card>
              <CardContent className="p-12 text-center">
                <p className="text-muted-foreground">
                  No MapRoulette data available for this period. Select a date
                  range and click Refresh to load MapRoulette statistics.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
