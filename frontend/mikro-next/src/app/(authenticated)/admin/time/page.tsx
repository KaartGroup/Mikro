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
  Modal,
  Val,
} from "@/components/ui";
import { useToastActions } from "@/components/ui";
import { StandaloneFilter } from "@/components/admin/StandaloneFilter";
import {
  useAdminTimeHistory,
  useAdminActiveSessions,
  useEditTimeEntry,
  useVoidTimeEntry,
  useAdminAddTimeEntry,
  useForceClockOut,
  useExportTimeEntries,
  useFetchFilterOptions,
  useUsersList,
  useOrgProjects,
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
import type { TimeEntry } from "@/types";
import { NotesButton } from "@/components/widgets/NotesButton";
import { PendingAdjustmentsStrip } from "@/components/admin/PendingAdjustmentsStrip";
import { sortProjectsAlphabetical } from "@/lib/sortProjects";
import {
  formatDurationHM,
  resolveCategoryKey,
  categoryLabel,
  CATEGORY_LABELS,
  CATEGORY_FILTER_LABELS,
  formatDateRangeShort,
} from "@/lib/timeTracking";

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
  custom?: { start: string; end: string }
): {
  startDate: string | null;
  endDate: string | null;
} {
  switch (preset) {
    case "this_week":
      return { startDate: localWeekStartIsoUtc(), endDate: localWeekEndIsoUtc() };
    case "last_week":
      return {
        startDate: localWeekStartAgoIsoUtc(1),
        endDate: localWeekStartIsoUtc(),
      };
    case "this_month":
      return { startDate: localMonthStartIsoUtc(), endDate: localDayEndIsoUtc() };
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
  customEnd: string
): string | null {
  if (preset === "all_time") return null;
  if (preset === "custom") {
    if (!customStart && !customEnd) return null;
    const fmt = (iso: string) =>
      new Date(iso).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    if (customStart && customEnd) return `${fmt(customStart)} – ${fmt(customEnd)}`;
    if (customStart) return `From ${fmt(customStart)}`;
    return `Through ${fmt(customEnd)}`;
  }
  return DATE_PRESET_LABELS[preset];
}

// --- Category options ---
// Sourced from the SSOT in @/lib/timeTracking so this dropdown can never
// drift from the backend's VALID_CATEGORIES.

const CATEGORIES = CATEGORY_FILTER_LABELS;
const CATEGORY_OPTIONS = Object.keys(CATEGORY_LABELS);

// --- Formatting helpers ---

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

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDuration(seconds: number | null): string {
  return formatDurationHM(seconds);
}

function formatLiveDuration(clockIn: string): string {
  const now = new Date();
  const start = new Date(clockIn);
  const seconds = Math.floor((now.getTime() - start.getTime()) / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

function secondsToHours(seconds: number): number {
  return Math.round((seconds / 3600) * 10) / 10;
}

/** Convert ISO string to datetime-local input value (local timezone) */
function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

/** Convert datetime-local input value back to ISO string */
function fromDatetimeLocal(value: string): string {
  return new Date(value).toISOString();
}

// --- Constants ---

const PAGE_SIZE = 20;

// --- Page component ---

export default function AdminTimePage() {
  const toast = useToastActions();

  // Filters — date preset / custom dates / search / category at the top,
  // then the same per-dimension dropdowns the projects + users pages use.
  const [datePreset, setDatePreset] = useState<DatePreset>("this_month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [category, setCategory] = useState<string>("All");
  const [userSearch, setUserSearch] = useState("");
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

  // Export dropdown
  const [exportOpen, setExportOpen] = useState(false);
  const [hideOsmUsername, setHideOsmUsername] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  // Live durations for active sessions
  const [liveDurations, setLiveDurations] = useState<Record<number, string>>(
    {}
  );

  // Edit modal state
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
  const [editClockIn, setEditClockIn] = useState("");
  const [editClockOut, setEditClockOut] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  // Void confirmation state
  const [voidingEntryId, setVoidingEntryId] = useState<number | null>(null);

  // Add entry modal state
  const [showAddEntry, setShowAddEntry] = useState(false);
  const [addUserId, setAddUserId] = useState("");
  const [addProjectId, setAddProjectId] = useState("");
  const [addCategory, setAddCategory] = useState("editing");
  const [addClockIn, setAddClockIn] = useState("");
  const [addClockOut, setAddClockOut] = useState("");
  const [addNotes, setAddNotes] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  // Data fetching
  const {
    data: historyData,
    loading: historyLoading,
    refetch: refetchHistory,
  } = useAdminTimeHistory();
  const {
    data: sessionsData,
    loading: sessionsLoading,
    refetch: refetchSessions,
  } = useAdminActiveSessions();
  const { mutate: editEntry, loading: editing } = useEditTimeEntry();
  const { mutate: voidEntry, loading: voiding } = useVoidTimeEntry();
  const { mutate: addTimeEntry, loading: addingEntry } =
    useAdminAddTimeEntry();
  const { mutate: forceClockOut, loading: forcingClockOut } =
    useForceClockOut();
  const { exportEntries, loading: exporting } = useExportTimeEntries();
  const { data: filterOptions, loading: filterOptionsLoading } =
    useFetchFilterOptions();
  const { data: usersData } = useUsersList();
  const { data: projectsData } = useOrgProjects();

  const users = usersData?.users || [];
  const projects = projectsData?.org_active_projects || [];
  const sessions = sessionsData?.sessions || [];
  const allEntries: TimeEntry[] = historyData?.entries || [];

  // Role-aware UI (F3 Phase 3.4): team_admin's view is server-scoped
  // to managed-team users. The team filter dropdown is restricted
  // to managed teams only — no "All teams" option that would
  // misleadingly imply org-wide scope.
  const { role: viewerRole, loading: roleLoading } = useCurrentUserRole();
  const { teams: managedTeams, loading: managedTeamsLoading } = useManagedTeams();
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

  // Build filter body and refetch when filters change. Each standalone
  // dropdown writes a single-element values array into `filters` so the
  // backend's resolve_filtered_user_ids handles every dimension via the
  // existing pipeline.
  const fetchWithFilters = useCallback(() => {
    const { startDate, endDate } = getDateRange(datePreset, {
      start: customStart,
      end: customEnd,
    });
    const body: Record<string, unknown> = {};
    if (startDate) body.startDate = startDate;
    if (endDate) body.endDate = endDate;
    const categoryKey = resolveCategoryKey(category);
    if (categoryKey) body.category = categoryKey;
    const filters: Record<string, string[]> = {};
    if (filterCountryId) filters.country = [filterCountryId];
    if (filterRegionId) filters.region = [filterRegionId];
    if (filterTeamId) filters.team = [filterTeamId];
    if (filterRole) filters.role = [filterRole];
    if (filterTimezone) filters.timezone = [filterTimezone];
    if (Object.keys(filters).length > 0) body.filters = filters;
    body.limit = 500;
    body.offset = 0;
    refetchHistory(body).catch(() => {});
  }, [
    datePreset,
    customStart,
    customEnd,
    category,
    filterCountryId,
    filterRegionId,
    filterTeamId,
    filterRole,
    filterTimezone,
    refetchHistory,
  ]);

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
      }, 500);
    };
    window.addEventListener("clock-state-changed", handler);
    return () => window.removeEventListener("clock-state-changed", handler);
  }, [fetchWithFilters, refetchSessions]);

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

  // Client-side filtering (fallback if backend doesn't filter)
  const filteredEntries = useMemo(() => {
    let entries = allEntries;

    const { startDate, endDate } = getDateRange(datePreset, {
      start: customStart,
      end: customEnd,
    });
    if (startDate) {
      const start = new Date(startDate);
      entries = entries.filter(
        (e) => e.clockIn && new Date(e.clockIn) >= start
      );
    }
    if (endDate) {
      const end = new Date(endDate);
      entries = entries.filter((e) => e.clockIn && new Date(e.clockIn) < end);
    }

    const filterKey = resolveCategoryKey(category);
    if (filterKey) {
      entries = entries.filter((e) => resolveCategoryKey(e.category) === filterKey);
    }

    if (userSearch.trim()) {
      const search = userSearch.trim().toLowerCase();
      entries = entries.filter(
        (e) => e.userName?.toLowerCase().includes(search)
      );
    }

    return entries;
  }, [allEntries, datePreset, customStart, customEnd, category, userSearch]);

  // Filter active sessions by category and user search
  const filteredSessions = useMemo(() => {
    let filtered = sessions;
    const filterKey = resolveCategoryKey(category);
    if (filterKey) {
      filtered = filtered.filter((s) => resolveCategoryKey(s.category) === filterKey);
    }
    if (userSearch.trim()) {
      const search = userSearch.trim().toLowerCase();
      filtered = filtered.filter(
        (s) => s.userName?.toLowerCase().includes(search)
      );
    }
    return filtered;
  }, [sessions, category, userSearch]);

  // Stat computations
  const stats = useMemo(() => {
    const totalSeconds = filteredEntries.reduce(
      (sum, e) => sum + (e.durationSeconds ?? 0),
      0
    );

    const pendingAdjustments = filteredEntries.filter((e) =>
      e.notes?.startsWith("[ADJUSTMENT REQUESTED]")
    ).length;

    const voidedEntries = filteredEntries.filter(
      (e) => e.status === "voided"
    ).length;

    return {
      totalHours: secondsToHours(totalSeconds),
      activeSessions: filteredSessions.length,
      pendingAdjustments,
      voidedEntries,
    };
  }, [filteredEntries, filteredSessions]);

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
    (page + 1) * PAGE_SIZE
  );
  const showingFrom = totalEntries === 0 ? 0 : page * PAGE_SIZE + 1;
  const showingTo = Math.min((page + 1) * PAGE_SIZE, totalEntries);

  // --- Handlers ---

  const handleForceClockOut = async (id: number) => {
    try {
      await forceClockOut({ session_id: id });
      toast.success("User has been clocked out");
      await refetchSessions();
      await refetchHistory();
    } catch {
      toast.error("Failed to force clock out");
    }
  };

  const handleOpenEdit = (entry: TimeEntry) => {
    setEditingEntry(entry);
    setEditClockIn(entry.clockIn ? toDatetimeLocal(entry.clockIn) : "");
    setEditClockOut(entry.clockOut ? toDatetimeLocal(entry.clockOut) : "");
    setEditCategory(resolveCategoryKey(entry.category) ?? "editing");
    setEditError(null);
  };

  const handleSaveEdit = async () => {
    if (!editingEntry) return;
    setEditError(null);

    if (!editClockIn) {
      setEditError("Clock in time is required");
      return;
    }

    try {
      await editEntry({
        entry_id: editingEntry.id,
        clockIn: fromDatetimeLocal(editClockIn),
        clockOut: editClockOut ? fromDatetimeLocal(editClockOut) : undefined,
        category: editCategory,
      });
      setEditingEntry(null);
      toast.success("Time entry updated");
      fetchWithFilters();
      // Tell PendingAdjustmentsStrip (and anyone else listening) to
      // re-fetch so a just-resolved adjustment disappears immediately.
      window.dispatchEvent(new Event("time-entry-updated"));
    } catch (err) {
      setEditError(
        err instanceof Error ? err.message : "Failed to update entry"
      );
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
    setAddUserId("");
    setAddProjectId("");
    setAddCategory("editing");
    setAddClockIn("");
    setAddClockOut("");
    setAddNotes("");
    setAddError(null);
    setShowAddEntry(true);
  };

  const handleSaveAddEntry = async () => {
    setAddError(null);
    if (!addUserId) {
      setAddError("User is required");
      return;
    }
    if (!addClockIn) {
      setAddError("Clock in time is required");
      return;
    }
    if (!addClockOut) {
      setAddError("Clock out time is required");
      return;
    }

    try {
      await addTimeEntry({
        userId: addUserId,
        projectId: addProjectId ? Number(addProjectId) : undefined,
        category: addCategory,
        clockIn: fromDatetimeLocal(addClockIn),
        clockOut: fromDatetimeLocal(addClockOut),
        notes: addNotes,
      });
      setShowAddEntry(false);
      toast.success("Time entry created");
      fetchWithFilters();
    } catch (err) {
      setAddError(
        err instanceof Error ? err.message : "Failed to create entry"
      );
    }
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
  if ((historyLoading && !historyData) || roleLoading) {
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
  if (
    isTeamAdmin &&
    !managedTeamsLoading &&
    managedTeams.length === 0
  ) {
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
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Time Management
          </h1>
          <p className="text-muted-foreground" style={{ marginTop: 8 }}>
            Manage time entries, active sessions, and exports
          </p>
        </div>

        <Button variant="outline" size="sm" onClick={handleOpenAddEntry}>
          + Add Entry
        </Button>
      </div>

      {/* Filter Panel — hoisted above stat cards per UI8 (2026-04 meeting).
          Wrapped in a Card so it reads as a visual unit, not a floating row. */}
      <Card className="p-4">
        <div className="flex flex-col gap-4">
          {/* Row 1 — date scope. Preset buttons (with resolved range
              suffixes), Custom inputs when active, and a caption
              spelling out the exact date window the active preset
              implies. Mirrors the layout pattern used on
              /admin/projects so the two pages feel consistent. */}
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
                Showing data from <span className="font-medium text-foreground">{range}</span>
              </div>
            );
          })()}

          </div>

          {/* Row 2 — dimension filters. Mirrors the per-dimension
              dropdown pattern from /admin/projects: each filterable
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
                options={(filterOptions?.dimensions?.region ?? []).map((v) =>
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
                options={(filterOptions?.dimensions?.country ?? []).map((v) =>
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
                          : { value: String(v.id ?? v.name), label: v.name },
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
                    ? { value: v, label: v.charAt(0).toUpperCase() + v.slice(1) }
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
                options={(filterOptions?.dimensions?.timezone ?? []).map((v) =>
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
            <div style={{ fontSize: 20, fontWeight: 700, color: "#ff6b35" }}>
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
            <CardContent style={{ padding: 0, borderTop: "1px solid var(--border)" }}>
              {sessionsLoading ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  Loading active sessions...
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
                              onClick={() => handleForceClockOut(session.id)}
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
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d={sortDir === "asc" ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} />
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
                  "[ADJUSTMENT REQUESTED]"
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
                    <TableCell className={`max-w-[120px] truncate ${isVoided ? "line-through" : ""}`}>
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
                      {entry.clockOut ? formatDateTime(entry.clockOut) : "--"}
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
                          <Badge
                            className="ml-1 text-xs uppercase bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
                          >
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
                            disabled={editing}
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
            Showing {formatNumber(showingFrom).text}-{formatNumber(showingTo).text} of{" "}
            {formatNumber(totalEntries).text}
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
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Edit Entry Modal */}
      <Modal
        isOpen={!!editingEntry}
        onClose={() => setEditingEntry(null)}
        title="Edit Time Entry"
        description={
          editingEntry
            ? `${editingEntry.userName} -- ${editingEntry.projectName || "No project"}`
            : ""
        }
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditingEntry(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleSaveEdit}
              isLoading={editing}
            >
              Save Changes
            </Button>
          </>
        }
      >
        {editingEntry && (
          <div className="space-y-4">
            {editError && (
              <p className="text-sm text-red-600">{editError}</p>
            )}

            {editingEntry.notes?.startsWith("[ADJUSTMENT REQUESTED]") && (
              <div className="rounded-lg bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 p-3">
                <p className="text-xs font-medium text-yellow-800 dark:text-yellow-200 mb-1">
                  User Requested Adjustment
                </p>
                <p className="text-xs text-yellow-700 dark:text-yellow-300">
                  {editingEntry.notes.replace("[ADJUSTMENT REQUESTED] ", "")}
                </p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium mb-1">
                Clock In
              </label>
              <input
                type="datetime-local"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={editClockIn}
                onChange={(e) => setEditClockIn(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Clock Out
              </label>
              <input
                type="datetime-local"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={editClockOut}
                onChange={(e) => setEditClockOut(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Category
              </label>
              <select
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={editCategory}
                onChange={(e) => setEditCategory(e.target.value)}
              >
                {CATEGORY_OPTIONS.map((cat) => (
                  <option key={cat} value={cat}>
                    {categoryLabel(cat)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </Modal>

      {/* Add Entry Modal */}
      <Modal
        isOpen={showAddEntry}
        onClose={() => setShowAddEntry(false)}
        title="Add Time Entry"
        description="Manually create a time entry for a user"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowAddEntry(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleSaveAddEntry}
              isLoading={addingEntry}
            >
              Create Entry
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {addError && <p className="text-sm text-red-600">{addError}</p>}

          <div>
            <label className="block text-sm font-medium mb-1">User</label>
            <select
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={addUserId}
              onChange={(e) => setAddUserId(e.target.value)}
            >
              <option value="">Select a user...</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Project (optional)
            </label>
            <select
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={addProjectId}
              onChange={(e) => setAddProjectId(e.target.value)}
            >
              <option value="">No project</option>
              {sortProjectsAlphabetical(projects).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Category</label>
            <select
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={addCategory}
              onChange={(e) => setAddCategory(e.target.value)}
            >
              {CATEGORY_OPTIONS.map((cat) => (
                <option key={cat} value={cat}>
                  {categoryLabel(cat)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Clock In</label>
            <input
              type="datetime-local"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={addClockIn}
              onChange={(e) => setAddClockIn(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Clock Out</label>
            <input
              type="datetime-local"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={addClockOut}
              onChange={(e) => setAddClockOut(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Notes (optional)
            </label>
            <textarea
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              rows={2}
              value={addNotes}
              onChange={(e) => setAddNotes(e.target.value)}
              placeholder="Reason for manual entry..."
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
