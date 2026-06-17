"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
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
  Tabs,
  TabsList,
  TabsTrigger,
  Val,
} from "@/components/ui";
import { useToastActions } from "@/components/ui";
import { StandaloneFilter } from "@/components/admin/StandaloneFilter";
import {
  useApiMutation,
  useAdminActiveSessions,
  useAdminLongSessions,
  useDismissLongSession,
  useVoidTimeEntry,
  useForceClockOut,
  useExportTimeEntries,
  useFetchFilterOptions,
  useUsersList,
  useOrgProjects,
  useAdminAggregateStats,
} from "@/hooks/useApi";
import { useCurrentUserRole, useManagedTeams } from "@/hooks";
import { TeamAdminEmptyState } from "@/components/admin/TeamAdminEmptyState";
import { formatNumber } from "@/lib/utils";
import {
  localWeekStartIsoUtc,
  localWeekEndIsoUtc,
  localWeekStartAgoIsoUtc,
  localMonthStartIsoUtc,
  localMonthStartAgoIsoUtc,
  localDayEndIsoUtc,
  dateInputToLocalStartIsoUtc,
  dateInputToLocalEndIsoUtc,
} from "@/lib/timeTracking";
import type { TimeEntry, TimeTrackingHistoryResponse } from "@/types";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { AdminTimeCategoriesView } from "@/components/pages/time/_categories";
import { NotesButton } from "@/components/widgets/NotesButton";
import { PendingAdjustmentsStrip } from "@/components/admin/PendingAdjustmentsStrip";
import {
  formatDuration,
  formatDurationHuman,
  resolveCategoryKey,
  CATEGORY_FILTER_LABELS,
  formatDateRangeShort,
  formatDateTime,
} from "@/lib/timeTracking";
import { AdminEditTimeEntryModal } from "@/components/modals/time/AdminEditTimeEntryModal";
import { AdminAddTimeEntryModal } from "@/components/modals/time/AdminAddTimeEntryModal";

// --- Date range presets ---

type DatePreset =
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "last_3_months"
  | "all_time"
  | "custom";

const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  this_week: "This Week",
  last_week: "Last Week",
  this_month: "This Month",
  last_month: "Last Month",
  last_3_months: "Last 3 Months",
  all_time: "All Time",
  custom: "Custom",
};

const DATE_PRESET_ORDER: DatePreset[] = [
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "last_3_months",
  "all_time",
  "custom",
];

// Calendar-aligned semantics (locked 2026-04-21 meeting):
//   This Week     = Sun → end of Sat (current Sun-Sat week)
//   Last Week     = previous full Sun-Sat week
//   This Month    = month-to-date (1st of current month → end of today)
//   Last Month    = full previous calendar month
//   Last 3 Months = three FULL calendar months ending at the end of last
//                   month (e.g. on Apr 28: Jan 1 → Mar 31; current month
//                   is excluded).
// Windows are browser-local (admin's wall clock), emitted as ISO UTC
// instants so the backend filters against UTC-stored clock_in without
// drift for non-UTC admins.
function getDateRange(
  preset: DatePreset,
  custom?: { start: string; end: string },
): {
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
    case "custom":
      return {
        startDate: dateInputToLocalStartIsoUtc(custom?.start),
        endDate: dateInputToLocalEndIsoUtc(custom?.end),
      };
  }
}

/**
 * Human-readable summary of the active date filter, used both in the
 * active-filter pill strip and the stat-card subtitles. Returns null
 * when there is no meaningful date filter (preset="all_time" with no
 * custom range set).
 */
function formatDateRangeLabel(
  preset: DatePreset,
  customStart: string,
  customEnd: string,
): string | null {
  if (preset === "all_time") return null;
  if (preset === "custom") {
    if (!customStart && !customEnd) return null;
    // Use formatDateRangeShort (which anchors "YYYY-MM-DD" to LOCAL
    // midnight) rather than formatDate (which parses "YYYY-MM-DD" as UTC
    // midnight and then renders local — shifting the label a day earlier
    // for negative-UTC admins like Kaart HQ/America/Denver). This keeps the
    // stat-card subtitle in sync with the resolved-range caption below the
    // pickers, which already uses formatDateRangeShort. The custom inputs
    // are raw inclusive day stamps, so no endExclusive adjustment.
    if (customStart && customEnd)
      return formatDateRangeShort(customStart, customEnd);
    if (customStart) return `From ${formatDateRangeShort(customStart, customStart)}`;
    return `Through ${formatDateRangeShort(customEnd, customEnd)}`;
  }
  return DATE_PRESET_LABELS[preset];
}

// --- Category options ---
// Sourced from the SSOT in @/lib/timeTracking so this dropdown can never
// drift from the backend's VALID_CATEGORIES.

const CATEGORIES = CATEGORY_FILTER_LABELS;

// --- Formatting helpers ---

function formatLiveDuration(clockIn: string): string {
  const now = new Date();
  const start = new Date(clockIn);
  const seconds = Math.floor((now.getTime() - start.getTime()) / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

// --- Constants ---

const PAGE_SIZE = 20;

// --- Page component ---

export default function AdminTime() {
  const toast = useToastActions();

  // Tab state for the page-level Sessions / Categories split. Synced to
  // ?tab= in the URL so refreshes and shared links land on the same tab.
  // The "Categories" tab renders the AdminTimeCategoriesView component
  // imported from ./_categories (was previously its own route at
  // /admin/time-categories, now folded in here).
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const activeTab: "sessions" | "categories" =
    searchParams?.get("tab") === "categories" ? "categories" : "sessions";
  const setActiveTab = (next: string) => {
    // Push instead of replace so back/forward navigates between tabs.
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (next === "sessions") {
      params.delete("tab");
    } else {
      params.set("tab", next);
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  // Filters — date preset / custom dates / search / category at the top,
  // then the same per-dimension dropdowns the projects + users pages use.
  const [datePreset, setDatePreset] = useState<DatePreset>("this_month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [category, setCategory] = useState<string>("All");
  const [userSearch, setUserSearch] = useState("");
  // Debounced mirror of userSearch — drives the server-side history query
  // so we send one request after the user stops typing, not per keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterRegionId, setFilterRegionId] = useState<string | null>(null);
  const [filterCountryId, setFilterCountryId] = useState<string | null>(null);
  const [filterTeamId, setFilterTeamId] = useState<string | null>(null);
  const [filterRole, setFilterRole] = useState<string | null>(null);
  const [filterTimezone, setFilterTimezone] = useState<string | null>(null);

  // Sorting
  const [sortKey, setSortKey] = useState<string>("clockIn");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Pagination
  const [page, setPage] = useState(0);

  // Active sessions collapsible
  const [sessionsExpanded, setSessionsExpanded] = useState(true);

  // Long sessions collapsible
  const [longSessionsExpanded, setLongSessionsExpanded] = useState(true);

  // Export dropdown
  const [exportOpen, setExportOpen] = useState(false);
  const [hideOsmUsername, setHideOsmUsername] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  // Live durations for active sessions
  const [liveDurations, setLiveDurations] = useState<Record<number, string>>(
    {},
  );

  // Edit modal state
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);

  // Void confirmation state
  const [voidingEntryId, setVoidingEntryId] = useState<number | null>(null);

  // Add entry modal state
  const [showAddEntry, setShowAddEntry] = useState(false);

  // Data fetching
  const { mutate: fetchHistoryPage } =
    useApiMutation<TimeTrackingHistoryResponse>("/timetracking/history");
  const { mutate: fetchAggregateStats } = useAdminAggregateStats();
  const [allEntries, setAllEntries] = useState<TimeEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<{
    clockIn: string;
    id: number;
  } | null>(null);
  const [serverStats, setServerStats] = useState<{
    totalHours: number;
    pendingAdjustments: number;
    voidedEntries: number;
  } | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const currentFiltersRef = useRef<Record<string, unknown>>({});
  const {
    data: sessionsData,
    loading: sessionsLoading,
    refetch: refetchSessions,
  } = useAdminActiveSessions();
  const {
    data: longSessionsData,
    loading: longSessionsLoading,
    refetch: refetchLongSessions,
  } = useAdminLongSessions();
  const { mutate: voidEntry, loading: voiding } = useVoidTimeEntry();
  const { mutate: forceClockOut, loading: forcingClockOut } =
    useForceClockOut();
  const { mutate: dismissLongSession, loading: dismissingLongSession } =
    useDismissLongSession();
  const { exportEntries, loading: exporting } = useExportTimeEntries();
  const { data: filterOptions } = useFetchFilterOptions();
  const { data: usersData } = useUsersList();
  const { data: projectsData } = useOrgProjects();

  const users = usersData?.users || [];
  const projects = projectsData?.org_active_projects || [];
  const sessions = sessionsData?.sessions || [];
  const longSessions = longSessionsData?.sessions || [];

  // Role-aware UI (F3 Phase 3.4): team_admin's view is server-scoped
  // to managed-team users. The team filter dropdown is restricted
  // to managed teams only — no "All teams" option that would
  // misleadingly imply org-wide scope.
  const { role: viewerRole } = useCurrentUserRole();
  const { teams: managedTeams, loading: managedTeamsLoading } =
    useManagedTeams();
  const isTeamAdmin = viewerRole === "team_admin";

  // Close export dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        exportRef.current &&
        !exportRef.current.contains(event.target as Node)
      ) {
        setExportOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Debounce the free-text user search so we issue one history request
  // after typing settles rather than one per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(userSearch.trim()), 300);
    return () => clearTimeout(t);
  }, [userSearch]);

  // Build filter body and refetch when filters change. Resets the
  // accumulated entry list and cursor back to page 1.
  const fetchWithFilters = useCallback(async () => {
    const { startDate, endDate } = getDateRange(datePreset, {
      start: customStart,
      end: customEnd,
    });
    const body: Record<string, unknown> = {};
    if (startDate) body.startDate = startDate;
    if (endDate) body.endDate = endDate;
    const categoryKey = resolveCategoryKey(category);
    if (categoryKey) body.category = categoryKey;
    if (debouncedSearch) body.search = debouncedSearch;
    const filters: Record<string, string[]> = {};
    if (filterCountryId) filters.country = [filterCountryId];
    if (filterRegionId) filters.region = [filterRegionId];
    if (filterTeamId) filters.team = [filterTeamId];
    if (filterRole) filters.role = [filterRole];
    if (filterTimezone) filters.timezone = [filterTimezone];
    if (Object.keys(filters).length > 0) body.filters = filters;
    currentFiltersRef.current = body;
    setHistoryLoading(true);
    try {
      const [result, statsResult] = await Promise.all([
        fetchHistoryPage(body),
        fetchAggregateStats(body),
      ]);
      setAllEntries(result?.entries ?? []);
      setNextCursor(result?.nextCursor ?? null);
      setServerStats(statsResult ?? null);
    } catch {
      /* errors surfaced by mutation */
    } finally {
      setHistoryLoading(false);
    }
  }, [
    datePreset,
    customStart,
    customEnd,
    category,
    debouncedSearch,
    filterCountryId,
    filterRegionId,
    filterTeamId,
    filterRole,
    filterTimezone,
    fetchHistoryPage,
    fetchAggregateStats,
  ]);

  const loadMoreHistory = useCallback(async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const body = { ...currentFiltersRef.current, cursor: nextCursor };
      const result = await fetchHistoryPage(body);
      setAllEntries((prev) => [...prev, ...(result?.entries ?? [])]);
      setNextCursor(result?.nextCursor ?? null);
    } catch {
      /* errors surfaced by mutation */
    } finally {
      setLoadingMore(false);
    }
  }, [fetchHistoryPage, nextCursor]);

  useEffect(() => {
    fetchWithFilters();
  }, [fetchWithFilters]);

  // Refresh stats + active sessions when anyone clocks in/out so admins
  // watching this page see live numbers without a manual reload.
  useEffect(() => {
    const handler = () => {
      setTimeout(() => {
        fetchWithFilters();
        refetchSessions().catch(() => {});
        refetchLongSessions().catch(() => {});
      }, 500);
    };
    window.addEventListener("clock-state-changed", handler);
    return () => window.removeEventListener("clock-state-changed", handler);
  }, [fetchWithFilters, refetchSessions, refetchLongSessions]);

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [
    datePreset,
    customStart,
    customEnd,
    category,
    filterRegionId,
    filterCountryId,
    filterTeamId,
    filterRole,
    filterTimezone,
    userSearch,
  ]);

  // Live duration ticker for active sessions
  useEffect(() => {
    if (sessions.length === 0) return;

    const interval = setInterval(() => {
      const durations: Record<number, string> = {};
      for (const session of sessions) {
        if (session.clockIn) {
          durations[session.id] = formatLiveDuration(session.clockIn);
        }
      }
      setLiveDurations(durations);
    }, 1000);

    return () => clearInterval(interval);
  }, [sessions]);

  // Client-side filtering (fallback if backend doesn't filter).
  // Date + category mirror the server filters (redundant but harmless).
  // User search is intentionally NOT applied here — it's a server-side
  // filter now, so the loaded page is already the correct, fully-filtered
  // result set. Re-filtering it client-side would desync the pagination
  // count from what the server returned.
  const filteredEntries = useMemo(() => {
    let entries = allEntries;

    const { startDate, endDate } = getDateRange(datePreset, {
      start: customStart,
      end: customEnd,
    });
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
  }, [allEntries, datePreset, customStart, customEnd, category]);

  // Filter active sessions by category and user search
  const filteredSessions = useMemo(() => {
    let filtered = sessions;
    const filterKey = resolveCategoryKey(category);
    if (filterKey) {
      filtered = filtered.filter(
        (s) => resolveCategoryKey(s.category) === filterKey,
      );
    }
    if (userSearch.trim()) {
      const search = userSearch.trim().toLowerCase();
      filtered = filtered.filter((s) =>
        s.userName?.toLowerCase().includes(search),
      );
    }
    return filtered;
  }, [sessions, category, userSearch]);

  // Stat computations — totals come from the server aggregate endpoint so
  // they're exact regardless of how many pages have been loaded.
  const stats = useMemo(
    () => ({
      totalHours: serverStats?.totalHours ?? 0,
      activeSessions: filteredSessions.length,
      pendingAdjustments: serverStats?.pendingAdjustments ?? 0,
      voidedEntries: serverStats?.voidedEntries ?? 0,
    }),
    [serverStats, filteredSessions],
  );

  // Stat-card subtitle echoing the active date filter. Honest about what
  // the number is for ("For This Month" vs the old "For filtered period"
  // which was true but not informative).
  const periodSubtitle = useMemo(() => {
    const label = formatDateRangeLabel(datePreset, customStart, customEnd);
    return label ? `For ${label}` : "All time";
  }, [datePreset, customStart, customEnd]);

  // Sort handler
  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "clockIn" ? "desc" : "asc");
    }
    setPage(0);
  };

  // Sorted entries
  const sortedEntries = useMemo(() => {
    const entries = [...filteredEntries];
    const dir = sortDir === "asc" ? 1 : -1;

    entries.sort((a, b) => {
      let aVal: string | number | null = null;
      let bVal: string | number | null = null;

      switch (sortKey) {
        case "userName":
          aVal = (a.userName || "").toLowerCase();
          bVal = (b.userName || "").toLowerCase();
          break;
        case "projectName":
          aVal = (a.projectName || "").toLowerCase();
          bVal = (b.projectName || "").toLowerCase();
          break;
        case "category":
          aVal = (a.category || "").toLowerCase();
          bVal = (b.category || "").toLowerCase();
          break;
        case "clockIn":
          aVal = a.clockIn || "";
          bVal = b.clockIn || "";
          break;
        case "clockOut":
          aVal = a.clockOut || "";
          bVal = b.clockOut || "";
          break;
        case "duration":
          aVal = a.durationSeconds ?? 0;
          bVal = b.durationSeconds ?? 0;
          break;
        case "status":
          aVal = a.status || "";
          bVal = b.status || "";
          break;
        default:
          return 0;
      }

      if (aVal < bVal) return -1 * dir;
      if (aVal > bVal) return 1 * dir;
      return 0;
    });

    return entries;
  }, [filteredEntries, sortKey, sortDir]);

  // Pagination
  const totalEntries = sortedEntries.length;
  const totalPages = Math.max(1, Math.ceil(totalEntries / PAGE_SIZE));
  const pagedEntries = sortedEntries.slice(
    page * PAGE_SIZE,
    (page + 1) * PAGE_SIZE,
  );
  const showingFrom = totalEntries === 0 ? 0 : page * PAGE_SIZE + 1;
  const showingTo = Math.min((page + 1) * PAGE_SIZE, totalEntries);

  // --- Handlers ---

  const handleForceClockOut = async (id: number) => {
    try {
      await forceClockOut({ session_id: id });
      toast.success("User has been clocked out");
      await refetchSessions();
      refetchLongSessions().catch(() => {});
      fetchWithFilters();
    } catch {
      toast.error("Failed to force clock out");
    }
  };

  const handleOpenEdit = (entry: TimeEntry) => {
    setEditingEntry(entry);
  };

  // Dismiss a long-session alert (mark reviewed). Offers an Undo that
  // restores it to the queue. Underlying time entry is never touched.
  const handleDismissLongSession = async (id: number) => {
    try {
      await dismissLongSession({ session_id: id, reviewed: true });
      await refetchLongSessions();
      toast.success("Long session dismissed", {
        action: {
          label: "Undo",
          onClick: async () => {
            try {
              await dismissLongSession({ session_id: id, reviewed: false });
              await refetchLongSessions();
            } catch {
              toast.error("Failed to restore long session");
            }
          },
        },
      });
    } catch {
      toast.error("Failed to dismiss long session");
    }
  };

  const handleVoidEntry = async (id: number) => {
    try {
      await voidEntry({ entry_id: id });
      setVoidingEntryId(null);
      toast.success("Time entry voided");
      fetchWithFilters();
    } catch {
      toast.error("Failed to void entry");
    }
  };

  const handleOpenAddEntry = () => {
    setShowAddEntry(true);
  };

  const handleExport = async (format: "csv" | "json" | "pdf") => {
    setExportOpen(false);
    const { startDate, endDate } = getDateRange(datePreset, {
      start: customStart,
      end: customEnd,
    });
    const omitColumns: string[] = [];
    if (hideOsmUsername) omitColumns.push("osm_username");
    const filters: Record<string, string[]> = {};
    if (filterCountryId) filters.country = [filterCountryId];
    if (filterRegionId) filters.region = [filterRegionId];
    if (filterTeamId) filters.team = [filterTeamId];
    if (filterRole) filters.role = [filterRole];
    if (filterTimezone) filters.timezone = [filterTimezone];
    try {
      await exportEntries({
        startDate: startDate ?? undefined,
        endDate: endDate ?? undefined,
        category: resolveCategoryKey(category) ?? undefined,
        search: debouncedSearch || undefined,
        filters: Object.keys(filters).length > 0 ? filters : undefined,
        format,
        omit_columns: omitColumns.length ? omitColumns : undefined,
      });
      toast.success("Report downloaded");
    } catch {
      toast.error("Export failed");
    }
  };

  // Loading state
  if (historyLoading && allEntries.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // team_admin with no managed teams → empty state.
  if (isTeamAdmin && !managedTeamsLoading && managedTeams.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Time</h1>
        <TeamAdminEmptyState context="time" />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
              {/* Sessions vs Categories tab strip — synced to ?tab= in the URL
          so refreshes and shared links land on the same tab. The
          Categories tab renders AdminTimeCategoriesView (./_categories);
          everything else (sessions, history, exports) stays inline. */}
      <Tabs
        defaultValue="sessions"
        value={activeTab}
        onValueChange={setActiveTab}
      >
        <TabsList>
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
        </TabsList>
      </Tabs>
        {activeTab === "sessions" && (
          <Button variant="outline" size="sm" onClick={handleOpenAddEntry}>
            + Add Entry
          </Button>
        )}
      </div>



      {activeTab === "categories" ? (
        <AdminTimeCategoriesView />
      ) : (
        <>
          {/* Filter Panel — hoisted above stat cards per UI8 (2026-04 meeting).
          Wrapped in a Card so it reads as a visual unit, not a floating row. */}
          <Card className="p-4">
            <div className="flex flex-col gap-4">
              {/* Row 1 — date scope. Preset buttons (with resolved range
              suffixes), Custom inputs when active, and a caption
              spelling out the exact date window the active preset
              implies. Mirrors the layout pattern used on
              /projects so the two pages feel consistent. */}
              <div className="flex flex-wrap items-center gap-3">
                {/* Date preset button group. Each preset's resolved date
              range is appended to its label so admins can verify
              the semantics at a glance ("Last Month (Mar 1 – 31,
              2026)"). Active range also shown as a caption below
              the filter row. */}
                <div className="flex items-center gap-2">
                  {DATE_PRESET_ORDER.map((preset) => {
                    const { startDate, endDate } = getDateRange(preset, {
                      start: customStart,
                      end: customEnd,
                    });
                    const range = formatDateRangeShort(startDate, endDate, {
                      endExclusive: true,
                      emptyLabel: "",
                    });
                    return (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setDatePreset(preset)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                          datePreset === preset
                            ? "bg-kaart-orange text-white"
                            : "bg-muted text-muted-foreground hover:bg-muted/80"
                        }`}
                      >
                        {DATE_PRESET_LABELS[preset]}
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
                  })}
                </div>

                {datePreset === "custom" && (
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={customStart}
                      onChange={(e) => setCustomStart(e.target.value)}
                      className="px-3 py-1.5 border border-input rounded-lg text-sm bg-background"
                      aria-label="Custom start date"
                    />
                    <span className="text-sm text-muted-foreground">to</span>
                    <input
                      type="date"
                      value={customEnd}
                      onChange={(e) => setCustomEnd(e.target.value)}
                      className="px-3 py-1.5 border border-input rounded-lg text-sm bg-background"
                      aria-label="Custom end date"
                    />
                  </div>
                )}

                {/* Resolved-range caption — explicit, unambiguous statement
              of the exact date window the active preset implies, so an
              admin reconciling payroll never has to second-guess what
              "Last Month" means today. Hides when there is no filter. */}
                {(() => {
                  const { startDate, endDate } = getDateRange(datePreset, {
                    start: customStart,
                    end: customEnd,
                  });
                  const range = formatDateRangeShort(startDate, endDate, {
                    endExclusive: true,
                    emptyLabel: "",
                  });
                  if (!range) return null;
                  return (
                    <div className="basis-full text-xs text-muted-foreground">
                      Showing data from{" "}
                      <span className="font-medium text-foreground">
                        {range}
                      </span>
                    </div>
                  );
                })()}
              </div>

              {/* Row 2 — dimension filters. Mirrors the per-dimension
              dropdown pattern from /projects: each filterable
              dimension is its own visible dropdown defaulting to
              "All …" so admins don't have to discover an Add-filter
              menu. Search + Category sit on the same row so all
              non-date filters are in one place. Export anchors right. */}
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col">
                  <label className="mb-1.5 block text-sm font-medium text-foreground">
                    Search
                  </label>
                  <input
                    type="text"
                    placeholder="Search user..."
                    className="h-10 rounded-lg border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring w-44"
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                  />
                </div>
                <div className="w-44">
                  <StandaloneFilter
                    label="Region"
                    allLabel="All regions"
                    options={(filterOptions?.dimensions?.region ?? []).map(
                      (v) =>
                        typeof v === "string"
                          ? { value: v, label: v }
                          : { value: String(v.id ?? v.name), label: v.name },
                    )}
                    value={filterRegionId}
                    onChange={setFilterRegionId}
                  />
                </div>
                <div className="w-44">
                  <StandaloneFilter
                    label="Country"
                    allLabel="All countries"
                    options={(filterOptions?.dimensions?.country ?? []).map(
                      (v) =>
                        typeof v === "string"
                          ? { value: v, label: v }
                          : { value: String(v.id ?? v.name), label: v.name },
                    )}
                    value={filterCountryId}
                    onChange={setFilterCountryId}
                  />
                </div>
                <div className="w-44">
                  <StandaloneFilter
                    label="Team"
                    allLabel={isTeamAdmin ? "All my teams" : "All teams"}
                    options={
                      isTeamAdmin
                        ? managedTeams.map((t) => ({
                            value: String(t.id),
                            label: t.name,
                          }))
                        : (filterOptions?.dimensions?.team ?? []).map((v) =>
                            typeof v === "string"
                              ? { value: v, label: v }
                              : {
                                  value: String(v.id ?? v.name),
                                  label: v.name,
                                },
                          )
                    }
                    value={filterTeamId}
                    onChange={setFilterTeamId}
                  />
                </div>
                <div className="w-44">
                  <StandaloneFilter
                    label="Role"
                    allLabel="All roles"
                    options={(filterOptions?.dimensions?.role ?? []).map((v) =>
                      typeof v === "string"
                        ? {
                            value: v,
                            label: v.charAt(0).toUpperCase() + v.slice(1),
                          }
                        : { value: String(v.id ?? v.name), label: v.name },
                    )}
                    value={filterRole}
                    onChange={setFilterRole}
                  />
                </div>
                <div className="w-44">
                  <StandaloneFilter
                    label="Timezone"
                    allLabel="All timezones"
                    options={(filterOptions?.dimensions?.timezone ?? []).map(
                      (v) =>
                        typeof v === "string"
                          ? { value: v, label: v }
                          : { value: String(v.id ?? v.name), label: v.name },
                    )}
                    value={filterTimezone}
                    onChange={setFilterTimezone}
                  />
                </div>
                <div className="w-44">
                  <StandaloneFilter
                    label="Category"
                    allLabel="All categories"
                    options={CATEGORIES.filter((c) => c !== "All").map((c) => ({
                      value: c,
                      label: c,
                    }))}
                    value={category === "All" ? null : category}
                    onChange={(v) => setCategory(v ?? "All")}
                  />
                </div>

                {/* Export anchors right */}
                <div ref={exportRef} className="relative ml-auto">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setExportOpen(!exportOpen)}
                    disabled={exporting}
                    isLoading={exporting}
                  >
                    <svg
                      className="w-4 h-4 mr-1"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                    Export
                  </Button>

                  {exportOpen && (
                    <div className="absolute right-0 top-full z-50 mt-1 min-w-52 rounded-lg border border-border bg-card shadow-md">
                      <label className="flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground border-b border-border cursor-pointer hover:bg-accent/50">
                        <input
                          type="checkbox"
                          checked={hideOsmUsername}
                          onChange={(e) => setHideOsmUsername(e.target.checked)}
                          className="h-3 w-3"
                        />
                        Hide OSM username column
                      </label>
                      <div className="py-1">
                        <button
                          type="button"
                          onClick={() => handleExport("csv")}
                          className="flex w-full items-center px-4 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
                        >
                          Download CSV
                        </button>
                        <button
                          type="button"
                          onClick={() => handleExport("json")}
                          className="flex w-full items-center px-4 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
                        >
                          Download JSON
                        </button>
                        <button
                          type="button"
                          onClick={() => handleExport("pdf")}
                          className="flex w-full items-center px-4 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
                        >
                          Download PDF
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Card>

          {/* Pending adjustment requests — sits above everything else so admins
          land on it directly from the dashboard's "Pending Adjustments" stat
          (which now deep-links to #pending-adjustments). The strip pulls
          its own data via /timetracking/pending_adjustments so it ignores
          the page's date filter — a request from last month never hides
          behind the default "this month" preset. Empty state renders nothing. */}
          <PendingAdjustmentsStrip onEdit={handleOpenEdit} />

          {/* Stat Cards */}
          <div
            style={{
              display: "grid",
              gap: 16,
              gridTemplateColumns: "repeat(4, 1fr)",
            }}
          >
            <Card style={{ padding: 0 }}>
              <div style={{ padding: "12px 16px" }}>
                <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
                  Total Hours
                </p>
                <div
                  style={{ fontSize: 20, fontWeight: 700, color: "#ff6b35" }}
                >
                  <Val>{formatNumber(stats.totalHours)}</Val>h
                </div>
                <p style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
                  {periodSubtitle}
                </p>
              </div>
            </Card>

            <Card style={{ padding: 0 }}>
              <div style={{ padding: "12px 16px" }}>
                <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
                  Active Sessions
                </p>
                <div
                  style={{
                    fontSize: 20,
                    fontWeight: 700,
                    color: stats.activeSessions > 0 ? "#16a34a" : "#6b7280",
                  }}
                >
                  <Val>{formatNumber(stats.activeSessions)}</Val>
                </div>
                <p style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
                  {stats.activeSessions > 0
                    ? "Currently clocked in"
                    : "No active sessions"}
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

            <Card style={{ padding: 0 }}>
              <div style={{ padding: "12px 16px" }}>
                <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
                  Voided Entries
                </p>
                <div
                  style={{
                    fontSize: 20,
                    fontWeight: 700,
                    color: stats.voidedEntries > 0 ? "#dc2626" : "#6b7280",
                  }}
                >
                  <Val>{formatNumber(stats.voidedEntries)}</Val>
                </div>
                <p style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
                  {periodSubtitle}
                </p>
              </div>
            </Card>
          </div>

          {/* Long Sessions (collapsible) — alerts for sessions that ran
          longer than the backend's threshold (both still-open and
          recently-closed, last 30 days). Always rendered so the queue is
          discoverable even when empty. The threshold lives server-side;
          the frontend just renders whatever the endpoint returns. */}
          <Card style={{ padding: 0 }}>
            <div
              style={{
                padding: "12px 16px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                cursor: "pointer",
              }}
              onClick={() => setLongSessionsExpanded(!longSessionsExpanded)}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="relative flex h-2 w-2">
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                </span>
                <h2 className="text-base font-semibold">
                  Long Sessions ({longSessions.length})
                </h2>
              </div>
              <svg
                className={`w-5 h-5 text-muted-foreground transition-transform ${longSessionsExpanded ? "rotate-180" : ""}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </div>

            {longSessionsExpanded && (
              <CardContent
                style={{ padding: 0, borderTop: "1px solid var(--border)" }}
              >
                {longSessionsLoading ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    Loading long sessions...
                  </p>
                ) : longSessions.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    No long sessions in the last 30 days.
                  </p>
                ) : (
                  <div className="overflow-auto">
                    <table className="w-full text-sm" style={{ minWidth: 600 }}>
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left py-1.5 px-2 text-xs whitespace-nowrap font-medium text-muted-foreground">
                            User
                          </th>
                          <th className="text-left py-1.5 px-2 text-xs whitespace-nowrap font-medium text-muted-foreground">
                            Project
                          </th>
                          <th className="text-left py-1.5 px-2 text-xs whitespace-nowrap font-medium text-muted-foreground">
                            Category
                          </th>
                          <th className="text-left py-1.5 px-2 text-xs whitespace-nowrap font-medium text-muted-foreground">
                            Clocked In
                          </th>
                          <th className="text-left py-1.5 px-2 text-xs whitespace-nowrap font-medium text-muted-foreground">
                            Clocked Out
                          </th>
                          <th className="text-left py-1.5 px-2 text-xs whitespace-nowrap font-medium text-muted-foreground">
                            Duration
                          </th>
                          <th className="text-left py-1.5 px-2 text-xs whitespace-nowrap font-medium text-muted-foreground">
                            Status
                          </th>
                          <th className="text-left py-1.5 px-2 text-xs whitespace-nowrap font-medium text-muted-foreground">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {longSessions.map((session) => {
                          const isActive = session.status === "active";
                          return (
                            <tr
                              key={session.id}
                              className="border-b border-border last:border-0"
                            >
                              <td className="py-2 px-2">
                                <div className="flex items-center gap-2">
                                  <span className="relative flex h-2 w-2">
                                    <span
                                      className={`relative inline-flex rounded-full h-2 w-2 ${isActive ? "bg-red-500" : "bg-amber-500"}`}
                                    ></span>
                                  </span>
                                  <span className="font-medium">
                                    {session.userName}
                                  </span>
                                </div>
                              </td>
                              <td className="py-2 px-2">
                                {session.projectName || "--"}
                              </td>
                              <td className="py-2 px-2">
                                <Badge variant="secondary">
                                  {session.category}
                                </Badge>
                              </td>
                              <td className="py-2 px-2 text-muted-foreground">
                                {session.clockIn
                                  ? formatDateTime(session.clockIn)
                                  : "--"}
                              </td>
                              <td className="py-2 px-2 text-muted-foreground">
                                {session.clockOut
                                  ? formatDateTime(session.clockOut)
                                  : "still open"}
                              </td>
                              <td className="py-2 px-2 whitespace-nowrap">
                                <span className="font-mono font-medium">
                                  {formatDurationHuman(
                                    session.effectiveDurationSeconds,
                                  )}
                                </span>
                              </td>
                              <td className="py-2 px-2">
                                <Badge
                                  variant={isActive ? "destructive" : "warning"}
                                >
                                  {isActive ? "Active" : "Closed"}
                                </Badge>
                              </td>
                              <td className="py-2 px-2">
                                <div className="flex items-center gap-1">
                                  {isActive ? (
                                    <Button
                                      variant="destructive"
                                      size="sm"
                                      onClick={() =>
                                        handleForceClockOut(session.id)
                                      }
                                      disabled={forcingClockOut}
                                      className="whitespace-nowrap"
                                    >
                                      Clock Out
                                    </Button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => handleOpenEdit(session)}
                                      disabled={false}
                                      className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                                      title="Edit entry"
                                    >
                                      <svg
                                        className="w-4 h-4"
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                      >
                                        <path
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                          strokeWidth={2}
                                          d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                                        />
                                      </svg>
                                    </button>
                                  )}
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                      handleDismissLongSession(session.id)
                                    }
                                    disabled={dismissingLongSession}
                                    className="whitespace-nowrap"
                                    title="Mark as reviewed — remove from this queue (does not change the time entry)"
                                  >
                                    Dismiss
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            )}
          </Card>

          {/* Active Sessions (collapsible) */}
          {filteredSessions.length > 0 && (
            <Card style={{ padding: 0 }}>
              <div
                style={{
                  padding: "12px 16px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  cursor: "pointer",
                }}
                onClick={() => setSessionsExpanded(!sessionsExpanded)}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                  </span>
                  <h2 className="text-base font-semibold">
                    Active Sessions ({filteredSessions.length})
                  </h2>
                </div>
                <svg
                  className={`w-5 h-5 text-muted-foreground transition-transform ${sessionsExpanded ? "rotate-180" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </div>

              {sessionsExpanded && (
                <CardContent
                  style={{ padding: 0, borderTop: "1px solid var(--border)" }}
                >
                  {sessionsLoading ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">
                      Loading active sessions...
                    </p>
                  ) : (
                    <div className="overflow-auto">
                      <table
                        className="w-full text-sm"
                        style={{ minWidth: 600 }}
                      >
                        <thead>
                          <tr className="border-b border-border">
                            <th className="text-left py-1.5 px-2 text-xs whitespace-nowrap font-medium text-muted-foreground">
                              User
                            </th>
                            <th className="text-left py-1.5 px-2 text-xs whitespace-nowrap font-medium text-muted-foreground">
                              Project
                            </th>
                            <th className="text-left py-1.5 px-2 text-xs whitespace-nowrap font-medium text-muted-foreground">
                              Category
                            </th>
                            <th className="text-left py-1.5 px-2 text-xs whitespace-nowrap font-medium text-muted-foreground">
                              Clocked In
                            </th>
                            <th className="text-left py-1.5 px-2 text-xs whitespace-nowrap font-medium text-muted-foreground">
                              Live Duration
                            </th>
                            <th className="text-left py-1.5 px-2 text-xs whitespace-nowrap font-medium text-muted-foreground">
                              Notes
                            </th>
                            <th className="text-left py-1.5 px-2 text-xs whitespace-nowrap font-medium text-muted-foreground">
                              Actions
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredSessions.map((session) => (
                            <tr
                              key={session.id}
                              className="border-b border-border last:border-0"
                            >
                              <td className="py-2 px-2">
                                <div className="flex items-center gap-2">
                                  <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                                  </span>
                                  <span className="font-medium">
                                    {session.userName}
                                  </span>
                                </div>
                              </td>
                              <td className="py-2 px-2">
                                {session.projectName || "--"}
                              </td>
                              <td className="py-2 px-2">
                                <Badge variant="secondary">
                                  {session.category}
                                </Badge>
                              </td>
                              <td className="py-2 px-2 text-muted-foreground">
                                {session.clockIn
                                  ? formatDateTime(session.clockIn)
                                  : "--"}
                              </td>
                              <td className="py-2 px-2">
                                <span className="font-mono text-green-600 font-medium">
                                  {liveDurations[session.id] ||
                                    session.duration ||
                                    "--"}
                                </span>
                              </td>
                              <td className="py-2 px-2">
                                <NotesButton
                                  notes={session.userNotes}
                                  editable={false}
                                  size="xs"
                                  title={`Note from ${session.userName}`}
                                />
                              </td>
                              <td className="py-2 px-2">
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() =>
                                    handleForceClockOut(session.id)
                                  }
                                  disabled={forcingClockOut}
                                  className="whitespace-nowrap"
                                >
                                  Clock Out
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              )}
            </Card>
          )}

          {/* History Table */}
          <Card style={{ padding: 0 }}>
            <CardContent style={{ padding: 0 }}>
              <Table>
                <TableHeader>
                  <TableRow>
                    {[
                      { key: "userName", label: "User" },
                      { key: "projectName", label: "Project" },
                      { key: "category", label: "Category" },
                      { key: "taskName", label: "Task" },
                      { key: "clockIn", label: "Clock In" },
                      { key: "clockOut", label: "Clock Out" },
                      { key: "duration", label: "Duration" },
                      { key: "status", label: "Status" },
                    ].map((col) => (
                      <TableHead
                        key={col.key}
                        onClick={() => handleSort(col.key)}
                        className="cursor-pointer select-none hover:text-foreground transition-colors"
                      >
                        <span className="inline-flex items-center gap-1">
                          {col.label}
                          {sortKey === col.key && (
                            <svg
                              className="w-3 h-3"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d={
                                  sortDir === "asc"
                                    ? "M5 15l7-7 7 7"
                                    : "M19 9l-7 7-7-7"
                                }
                              />
                            </svg>
                          )}
                        </span>
                      </TableHead>
                    ))}
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
                    const wasAdjusted = entry.notes?.startsWith("[ADJUSTED]");

                    return (
                      <TableRow
                        key={entry.id}
                        className={isVoided ? "opacity-50" : ""}
                      >
                        <TableCell
                          className={`font-medium max-w-[120px] truncate ${isVoided ? "line-through" : ""}`}
                        >
                          {entry.userName || "--"}
                        </TableCell>
                        <TableCell
                          className={`max-w-[120px] truncate ${isVoided ? "line-through" : ""}`}
                        >
                          {entry.projectName || "--"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">
                            {entry.category || "--"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground max-w-[120px] truncate">
                          {entry.taskName || "\u2014"}
                        </TableCell>
                        <TableCell
                          className={`text-muted-foreground whitespace-nowrap ${isVoided ? "line-through" : ""}`}
                        >
                          {entry.clockIn ? formatDateTime(entry.clockIn) : "--"}
                        </TableCell>
                        <TableCell
                          className={`text-muted-foreground whitespace-nowrap ${isVoided ? "line-through" : ""}`}
                        >
                          {entry.clockOut
                            ? formatDateTime(entry.clockOut)
                            : "--"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <span
                            className={`font-mono ${isVoided ? "line-through" : ""}`}
                          >
                            {formatDuration(entry.durationSeconds)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
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
                              <Badge
                                variant="destructive"
                                className="ml-1 text-xs uppercase"
                              >
                                Adjust
                              </Badge>
                            )}
                            {wasAdjusted && (
                              <Badge className="ml-1 text-xs uppercase bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                                Adjusted
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <NotesButton
                            notes={entry.userNotes}
                            editable={false}
                            size="xs"
                            title={`Note from ${entry.userName ?? "user"}`}
                          />
                        </TableCell>
                        <TableCell>
                          {!isVoided && (
                            <div className="flex gap-1">
                              <button
                                type="button"
                                onClick={() => handleOpenEdit(entry)}
                                className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                                title="Edit entry"
                              >
                                <svg
                                  className="w-4 h-4"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                                  />
                                </svg>
                              </button>
                              {voidingEntryId === entry.id ? (
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => handleVoidEntry(entry.id)}
                                    disabled={voiding}
                                    className="inline-flex items-center rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                                  >
                                    {voiding ? "..." : "Confirm"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setVoidingEntryId(null)}
                                    className="inline-flex items-center rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent transition-colors"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setVoidingEntryId(entry.id)}
                                  className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                                  title="Void entry"
                                >
                                  <svg
                                    className="w-4 h-4"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                    />
                                  </svg>
                                </button>
                              )}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}

                  {/* Empty state */}
                  {pagedEntries.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={10}
                        style={{
                          textAlign: "center",
                          padding: "32px 16px",
                          color: "#6b7280",
                        }}
                      >
                        No time entries found for the selected filters
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

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
                {formatNumber(showingTo).text} of{" "}
                {formatNumber(totalEntries).text}
                {nextCursor ? "+" : ""}
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
                  isLoading={loadingMore}
                  disabled={page >= totalPages - 1 && !nextCursor}
                  onClick={async () => {
                    const target = page + 1;
                    // The backend returns 50 entries per fetch but we
                    // display PAGE_SIZE (20) per page, so a display page can
                    // straddle a not-yet-loaded backend boundary. If the
                    // destination page isn't fully loaded yet, pull the next
                    // backend page BEFORE advancing. Without this, stepping
                    // past a partially-loaded page silently skips the
                    // unloaded rows — they only reappear when you navigate
                    // back after a later load-more.
                    if (
                      sortedEntries.length < (target + 1) * PAGE_SIZE &&
                      nextCursor
                    ) {
                      await loadMoreHistory();
                    }
                    setPage(target);
                  }}
                >
                  Next
                </Button>
              </div>
            </div>
          )}

          {/* Edit Entry Modal */}
          <AdminEditTimeEntryModal
            entry={editingEntry}
            onClose={() => setEditingEntry(null)}
            onSaved={() => {
              refetchSessions();
              refetchLongSessions().catch(() => {});
              fetchWithFilters();
            }}
          />

          {/* Add Entry Modal */}
          <AdminAddTimeEntryModal
            isOpen={showAddEntry}
            onClose={() => setShowAddEntry(false)}
            users={users}
            projects={projects}
            onCreated={() => {
              refetchSessions();
              refetchLongSessions().catch(() => {});
              fetchWithFilters();
            }}
          />
        </>
      )}
    </div>
  );
}
