"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Modal,
  Button,
  Select,
  Input,
  Skeleton,
  Spinner,
  useToastActions,
  Val,
  StatCard,
} from "@/components/ui";
import {
  useFetchUserProfile,
  useFetchUserStatsByDate,
  useFetchUserPaymentSummary,
  useFetchUserChangesets,
  useFetchUserActivityChart,
  useFetchUserTaskHistory,
  useFetchCountries,
  useEditTimeEntry,
  useVoidTimeEntry,
  useModifyUserRole,
  useSyncUserProjects,
  useDeactivateUser,
  useReactivateUser,
} from "@/hooks/useApi";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type {
  UserProfileData,
  TimeEntry,
  UserStatsDateProjectBreakdown,
  Changeset,
  ChangesetSummary,
  ActivityDataPoint,
  TaskHistoryEntry,
  UserPaymentSummaryResponse,
} from "@/types";
import { roleLabel, isOrgAdminOrAbove } from "@/types";
import { useCurrentUserRole } from "@/hooks";
import { formatNumber, formatCurrency } from "@/lib/utils";
import {
  dateInputToLocalStartIsoUtc,
  dateInputToLocalEndIsoUtc,
} from "@/lib/timeTracking";
import { RecentActivityCard } from "@/components/admin/RecentActivityCard";
import { AssignedProjectsTable } from "@/components/admin/AssignedProjectsTable";
import { NotesButton } from "@/components/widgets/NotesButton";
import { formatDurationHM, resolveCategoryKey, localDayEndIsoUtc, localWeekStartIsoUtc, localMonthStartIsoUtc } from "@/lib/timeTracking";
import { openChangesetInJosm, zoomToChangeset } from "@/lib/josmRemoteControl";

const MappingHeatmap = dynamic(() => import("@/components/MappingHeatmap"), {
  ssr: false,
  loading: () => (
    <div className="h-[400px] bg-muted rounded-lg animate-pulse flex items-center justify-center">
      <p className="text-sm text-muted-foreground">Loading map...</p>
    </div>
  ),
});

type DatePreset = "daily" | "weekly" | "monthly" | "custom";

const TIME_CATEGORY_OPTIONS = ["mapping", "validation", "review", "training", "other"];

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

function formatDate(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(seconds: number | null): string {
  return formatDurationHM(seconds);
}

// Calendar-aligned semantics — same spec as the rest of Mikro:
//   Daily   = today (single day)
//   Weekly  = Sun → Sat of the CURRENT week (NOT rolling 7-day)
//   Monthly = month-to-date (NOT rolling 30-day)
// Returns YYYY-MM-DD strings anchored to the admin's local calendar.
// Those get converted to local-midnight ISO UTC instants at the call site
// before hitting the backend (see dateInputToLocal*IsoUtc helpers).
function getDateRange(preset: DatePreset): { start: string; end: string } {
  const now = new Date();
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const today = fmt(now);

  switch (preset) {
    case "daily":
      return { start: today, end: today };
    case "weekly": {
      const day = now.getDay(); // 0 = Sunday
      const sunday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
      const saturday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 6);
      return { start: fmt(sunday), end: fmt(saturday) };
    }
    case "monthly": {
      const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start: fmt(firstOfMonth), end: today };
    }
    default:
      return { start: today, end: today };
  }
}

export default function UserProfilePage() {
  const params = useParams();
  const userId = decodeURIComponent(params.id as string);

  const {
    mutate: fetchProfile,
    loading: profileLoading,
    error: profileError,
  } = useFetchUserProfile();
  const { mutate: fetchStats, loading: statsLoading } =
    useFetchUserStatsByDate();
  const { mutate: fetchPaymentSummary } = useFetchUserPaymentSummary();
  const { mutate: fetchChangesets } = useFetchUserChangesets();
  const { mutate: fetchActivity } = useFetchUserActivityChart();
  const { mutate: fetchTaskHistory } = useFetchUserTaskHistory();
  const { data: countriesData } = useFetchCountries();
  const { mutate: editTimeEntry, loading: editingTimeEntry } = useEditTimeEntry();
  const { mutate: voidTimeEntry } = useVoidTimeEntry();
  const { mutate: modifyUser, loading: updateDetailsLoading } = useModifyUserRole();
  const { mutate: syncUserProjects, loading: syncing } = useSyncUserProjects();
  const { mutate: deactivateUser, loading: deactivating } = useDeactivateUser();
  const { mutate: reactivateUser, loading: reactivating } = useReactivateUser();
  const toast = useToastActions();
  const { role: viewerRole } = useCurrentUserRole();
  const canEditRole = isOrgAdminOrAbove(viewerRole);

  const [user, setUser] = useState<UserProfileData | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [datePreset, setDatePreset] = useState<DatePreset>("monthly");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [customStartTime, setCustomStartTime] = useState("00:00");
  const [customEndTime, setCustomEndTime] = useState("23:59");
  const [filteredEntries, setFilteredEntries] = useState<TimeEntry[]>([]);
  const [filteredProjects, setFilteredProjects] = useState<
    UserStatsDateProjectBreakdown[]
  >([]);
  // filteredTotalHours / filteredEntriesCount removed — derived now from
  // filteredEntries via the timeStats useMemo (F6 stats strip).
  const [dateLabel, setDateLabel] = useState("");

  // F6 — Time tab. Fetches its own slice (last 90 days) so it stays
  // independent of the page's date-preset selector. Activates only
  // when the admin clicks the Time tab so the Overview path doesn't
  // pay the cost.
  const [activeTab, setActiveTab] = useState<"overview" | "time" | "payment">("overview");
  const [timeTabEntries, setTimeTabEntries] = useState<TimeEntry[]>([]);
  const [timeTabLoaded, setTimeTabLoaded] = useState(false);
  const [timeTabLoading, setTimeTabLoading] = useState(false);
  const [timeTabPage, setTimeTabPage] = useState(1);

  // Payment tab — lazy-loaded sibling to the Time tab. Read-only admin
  // view: lifetime totals, recent payments, open requests, and an
  // anomaly list of validated tasks unpaid > 30 days.
  const [paymentSummary, setPaymentSummary] =
    useState<UserPaymentSummaryResponse["summary"] | null>(null);
  const [paymentTabLoaded, setPaymentTabLoaded] = useState(false);
  const [paymentTabLoading, setPaymentTabLoading] = useState(false);
  const PAYMENT_TAB_PAGE_SIZE = 10;
  const [paymentTabPage, setPaymentTabPage] = useState(1);

  // Date-filtered task stats
  const [periodTaskStats, setPeriodTaskStats] = useState({
    tasks_mapped: 0,
    tasks_validated: 0,
    tasks_invalidated: 0,
    validator_validated: 0,
    mapping_earnings: 0,
    validation_earnings: 0,
  });

  // Changeset state — date-filtered, drives the analysis section below
  // the tab strip. Independent of the Recent Activity card's snapshot.
  const [changesets, setChangesets] = useState<Changeset[]>([]);
  const [changesetSummary, setChangesetSummary] =
    useState<ChangesetSummary | null>(null);
  const [hashtagSummary, setHashtagSummary] = useState<
    Record<string, number>
  >({});
  const [changesetsLoading, setChangesetsLoading] = useState(false);
  const [changesetsError, setChangesetsError] = useState<string | null>(null);

  // Recent Activity card — its own dedicated 180-day-window changeset
  // fetch, decoupled from the page's date filter so the top-of-page
  // snapshot is always meaningful regardless of what the buried date
  // picker is set to (or which day of the month it is).
  const [recentChangeset, setRecentChangeset] = useState<Changeset | null>(null);
  const [recentChangesetLoading, setRecentChangesetLoading] = useState(false);
  const [recentChangesetMessage, setRecentChangesetMessage] = useState<
    string | null
  >(null);

  // Activity chart state
  const [activityData, setActivityData] = useState<ActivityDataPoint[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);

  // Task history state
  const [taskHistory, setTaskHistory] = useState<TaskHistoryEntry[]>([]);
  const [taskHistoryLoading, setTaskHistoryLoading] = useState(false);

  // Pagination
  const ROWS_PER_PAGE = 20;
  const [taskPage, setTaskPage] = useState(1);
  const [timePage, setTimePage] = useState(1);
  const [changesetPage, setChangesetPage] = useState(1);

  // Heatmap state
  const [heatmapPoints, setHeatmapPoints] = useState<
    [number, number, number][]
  >([]);

  // Follow-in-JOSM — when the admin toggles this, every click on a
  // changeset row fires a zoom command to their running JOSM instance
  // in the background. Port of Viewer's followInJosm pattern. Last-ID
  // is tracked so re-renders don't re-fire the same zoom.
  const [followInJosm, setFollowInJosm] = useState(false);
  const [lastFollowedChangesetId, setLastFollowedChangesetId] = useState<
    number | null
  >(null);

  // Full edit modal state
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editFirstName, setEditFirstName] = useState("");
  const [editLastName, setEditLastName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editOsmUsername, setEditOsmUsername] = useState("");
  const [editMapillaryUsername2, setEditMapillaryUsername2] = useState("");
  const [editRole, setEditRole] = useState("user");
  const [editTimezone2, setEditTimezone2] = useState("");
  const [editCountryId2, setEditCountryId2] = useState("");
  const [editPaymentsVisible, setEditPaymentsVisible] = useState(false);
  const [editHourlyRate, setEditHourlyRate] = useState<string>("");

  // Time entry edit modal state
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
  const [editClockIn, setEditClockIn] = useState("");
  const [editClockOut, setEditClockOut] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  // Load profile on mount
  useEffect(() => {
    if (userId) {
      fetchProfile({ userId })
        .then((res) => {
          if (res?.user) setUser(res.user);
        })
        .catch(() => {})
        .finally(() => setPageLoading(false));
    }
  }, [userId, fetchProfile]);

  const loadDateStats = useCallback(
    async (startDate: string, endDate: string) => {
      try {
        const res = await fetchStats({
          userId,
          startDate: dateInputToLocalStartIsoUtc(startDate),
          endDate: dateInputToLocalEndIsoUtc(endDate),
        });
        if (res?.stats) {
          setFilteredEntries(res.stats.time_entries || []);
          setFilteredProjects(res.stats.projects || []);
          // Total hours / sessions count are now computed from the
          // filteredEntries list via the timeStats useMemo, so we no
          // longer need to mirror res.stats.total_hours into state.
          setDateLabel(
            `${formatDate(res.stats.startDate)} - ${formatDate(res.stats.endDate)}`
          );
          setPeriodTaskStats({
            tasks_mapped: res.stats.tasks_mapped || 0,
            tasks_validated: res.stats.tasks_validated || 0,
            tasks_invalidated: res.stats.tasks_invalidated || 0,
            validator_validated: res.stats.validator_validated || 0,
            mapping_earnings: res.stats.mapping_earnings || 0,
            validation_earnings: res.stats.validation_earnings || 0,
          });
        }
      } catch {
        // Error handled by hook
      }
    },
    [userId, fetchStats]
  );

  // Recent Activity card's dedicated changeset fetch. 180-day window,
  // single fast pass (no per-changeset OSM detail calls — the card only
  // needs id + createdAt + changesCount). Backend already returns
  // changesets sorted newest-first by createdAt, so [0] is the right
  // pick. Independent of the page's date-filter selector.
  const loadRecentChangeset = useCallback(
    async (uid: string) => {
      setRecentChangesetLoading(true);
      setRecentChangesetMessage(null);
      const now = new Date();
      const start = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - 180,
      )
        .toISOString()
        .slice(0, 10);
      const end = now.toISOString().slice(0, 10);
      try {
        const res = await fetchChangesets({ userId: uid, startDate: start, endDate: end });
        setRecentChangeset(res?.changesets?.[0] ?? null);
        // Backend's status-200 responses can carry an explanatory
        // `message` even when changesets are empty (e.g. "No OSM
        // username set for this user"). Surface it verbatim so admins
        // can tell apart "no OSM linked" from "no recent activity".
        if (res?.message && !res.changesets?.length) {
          setRecentChangesetMessage(res.message);
        }
      } catch {
        setRecentChangeset(null);
        setRecentChangesetMessage("Couldn't reach OSM API");
      } finally {
        setRecentChangesetLoading(false);
      }
    },
    [fetchChangesets],
  );

  const loadChangesets = useCallback(
    async (startDate: string, endDate: string) => {
      setChangesetsLoading(true);
      setChangesetsError(null);
      try {
        // Fast first pass — no per-changeset detail fetching
        const res = await fetchChangesets({ userId, startDate, endDate });
        if (res?.changesets) {
          setChangesets(res.changesets);
          setChangesetSummary(res.summary || null);
          setHashtagSummary(res.hashtagSummary || {});
          if (res.heatmapPoints) {
            setHeatmapPoints(res.heatmapPoints);
          }
          // Background pass — fetch added/modified/deleted details
          if (res.changesets.length > 0) {
            fetchChangesets({ userId, startDate, endDate, includeDetails: true })
              .then((detailRes) => {
                if (detailRes?.changesets) {
                  setChangesets(detailRes.changesets);
                  setChangesetSummary(detailRes.summary || null);
                }
              })
              .catch(() => {}); // silently fail — we already have the base data
          }
        }
        if (res?.message && !res.changesets?.length) {
          setChangesetsError(res.message);
        }
      } catch {
        setChangesetsError("Failed to load changeset data");
      } finally {
        setChangesetsLoading(false);
      }
    },
    [userId, fetchChangesets]
  );

  const loadActivity = useCallback(
    async (startDate: string, endDate: string) => {
      setActivityLoading(true);
      try {
        const res = await fetchActivity({ userId, startDate, endDate });
        setActivityData(res?.activity || []);
      } catch {
        // handled
      } finally {
        setActivityLoading(false);
      }
    },
    [userId, fetchActivity]
  );

  const loadTaskHistory = useCallback(
    async (startDate: string, endDate: string) => {
      setTaskHistoryLoading(true);
      try {
        const res = await fetchTaskHistory({ userId, startDate, endDate });
        setTaskHistory(res?.tasks || []);
      } catch {
        // handled
      } finally {
        setTaskHistoryLoading(false);
      }
    },
    [userId, fetchTaskHistory]
  );

  // Load date-filtered stats + changesets + activity + history when preset changes
  useEffect(() => {
    if (!userId || datePreset === "custom") return;
    const { start, end } = getDateRange(datePreset);
    loadDateStats(start, end);
    loadChangesets(start, end);
    loadActivity(start, end);
    loadTaskHistory(start, end);
  }, [userId, datePreset, loadDateStats, loadChangesets, loadActivity, loadTaskHistory]);

  // Recent Activity card's snapshot fetch. Fires once when userId
  // becomes available — does NOT depend on datePreset, so changing
  // the buried date filter never affects the top-of-page snapshot.
  useEffect(() => {
    if (!userId) return;
    loadRecentChangeset(userId);
  }, [userId, loadRecentChangeset]);

  // F6 — Time tab data loader. 90-day slice, independent of the
  // page-level date preset so the Time tab's stats (this-week,
  // this-month) are stable regardless of what Overview is scoped to.
  // Extracted so both the initial lazy-load effect and the
  // clock-state-changed listener below can share the same fetch.
  const loadTimeTabData = useCallback(async () => {
    if (!userId) return;
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 90)
      .toISOString()
      .slice(0, 10);
    const end = now.toISOString().slice(0, 10);
    try {
      const res = await fetchStats({
        userId,
        startDate: dateInputToLocalStartIsoUtc(start),
        endDate: dateInputToLocalEndIsoUtc(end),
      });
      if (res?.stats?.time_entries) {
        setTimeTabEntries(res.stats.time_entries);
      }
    } catch {
      /* error handled by hook */
    }
  }, [userId, fetchStats]);

  // Initial lazy-load on first tab activation.
  useEffect(() => {
    if (!userId || activeTab !== "time" || timeTabLoaded || timeTabLoading) return;
    setTimeTabLoading(true);
    loadTimeTabData()
      .finally(() => {
        setTimeTabLoaded(true);
        setTimeTabLoading(false);
      });
  }, [userId, activeTab, timeTabLoaded, timeTabLoading, loadTimeTabData]);

  // Auto-refresh when anyone clocks in/out so the Time tab's stats
  // reflect the just-completed session without a manual page reload.
  // If the admin is currently on the Time tab → refetch ~500ms later
  // (lets the backend commit). If they're on a different tab → just
  // invalidate the cache so their next visit reloads fresh.
  useEffect(() => {
    const handler = () => {
      if (activeTab === "time") {
        setTimeout(() => loadTimeTabData(), 500);
      } else {
        setTimeTabLoaded(false);
      }
    };
    window.addEventListener("clock-state-changed", handler);
    return () => window.removeEventListener("clock-state-changed", handler);
  }, [activeTab, loadTimeTabData]);

  // Payment tab — lazy-loaded on first activation. Single round-trip
  // returns lifetime totals, recent payments, open requests, and
  // anomalies (validated tasks unpaid > 30 days).
  useEffect(() => {
    if (!userId || activeTab !== "payment" || paymentTabLoaded || paymentTabLoading) return;
    setPaymentTabLoading(true);
    fetchPaymentSummary({ userId })
      .then((res) => {
        if (res?.summary) {
          setPaymentSummary(res.summary);
        }
        setPaymentTabLoaded(true);
      })
      .catch(() => {
        setPaymentTabLoaded(true);
      })
      .finally(() => setPaymentTabLoading(false));
  }, [userId, activeTab, paymentTabLoaded, paymentTabLoading, fetchPaymentSummary]);

  const handleApplyCustom = () => {
    if (customStart && customEnd) {
      const startDT = `${customStart}T${customStartTime}:00`;
      const endDT = `${customEnd}T${customEndTime}:00`;
      loadDateStats(startDT, endDT);
      loadChangesets(customStart, customEnd);
      loadActivity(customStart, customEnd);
      loadTaskHistory(customStart, customEnd);
    }
  };

  // Time entry edit/void handlers
  const handleOpenEditEntry = (entry: TimeEntry) => {
    setEditingEntry(entry);
    setEditClockIn(entry.clockIn ? toDatetimeLocal(entry.clockIn) : "");
    setEditClockOut(entry.clockOut ? toDatetimeLocal(entry.clockOut) : "");
    setEditCategory(resolveCategoryKey(entry.category) ?? "editing");
    setEditError(null);
  };

  const handleSaveEditEntry = async () => {
    if (!editingEntry) return;
    setEditError(null);
    if (!editClockIn) {
      setEditError("Clock in time is required");
      return;
    }
    try {
      await editTimeEntry({
        entry_id: editingEntry.id,
        clockIn: fromDatetimeLocal(editClockIn),
        clockOut: editClockOut ? fromDatetimeLocal(editClockOut) : undefined,
        category: editCategory,
      });
      setEditingEntry(null);
      toast.success("Time entry updated");
      // Refresh the current date range. Always go through getDateRange so
      // this stays in lock-step with the calendar-aligned semantics
      // (Sun-Sat week, MTD month) and never drifts back to rolling math.
      if (datePreset !== "custom") {
        const range = getDateRange(datePreset);
        loadDateStats(`${range.start}T00:00:00`, `${range.end}T23:59:59`);
      } else if (customStart && customEnd) {
        loadDateStats(
          `${customStart}T${customStartTime}:00`,
          `${customEnd}T${customEndTime}:00`
        );
      }
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to update entry");
    }
  };

  const handleVoidEntry = async (entry: TimeEntry) => {
    try {
      await voidTimeEntry({ entry_id: entry.id });
      toast.success("Time entry voided");
      setFilteredEntries((prev) =>
        prev.map((e) => (e.id === entry.id ? { ...e, status: "voided" as const } : e))
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to void entry");
    }
  };

  const exportChangesetsCSV = () => {
    const header =
      "Changeset ID,Date,Changes,Added,Modified,Deleted,Comment,Hashtags\n";
    const rows = changesets
      .map(
        (c) =>
          `${c.id},"${formatDateTime(c.createdAt)}",${c.changesCount},${c.added ?? ""},${c.modified ?? ""},${c.deleted ?? ""},"${(c.comment || "").replace(/"/g, '""')}","${c.hashtags.join("; ")}"`
      )
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${user?.osm_username || "user"}_changesets_${customStart || "all"}_${customEnd || "all"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const openEditModal = () => {
    if (!user) return;
    setEditFirstName(user.first_name || "");
    setEditLastName(user.last_name || "");
    setEditEmail(user.email || "");
    setEditOsmUsername(user.osm_username || "");
    setEditMapillaryUsername2(user.mapillary_username || "");
    setEditRole(user.role || "user");
    setEditTimezone2(user.timezone || "");
    setEditCountryId2(user.country_id ? String(user.country_id) : "");
    setEditPaymentsVisible(user.micropayments_visible ?? false);
    setEditHourlyRate(user.hourly_rate?.toString() ?? "");
    setEditModalOpen(true);
  };

  const handleSaveEditModal = async () => {
    try {
      await modifyUser({
        user_id: userId,
        first_name: editFirstName,
        last_name: editLastName,
        email: editEmail,
        osm_username: editOsmUsername,
        mapillary_username: editMapillaryUsername2 || null,
        role: editRole,
        timezone: editTimezone2 || null,
        country_id: editCountryId2 ? Number(editCountryId2) : null,
        micropayments_visible: editPaymentsVisible,
        hourly_rate: editHourlyRate ? parseFloat(editHourlyRate) : null,
      });
      toast.success("User updated");
      setEditModalOpen(false);
      fetchProfile({ userId }).then((res) => {
        if (res?.user) setUser(res.user);
      });
    } catch {
      toast.error("Failed to update user");
    }
  };

  const handleToggleActive = async () => {
    if (!user) return;
    const isCurrentlyActive = user.is_active !== false;
    const verb = isCurrentlyActive ? "deactivate" : "reactivate";
    if (
      !window.confirm(
        isCurrentlyActive
          ? `Deactivate ${user.full_name || user.email || "this user"}? They will be blocked from logging in until you reactivate them. Their historical data is preserved.`
          : `Reactivate ${user.full_name || user.email || "this user"}? They will be able to log in again.`,
      )
    )
      return;
    try {
      if (isCurrentlyActive) {
        await deactivateUser({ user_id: userId });
      } else {
        await reactivateUser({ user_id: userId });
      }
      toast.success(`User ${verb}d`);
      const res = await fetchProfile({ userId });
      if (res?.user) setUser(res.user);
    } catch {
      toast.error(`Failed to ${verb} user`);
    }
  };

  // F6 — per-user time-detail stats. Computed from the entries the
  // existing date-preset already pulled, so this is "free" — no extra
  // request. Voided entries are excluded so they don't pollute the
  // averages or longest-session figure.
  const timeStats = useMemo(() => {
    const completed = filteredEntries.filter(
      (e) => e.status === "completed" && (e.durationSeconds ?? 0) > 0
    );
    const totalSeconds = completed.reduce(
      (sum, e) => sum + (e.durationSeconds ?? 0),
      0
    );
    const count = completed.length;
    const avgSeconds = count > 0 ? Math.round(totalSeconds / count) : 0;
    const longestSeconds = completed.reduce(
      (max, e) => Math.max(max, e.durationSeconds ?? 0),
      0
    );
    return { totalSeconds, count, avgSeconds, longestSeconds };
  }, [filteredEntries]);

  // F6 — Time tab computed values from the 90-day window.
  // Hours This Week / Month are the calendar-aligned slices (matching
  // the Sun-Sat / month-to-date semantics from §3.5).
  // Avg Session is over completed entries in the 90-day window.
  // Anomalies surface two patterns we can detect from this data alone:
  //   - active sessions older than 12 hours (likely forgot to clock out)
  //   - completed sessions over 12 hours long (likely should have ended sooner)
  const timeTabComputed = useMemo(() => {
    const completed = timeTabEntries.filter(
      (e) => e.status === "completed" && (e.durationSeconds ?? 0) > 0
    );
    const totalSeconds = completed.reduce(
      (s, e) => s + (e.durationSeconds ?? 0),
      0
    );
    const avgSessionSeconds = completed.length
      ? Math.round(totalSeconds / completed.length)
      : 0;

    const weekStartIso = localWeekStartIsoUtc();
    const monthStartIso = localMonthStartIsoUtc();
    const dayEndIso = localDayEndIsoUtc();

    const inWindow = (clockIn: string | null, startIso: string, endIso: string) => {
      if (!clockIn) return false;
      return clockIn >= startIso && clockIn < endIso;
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
    for (const e of timeTabEntries) {
      if (e.status === "active" && e.clockIn) {
        const elapsedSec = Math.floor((nowMs - new Date(e.clockIn).getTime()) / 1000);
        if (elapsedSec > TWELVE_HOURS) {
          anomalies.push({
            entry: e,
            reason: `Active session running ${formatDurationHM(elapsedSec)} — likely forgot to clock out`,
          });
        }
      } else if (
        e.status === "completed" &&
        (e.durationSeconds ?? 0) > TWELVE_HOURS
      ) {
        anomalies.push({
          entry: e,
          reason: `Completed session of ${formatDurationHM(e.durationSeconds ?? 0)} — unusually long`,
        });
      }
    }

    // Recent entries: chronologically descending by clock_in.
    const recent = [...timeTabEntries].sort((a, b) => {
      const ai = a.clockIn ?? "";
      const bi = b.clockIn ?? "";
      if (ai === bi) return 0;
      return ai < bi ? 1 : -1;
    });

    return {
      hoursThisWeek,
      hoursThisMonth,
      avgSessionSeconds,
      avgSessionDenom: completed.length,
      anomalies,
      recent,
    };
  }, [timeTabEntries]);

  const TIME_TAB_PAGE_SIZE = 10;
  const timeTabPagedRecent = timeTabComputed.recent.slice(
    (timeTabPage - 1) * TIME_TAB_PAGE_SIZE,
    timeTabPage * TIME_TAB_PAGE_SIZE
  );
  const timeTabTotalPages = Math.max(
    1,
    Math.ceil(timeTabComputed.recent.length / TIME_TAB_PAGE_SIZE)
  );

  const countryOptions = useMemo(() => {
    const countries = countriesData?.countries || [];
    return [
      { value: "", label: "No country" },
      ...countries.map((c) => ({
        value: String(c.id),
        label: c.name,
      })),
    ];
  }, [countriesData]);

  if (profileError && !user && !pageLoading) {
    return (
      <div className="space-y-4">
        <Link
          href="/admin/users"
          className="text-kaart-orange hover:underline text-sm"
        >
          {"\u2190"} Back to Users
        </Link>
        <Card>
          <CardContent className="p-8 text-center text-red-500">
            Failed to load user profile: {profileError}
          </CardContent>
        </Card>
      </div>
    );
  }

  // All admin tiers can validate (org/team_admin/super_admin) plus the validator role.
  const isValidator =
    user?.role === "validator" ||
    user?.role === "admin" ||
    user?.role === "super_admin" ||
    user?.role === "team_admin";
  const displayedChangesets = changesets.slice((changesetPage - 1) * ROWS_PER_PAGE, changesetPage * ROWS_PER_PAGE);
  const displayedHistory = taskHistory.slice((taskPage - 1) * ROWS_PER_PAGE, taskPage * ROWS_PER_PAGE);
  const sortedHashtags = Object.entries(hashtagSummary).sort(
    (a, b) => b[1] - a[1]
  );

  const isLoadingAnything =
    profileLoading || pageLoading || statsLoading || changesetsLoading ||
    activityLoading || taskHistoryLoading;

  return (
    <div className="space-y-6">
      {/* Top-of-page loading banner. Section-level skeletons on their own
          don't always read as "active" to users — a visible spinner
          + label makes it unambiguous that fetches are still in flight.
          Disappears once every known in-flight request settles. */}
      {isLoadingAnything && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-muted/60 border border-input text-sm text-muted-foreground sticky top-16 z-30 backdrop-blur">
          <Spinner size="sm" />
          <span>
            {!user
              ? "Loading user profile..."
              : statsLoading
              ? "Loading time stats..."
              : changesetsLoading
              ? "Loading change-set analysis..."
              : activityLoading
              ? "Loading activity chart..."
              : taskHistoryLoading
              ? "Loading task history..."
              : "Loading..."}
          </span>
        </div>
      )}

      {/* Section 1: Header */}
      <Card>
        <CardContent className="p-6">
          <Link
            href="/admin/users"
            className="text-kaart-orange hover:underline text-sm mb-4 inline-block"
          >
            {"\u2190"} Back to Users
          </Link>
          {!user ? (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <Skeleton className="w-16 h-16 rounded-full" />
                <div className="space-y-2">
                  <Skeleton className="h-7 w-48" />
                  <Skeleton className="h-4 w-32" />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                <Skeleton className="h-32 rounded-lg" />
                <Skeleton className="h-32 rounded-lg" />
                <Skeleton className="h-32 rounded-lg" />
              </div>
            </div>
          ) : (
          <>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-kaart-orange flex items-center justify-center text-white text-xl font-bold shrink-0">
                {(user.first_name?.[0] || user.email?.[0] || "?").toUpperCase()}
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-2xl font-bold tracking-tight">
                    {user.full_name || user.email || user.id}
                  </h1>
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    user.role === "super_admin" ? "bg-pink-100 text-pink-800" :
                    user.role === "admin" ? "bg-purple-100 text-purple-800" :
                    user.role === "team_admin" ? "bg-indigo-100 text-indigo-800" :
                    user.role === "validator" ? "bg-blue-100 text-blue-800" :
                    "bg-gray-100 text-gray-800"
                  }`}>
                    {roleLabel(user.role)}
                  </span>
                  {user.mapper_level > 0 && (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                      Level {user.mapper_level}
                    </span>
                  )}
                  {user.is_active === false && (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                      Deactivated
                    </span>
                  )}
                </div>
                {user.name_last_change && (
                  <p
                    className="text-xs text-muted-foreground mt-1"
                    title={`${user.name_last_change.old_first_name ?? ""} ${user.name_last_change.old_last_name ?? ""} → ${user.name_last_change.new_first_name ?? ""} ${user.name_last_change.new_last_name ?? ""}`}
                  >
                    Name last changed{" "}
                    {new Date(user.name_last_change.changed_at).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    via <span className="font-mono">{user.name_last_change.source}</span>
                    {user.name_last_change.changed_by_name && (
                      <> by {user.name_last_change.changed_by_name}</>
                    )}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleToggleActive}
                disabled={deactivating || reactivating}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
                  user.is_active === false
                    ? "bg-kaart-orange text-white hover:bg-kaart-orange-dark"
                    : "border border-red-300 dark:border-red-800 text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                }`}
                title={
                  user.is_active === false
                    ? "Allow this user to log in again"
                    : "Block this user from logging in (data preserved)"
                }
              >
                {user.is_active === false
                  ? reactivating ? "Reactivating..." : "Reactivate"
                  : deactivating ? "Deactivating..." : "Deactivate"}
              </button>
              <button
                onClick={async () => {
                  try {
                    const res = await syncUserProjects({ user_id: userId });
                    toast.success(res.message || "Sync queued");
                  } catch {
                    toast.error("Failed to queue sync");
                  }
                }}
                disabled={syncing}
                className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-kaart-orange"
                title="Sync all assigned projects"
              >
                <svg className={`w-5 h-5 ${syncing ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
              <button
                onClick={openEditModal}
                className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-kaart-orange"
                title="Edit user"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="m15 5 4 4" />
                </svg>
              </button>
            </div>
          </div>

          {/* 3-column info grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
            {/* Accounts */}
            <div className="border border-border rounded-lg p-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Accounts</p>
              <div className="space-y-1.5">
                {user.email && (
                  <div>
                    <span className="text-xs text-muted-foreground">Email</span>
                    <p className="text-sm">{user.email}</p>
                  </div>
                )}
                {user.osm_username && (
                  <div>
                    <span className="text-xs text-muted-foreground">OSM</span>
                    <p className="text-sm">
                      <a
                        href={`https://www.openstreetmap.org/user/${user.osm_username}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-kaart-orange hover:underline"
                      >
                        {user.osm_username}
                      </a>
                    </p>
                  </div>
                )}
                {user.mapillary_username && (
                  <div>
                    <span className="text-xs text-muted-foreground">Mapillary</span>
                    <p className="text-sm">
                      <a
                        href={`https://www.mapillary.com/app/user/${user.mapillary_username}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-kaart-orange hover:underline"
                      >
                        {user.mapillary_username}
                      </a>
                    </p>
                  </div>
                )}
                {user.payment_email && (
                  <div>
                    <span className="text-xs text-muted-foreground">Payment Email</span>
                    <p className="text-sm">{user.payment_email}</p>
                  </div>
                )}
                {user.hourly_rate != null && (
                  <div>
                    <span className="text-xs text-muted-foreground">Hourly Rate</span>
                    <p className="text-sm"><Val>{formatCurrency(user.hourly_rate)}</Val>/hr</p>
                  </div>
                )}
              </div>
            </div>

            {/* Location */}
            <div className="border border-border rounded-lg p-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Location</p>
              <div className="space-y-1.5">
                <div>
                  <span className="text-xs text-muted-foreground">Country</span>
                  <p className="text-sm">{user.country_name || user.country || "Not set"}</p>
                </div>
                {user.region_name && (
                  <div>
                    <span className="text-xs text-muted-foreground">Region</span>
                    <p className="text-sm">{user.region_name}</p>
                  </div>
                )}
                <div>
                  <span className="text-xs text-muted-foreground">Timezone</span>
                  <p className="text-sm">{user.timezone || "Not set"}</p>
                </div>
              </div>
            </div>

            {/* Stats */}
            <div className="border border-border rounded-lg p-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Stats</p>
              <div className="space-y-1.5">
                <div>
                  <span className="text-xs text-muted-foreground">Joined</span>
                  <p className="text-sm">{user.joined ? new Date(user.joined).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Unknown"}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Mapper Points</span>
                  <p className="text-sm font-medium">{user.mapper_points ?? 0}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Validator Points</span>
                  <p className="text-sm font-medium">{user.validator_points ?? 0}</p>
                </div>
              </div>
            </div>
          </div>
          </>
          )}
        </CardContent>
      </Card>

      {/* Recent Activity — top-of-page snapshot (added 2026-04 per UI meeting UI11).
          Pulls its own 180-day-window changeset via loadRecentChangeset so it
          stays meaningful no matter what the buried Date-Filtered Analysis picker
          is set to (or which day of the month it is). */}
      {user && (
        <RecentActivityCard
          user={user}
          recentChangeset={recentChangeset}
          recentChangesetLoading={recentChangesetLoading}
          recentChangesetMessage={recentChangesetMessage}
        />
      )}

      {/* F6 — Tab strip. Overview holds everything that was on this
          page before; Time is the focused per-user view per the
          F6 acceptance criteria (hours this week/month, avg session,
          recent entries, anomalies). */}
      <div className="flex items-center gap-1 border-b border-border">
        {(["overview", "time", "payment"] as const).map((tab) => {
          const label =
            tab === "overview" ? "Overview" : tab === "time" ? "Time" : "Payment";
          const selected = activeTab === tab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                selected
                  ? "border-kaart-orange text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Section 2: All-time Task Stats */}
      {user && activeTab === "overview" && (<>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Tasks Mapped" value={formatNumber(user.total_tasks_mapped)} />
        <StatCard
          label="Tasks Validated"
          value={formatNumber(user.total_tasks_validated)}
        />
        <StatCard
          label="Tasks Invalidated"
          value={formatNumber(user.total_tasks_invalidated)}
        />
        <StatCard
          label="Total Earnings"
          value={formatCurrency(user.payable_total)}
        />
      </div>

      {/* Section 3: Validator Stats (conditional) */}
      {isValidator && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Validated by User"
            value={formatNumber(user.validator_tasks_validated)}
          />
          <StatCard
            label="Invalidated by User"
            value={formatNumber(user.validator_tasks_invalidated)}
          />
          <StatCard
            label="Checklists Completed"
            value={formatNumber(user.total_checklists_completed)}
          />
          <StatCard
            label="Checklists Confirmed"
            value={formatNumber(user.validator_total_checklists_confirmed)}
          />
        </div>
      )}

      {/* Section 4: Payment Summary */}
      <Card>
          <CardHeader>
            <CardTitle>Payment Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <div className="text-center">
                <p className="text-sm text-muted-foreground">Mapping</p>
                <p className="text-lg font-semibold">
                  <Val>{formatCurrency(user.mapping_payable_total)}</Val>
                </p>
              </div>
              <div className="text-center">
                <p className="text-sm text-muted-foreground">Validation</p>
                <p className="text-lg font-semibold">
                  <Val>{formatCurrency(user.validation_payable_total)}</Val>
                </p>
              </div>
              <div className="text-center">
                <p className="text-sm text-muted-foreground">Checklists</p>
                <p className="text-lg font-semibold">
                  <Val>{formatCurrency(user.checklist_payable_total)}</Val>
                </p>
              </div>
              <div className="text-center">
                <p className="text-sm text-muted-foreground">Payable</p>
                <p className="text-lg font-semibold text-green-600">
                  <Val>{formatCurrency(user.payable_total)}</Val>
                </p>
              </div>
              <div className="text-center">
                <p className="text-sm text-muted-foreground">Requested</p>
                <p className="text-lg font-semibold text-yellow-600">
                  <Val>{formatCurrency(user.requested_total)}</Val>
                </p>
              </div>
              <div className="text-center">
                <p className="text-sm text-muted-foreground">Paid</p>
                <p className="text-lg font-semibold text-blue-600">
                  <Val>{formatCurrency(user.paid_total)}</Val>
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

      {/* Section 5b: Project Contribution Stats */}
      {user.projects && user.projects.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Projects</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: 600 }}>
                <thead className="bg-muted border-b border-border">
                  <tr>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-muted-foreground">
                      Project
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-muted-foreground">
                      Mapped
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-muted-foreground">
                      Validated
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-muted-foreground">
                      Invalidated
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-muted-foreground">
                      Earnings
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-card">
                  {user.projects.map((proj) => (
                    <tr key={proj.id}>
                      <td className="px-6 py-4">
                        {proj.url ? (
                          <a
                            href={proj.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-kaart-orange hover:underline"
                          >
                            {proj.name}
                          </a>
                        ) : (
                          <span className="font-medium text-foreground">
                            {proj.name}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-muted-foreground">
                        <Val>{formatNumber(proj.tasks_mapped)}</Val>
                      </td>
                      <td className="px-6 py-4 text-muted-foreground">
                        <Val>{formatNumber(proj.tasks_validated)}</Val>
                      </td>
                      <td className="px-6 py-4 text-muted-foreground">
                        <Val>{formatNumber(proj.tasks_invalidated)}</Val>
                      </td>
                      <td className="px-6 py-4 text-muted-foreground">
                        <Val>{formatCurrency(
                          proj.mapping_earnings + proj.validation_earnings
                        )}</Val>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ═══════════ DATE-FILTERED SECTION ═══════════ */}
      <div className="border-t-2 border-kaart-orange/30 pt-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Date-Filtered Analysis
        </h2>

        {/* Date Range Picker */}
        <Card className="mb-6">
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {(["daily", "weekly", "monthly", "custom"] as DatePreset[]).map(
                (preset) => (
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
                  </button>
                )
              )}
            </div>

            {datePreset === "custom" && (
              <div className="flex items-center gap-2 flex-wrap">
                <label className="text-sm text-muted-foreground">From</label>
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="px-3 py-1.5 border border-input rounded-lg text-sm"
                />
                <input
                  type="time"
                  value={customStartTime}
                  onChange={(e) => setCustomStartTime(e.target.value)}
                  className="px-2 py-1.5 border border-input rounded-lg text-sm"
                />
                <label className="text-sm text-muted-foreground">To</label>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="px-3 py-1.5 border border-input rounded-lg text-sm"
                />
                <input
                  type="time"
                  value={customEndTime}
                  onChange={(e) => setCustomEndTime(e.target.value)}
                  className="px-2 py-1.5 border border-input rounded-lg text-sm"
                />
                <button
                  onClick={handleApplyCustom}
                  disabled={!customStart || !customEnd}
                  className="px-3 py-1.5 bg-kaart-orange text-white rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  Apply
                </button>
              </div>
            )}

            {dateLabel && (
              <p className="text-sm text-muted-foreground">
                Showing: {dateLabel}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Task Stats for Period */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
          <StatCard label="Mapped" value={formatNumber(periodTaskStats.tasks_mapped)} />
          <StatCard label="Validated" value={formatNumber(periodTaskStats.tasks_validated)} />
          <StatCard
            label="Invalidated"
            value={formatNumber(periodTaskStats.tasks_invalidated)}
          />
          <StatCard
            label="Val. by User"
            value={formatNumber(periodTaskStats.validator_validated)}
          />
          <StatCard
            label="Map Earnings"
            value={formatCurrency(periodTaskStats.mapping_earnings)}
          />
          <StatCard

            label="Val Earnings"
            value={formatCurrency(periodTaskStats.validation_earnings)}
          />
        </div>

        {/* Activity Chart */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Activity Overview</CardTitle>
          </CardHeader>
          <CardContent>
            {activityLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-kaart-orange" />
                Loading activity data...
              </div>
            ) : activityData.length > 0 ? (
              <div style={{ width: "100%", height: 300 }}>
                <ResponsiveContainer>
                  <ComposedChart data={activityData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 12 }}
                      tickFormatter={(v: string) =>
                        new Date(v + "T00:00:00").toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })
                      }
                    />
                    <YAxis yAxisId="left" tick={{ fontSize: 12 }} />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      tick={{ fontSize: 12 }}
                    />
                    <Tooltip
                      labelFormatter={(v) =>
                        new Date(String(v) + "T00:00:00").toLocaleDateString(
                          "en-US",
                          {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          }
                        )
                      }
                    />
                    <Legend />
                    <Bar
                      yAxisId="left"
                      dataKey="tasksMapped"
                      name="Tasks Mapped"
                      fill="#f97316"
                      stackId="tasks"
                    />
                    <Bar
                      yAxisId="left"
                      dataKey="tasksValidated"
                      name="Tasks Validated"
                      fill="#3b82f6"
                      stackId="tasks"
                    />
                    <Line
                      yAxisId="right"
                      dataKey="hoursWorked"
                      name="Hours Worked"
                      stroke="#10b981"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            ) : (
              dateLabel && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No activity data for this period.
                </p>
              )
            )}
          </CardContent>
        </Card>

        {/* Time Tracking */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Time Tracking</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {dateLabel && (
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {dateLabel}
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <StatCard
                    label="Total Hours"
                    value={formatDurationHM(timeStats.totalSeconds)}
                  />
                  <StatCard
                    label="Sessions"
                    value={formatNumber(timeStats.count)}
                  />
                  <StatCard
                    label="Avg Session"
                    value={
                      timeStats.count > 0
                        ? formatDurationHM(timeStats.avgSeconds)
                        : "—"
                    }
                  />
                  <StatCard
                    label="Longest Session"
                    value={
                      timeStats.count > 0
                        ? formatDurationHM(timeStats.longestSeconds)
                        : "—"
                    }
                  />
                </div>
              </div>
            )}

            {statsLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-kaart-orange" />
                Loading...
              </div>
            )}

            {filteredEntries.length > 0 ? (
              <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" style={{ minWidth: 500 }}>
                  <thead className="bg-muted border-b border-border">
                    <tr>
                      <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                        Date
                      </th>
                      <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                        Project
                      </th>
                      <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                        Category
                      </th>
                      <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                        Clock In
                      </th>
                      <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                        Clock Out
                      </th>
                      <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                        Duration
                      </th>
                      <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                        Status
                      </th>
                      <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                        Notes
                      </th>
                      <th className="px-4 py-2 text-right font-semibold text-muted-foreground">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border bg-card">
                    {filteredEntries.slice((timePage - 1) * ROWS_PER_PAGE, timePage * ROWS_PER_PAGE).map((entry) => (
                      <tr
                        key={entry.id}
                        className={
                          entry.status === "voided" ? "opacity-50" : ""
                        }
                      >
                        <td className="px-4 py-2">
                          {formatDate(entry.clockIn)}
                        </td>
                        <td className="px-4 py-2">
                          {entry.projectName || "-"}
                        </td>
                        <td className="px-4 py-2">
                          {entry.category || "-"}
                        </td>
                        <td className="px-4 py-2">
                          {formatDateTime(entry.clockIn)}
                        </td>
                        <td className="px-4 py-2">
                          {formatDateTime(entry.clockOut)}
                        </td>
                        <td className="px-4 py-2 font-mono">
                          {formatDuration(entry.durationSeconds)}
                        </td>
                        <td className="px-4 py-2">
                          {entry.status === "completed" ? (
                            <span className="text-green-600">Completed</span>
                          ) : entry.status === "active" ? (
                            <span className="text-yellow-600">Active</span>
                          ) : (
                            <span className="text-red-500">Voided</span>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          <NotesButton
                            notes={entry.userNotes}
                            editable={false}
                            size="xs"
                            title="Note from this entry"
                          />
                        </td>
                        <td className="px-4 py-2 text-right">
                          {entry.status !== "voided" && (
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => handleOpenEditEntry(entry)}
                                className="px-2 py-1 text-xs font-medium rounded border border-border text-foreground hover:bg-muted transition-colors"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => handleVoidEntry(entry)}
                                className="px-2 py-1 text-xs font-medium rounded border border-red-300 dark:border-red-800 text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                              >
                                Void
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filteredEntries.length > ROWS_PER_PAGE && (
                <div className="flex items-center justify-between mt-3 text-sm text-muted-foreground">
                  <span>Showing {(timePage - 1) * ROWS_PER_PAGE + 1}-{Math.min(timePage * ROWS_PER_PAGE, filteredEntries.length)} of {filteredEntries.length}</span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={timePage === 1}
                      onClick={() => setTimePage(p => p - 1)}>Previous</Button>
                    <span className="flex items-center px-2">Page {timePage} of {Math.ceil(filteredEntries.length / ROWS_PER_PAGE)}</span>
                    <Button variant="outline" size="sm" disabled={timePage === Math.ceil(filteredEntries.length / ROWS_PER_PAGE)}
                      onClick={() => setTimePage(p => p + 1)}>Next</Button>
                  </div>
                </div>
              )}
              </>
            ) : (
              !statsLoading &&
              dateLabel && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No time entries found for this period.
                </p>
              )
            )}

            {filteredProjects.length > 0 && (
              <div className="mt-4">
                <h4 className="text-sm font-semibold text-muted-foreground mb-2">
                  Per-project hours
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" style={{ minWidth: 500 }}>
                    <thead className="bg-muted border-b border-border">
                      <tr>
                        <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                          Project
                        </th>
                        <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                          Hours
                        </th>
                        <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                          Sessions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border bg-card">
                      {filteredProjects.map((proj) => (
                        <tr key={proj.id}>
                          <td className="px-4 py-2 font-medium">{proj.name}</td>
                          <td className="px-4 py-2">
                            {proj.total_hours.toFixed(1)}h
                          </td>
                          <td className="px-4 py-2">{proj.entries_count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Task History */}
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Task History</CardTitle>
              {taskHistory.length > 0 && (
                <span className="text-sm text-muted-foreground">
                  {taskHistory.length} tasks
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {taskHistoryLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-kaart-orange" />
                Loading task history...
              </div>
            ) : taskHistory.length > 0 ? (
              <div className="space-y-3">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" style={{ minWidth: 500 }}>
                    <thead className="bg-muted border-b border-border">
                      <tr>
                        <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                          Task
                        </th>
                        <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                          Project
                        </th>
                        <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                          Action
                        </th>
                        <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                          Date
                        </th>
                        <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                          Status
                        </th>
                        <th className="px-4 py-2 text-right font-semibold text-muted-foreground">
                          Rate
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border bg-card">
                      {displayedHistory.map((t, i) => (
                        <tr key={`${t.taskId}-${t.action}-${i}`}>
                          <td className="px-4 py-2 font-mono">#{t.taskId}</td>
                          <td className="px-4 py-2">{t.projectName}</td>
                          <td className="px-4 py-2">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                t.action === "mapped"
                                  ? "bg-orange-100 text-orange-800"
                                  : t.action === "validated"
                                    ? "bg-blue-100 text-blue-800"
                                    : "bg-red-100 text-red-800"
                              }`}
                            >
                              {t.action}
                            </span>
                          </td>
                          <td className="px-4 py-2 whitespace-nowrap">
                            {formatDateTime(t.date)}
                          </td>
                          <td className="px-4 py-2">{t.status}</td>
                          <td className="px-4 py-2 text-right font-mono">
                            <Val>{formatCurrency(t.mappingRate || t.validationRate)}</Val>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {taskHistory.length > ROWS_PER_PAGE && (
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>Showing {(taskPage - 1) * ROWS_PER_PAGE + 1}-{Math.min(taskPage * ROWS_PER_PAGE, taskHistory.length)} of {taskHistory.length}</span>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" disabled={taskPage === 1}
                        onClick={() => setTaskPage(p => p - 1)}>Previous</Button>
                      <span className="flex items-center px-2">Page {taskPage} of {Math.ceil(taskHistory.length / ROWS_PER_PAGE)}</span>
                      <Button variant="outline" size="sm" disabled={taskPage === Math.ceil(taskHistory.length / ROWS_PER_PAGE)}
                        onClick={() => setTaskPage(p => p + 1)}>Next</Button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              dateLabel && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No task history for this period.
                </p>
              )
            )}
          </CardContent>
        </Card>

        {/* Changeset Analysis */}
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle>Changeset Analysis</CardTitle>
              <div className="flex items-center gap-3">
                {/* Follow-in-JOSM toggle — when on, clicking a row zooms
                    JOSM to that changeset automatically. Mirrors Viewer's
                    same-named feature. */}
                <label className="flex items-center gap-2 text-xs text-muted-foreground select-none cursor-pointer">
                  <input
                    type="checkbox"
                    checked={followInJosm}
                    onChange={(e) => {
                      setFollowInJosm(e.target.checked);
                      if (!e.target.checked) setLastFollowedChangesetId(null);
                    }}
                    className="rounded border-input"
                    title="When on, each row click zooms your running JOSM instance to that changeset"
                  />
                  <span>Follow in JOSM</span>
                </label>
                {changesets.length > 0 && (
                  <button
                    onClick={exportChangesetsCSV}
                    className="px-3 py-1.5 bg-muted text-muted-foreground hover:bg-muted/80 rounded-lg text-sm font-medium transition-colors"
                  >
                    Export CSV
                  </button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {changesetsLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-kaart-orange" />
                Loading changeset data from OSM...
              </div>
            )}

            {changesetsError && !changesetsLoading && (
              <p className="text-sm text-muted-foreground text-center py-4">
                {changesetsError}
              </p>
            )}

            {/* Summary cards */}
            {changesetSummary && !changesetsLoading && (
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
                <StatCard
                  label="Changesets"
                  value={changesetSummary.totalChangesets}
                />
                <StatCard
                  label="Total Changes"
                  value={changesetSummary.totalChanges}
                />
                <StatCard
                  label="Added"
                  value={changesetSummary.totalAdded}
                  sub="+ created"
                />
                <StatCard
                  label="Modified"
                  value={changesetSummary.totalModified}
                  sub="~ edited"
                />
                <StatCard
                  label="Deleted"
                  value={changesetSummary.totalDeleted}
                  sub="- removed"
                />
                <StatCard
                  label="Nodes"
                  value={changesetSummary.totalNodes}
                  sub="points"
                />
                <StatCard
                  label="Ways"
                  value={changesetSummary.totalWays}
                  sub="lines/areas"
                />
                <StatCard
                  label="Relations"
                  value={changesetSummary.totalRelations}
                  sub="groups"
                />
              </div>
            )}

            {/* Changeset table */}
            {displayedChangesets.length > 0 && (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" style={{ minWidth: 500 }}>
                    <thead className="bg-muted border-b border-border">
                      <tr>
                        <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                          Changeset
                        </th>
                        <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                          Date
                        </th>
                        <th className="px-4 py-2 text-right font-semibold text-muted-foreground">
                          Changes
                        </th>
                        <th className="px-4 py-2 text-right font-semibold text-muted-foreground">
                          +Add
                        </th>
                        <th className="px-4 py-2 text-right font-semibold text-muted-foreground">
                          ~Mod
                        </th>
                        <th className="px-4 py-2 text-right font-semibold text-muted-foreground">
                          -Del
                        </th>
                        <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                          Comment
                        </th>
                        <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                          Hashtags
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border bg-card">
                      {displayedChangesets.map((cs) => {
                        const canZoomJosm = cs.centroid !== null;
                        const handleRowClick = () => {
                          if (!followInJosm) return;
                          if (lastFollowedChangesetId === cs.id) return;
                          setLastFollowedChangesetId(cs.id);
                          // Fire and forget — silent on failure, same as
                          // Viewer's pattern.
                          zoomToChangeset(cs).catch(() => {});
                        };
                        return (
                        <tr
                          key={cs.id}
                          onClick={handleRowClick}
                          className={
                            followInJosm && lastFollowedChangesetId === cs.id
                              ? "bg-kaart-orange/5"
                              : undefined
                          }
                        >
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs text-muted-foreground">
                                #{cs.id}
                              </span>
                              {/* OSM.org — opens the changeset page in a new tab */}
                              <a
                                href={`https://www.openstreetmap.org/changeset/${cs.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                title="Open on OpenStreetMap"
                                className="inline-flex items-center justify-center w-6 h-6 rounded border border-border text-muted-foreground hover:text-kaart-orange hover:border-kaart-orange transition-colors"
                                aria-label="Open changeset on OpenStreetMap"
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                                  <circle cx="12" cy="12" r="10" />
                                  <path d="M2 12h20" />
                                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                                </svg>
                              </a>
                              {/* JOSM — probe + zoom + import. Disabled if no centroid. */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!canZoomJosm) return;
                                  openChangesetInJosm(cs).catch(() => {});
                                }}
                                disabled={!canZoomJosm}
                                title={
                                  canZoomJosm
                                    ? "Open in JOSM (requires Remote Control enabled)"
                                    : "No bounding box available — JOSM open disabled"
                                }
                                className="inline-flex items-center justify-center w-6 h-6 rounded border border-border text-muted-foreground hover:text-kaart-orange hover:border-kaart-orange transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-muted-foreground disabled:hover:border-border"
                                aria-label="Open changeset in JOSM"
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                                  <path d="M12 20h9" />
                                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                                </svg>
                              </button>
                              {/* OSMCha — purpose-built changeset review tool */}
                              <a
                                href={`https://osmcha.org/changesets/${cs.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                title="Review on OSMCha"
                                className="inline-flex items-center justify-center w-6 h-6 rounded border border-border text-muted-foreground hover:text-kaart-orange hover:border-kaart-orange transition-colors"
                                aria-label="Review changeset on OSMCha"
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                                  <path d="M21 21l-6-6" />
                                  <circle cx="10" cy="10" r="7" />
                                </svg>
                              </a>
                            </div>
                          </td>
                          <td className="px-4 py-2 whitespace-nowrap">
                            {formatDateTime(cs.createdAt)}
                          </td>
                          <td className="px-4 py-2 text-right font-mono">
                            {cs.changesCount}
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-green-600">
                            {cs.added ?? "-"}
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-yellow-600">
                            {cs.modified ?? "-"}
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-red-500">
                            {cs.deleted ?? "-"}
                          </td>
                          <td className="px-4 py-2 max-w-xs truncate">
                            {cs.comment || "-"}
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex flex-wrap gap-1">
                              {cs.hashtags.map((tag) => (
                                <span
                                  key={tag}
                                  className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-blue-50 text-blue-700"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {changesets.length > ROWS_PER_PAGE && (
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>Showing {(changesetPage - 1) * ROWS_PER_PAGE + 1}-{Math.min(changesetPage * ROWS_PER_PAGE, changesets.length)} of {changesets.length}</span>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" disabled={changesetPage === 1}
                        onClick={() => setChangesetPage(p => p - 1)}>Previous</Button>
                      <span className="flex items-center px-2">Page {changesetPage} of {Math.ceil(changesets.length / ROWS_PER_PAGE)}</span>
                      <Button variant="outline" size="sm" disabled={changesetPage === Math.ceil(changesets.length / ROWS_PER_PAGE)}
                        onClick={() => setChangesetPage(p => p + 1)}>Next</Button>
                    </div>
                  </div>
                )}
              </>
            )}

            {!changesetsLoading &&
              !changesetsError &&
              changesets.length === 0 &&
              dateLabel && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No changesets found for this period.
                </p>
              )}

            {/* Hashtag summary */}
            {sortedHashtags.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-muted-foreground mb-2">
                  Hashtag Summary
                </h4>
                <div className="flex flex-wrap gap-2">
                  {sortedHashtags.map(([tag, count]) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-blue-50 text-blue-700 border border-blue-200"
                    >
                      {tag}
                      <span className="font-bold">({count})</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Geographic Heatmap */}
        <Card>
          <CardHeader>
            <CardTitle>Geographic Activity</CardTitle>
          </CardHeader>
          <CardContent>
            {changesetsLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-kaart-orange" />
                Loading geographic data...
              </div>
            ) : (
              <MappingHeatmap points={heatmapPoints} height="400px" />
            )}
          </CardContent>
        </Card>
      </div>
      </>)}

      {/* F6 — Time tab. Shows ONLY what the meeting acceptance asked for:
          Hours this week, Hours this month, Avg session, Recent entries
          (paginated), Anomalies. Independent of the Overview tab's
          date-preset selector — pulls its own 90-day window. */}
      {user && activeTab === "time" && (
        <div className="space-y-6">
          {timeTabLoading && timeTabEntries.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-kaart-orange" />
              Loading time data…
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <StatCard
                  label="Hours This Week"
                  value={formatDurationHM(timeTabComputed.hoursThisWeek)}
                />
                <StatCard
                  label="Hours This Month"
                  value={formatDurationHM(timeTabComputed.hoursThisMonth)}
                />
                <StatCard
                  label="Average Session"
                  value={
                    timeTabComputed.avgSessionDenom > 0
                      ? formatDurationHM(timeTabComputed.avgSessionSeconds)
                      : "—"
                  }
                />
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Anomalies
                    {timeTabComputed.anomalies.length > 0 && (
                      <span className="ml-2 inline-flex items-center justify-center min-w-[1.5rem] px-1.5 rounded-full text-xs bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                        {timeTabComputed.anomalies.length}
                      </span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {timeTabComputed.anomalies.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">
                      No anomalies detected in the last 90 days.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {timeTabComputed.anomalies.map(({ entry, reason }) => (
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
                  {timeTabComputed.recent.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">
                      No time entries in the last 90 days.
                    </p>
                  ) : (
                    <>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm" style={{ minWidth: 500 }}>
                          <thead className="bg-muted border-b border-border">
                            <tr>
                              <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Date</th>
                              <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Project</th>
                              <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Category</th>
                              <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Duration</th>
                              <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {timeTabPagedRecent.map((entry) => (
                              <tr key={entry.id} className={entry.status === "voided" ? "opacity-50" : ""}>
                                <td className="px-3 py-2 whitespace-nowrap">
                                  {entry.clockIn
                                    ? new Date(entry.clockIn).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                                    : "—"}
                                </td>
                                <td className="px-3 py-2">{entry.projectName || "—"}</td>
                                <td className="px-3 py-2">{entry.category || "—"}</td>
                                <td className="px-3 py-2 font-mono whitespace-nowrap">
                                  {formatDurationHM(entry.durationSeconds)}
                                </td>
                                <td className="px-3 py-2">
                                  {entry.status === "completed" ? (
                                    <span className="text-green-600">Completed</span>
                                  ) : entry.status === "active" ? (
                                    <span className="text-yellow-600">Active</span>
                                  ) : (
                                    <span className="text-red-500">Voided</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {timeTabComputed.recent.length > TIME_TAB_PAGE_SIZE && (
                        <div className="flex items-center justify-between mt-3 text-sm text-muted-foreground">
                          <span>
                            Showing {(timeTabPage - 1) * TIME_TAB_PAGE_SIZE + 1}–
                            {Math.min(timeTabPage * TIME_TAB_PAGE_SIZE, timeTabComputed.recent.length)} of{" "}
                            {timeTabComputed.recent.length}
                          </span>
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={timeTabPage === 1}
                              onClick={() => setTimeTabPage((p) => p - 1)}
                            >
                              Previous
                            </Button>
                            <span className="flex items-center px-2">
                              Page {timeTabPage} of {timeTabTotalPages}
                            </span>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={timeTabPage >= timeTabTotalPages}
                              onClick={() => setTimeTabPage((p) => p + 1)}
                            >
                              Next
                            </Button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}

      {/* Payment tab — read-only admin view of one user's payment data.
          Lazy-loaded; single round-trip via fetch_user_payment_summary. */}
      {user && activeTab === "payment" && (
        <div className="space-y-6">
          {paymentTabLoading && !paymentSummary ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-kaart-orange" />
              Loading payment data…
            </div>
          ) : !paymentSummary ? (
            <p className="text-sm text-muted-foreground italic py-8">
              Payment data unavailable.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <StatCard
                  label="Lifetime Paid"
                  value={formatCurrency(paymentSummary.lifetime_paid)}
                />
                <StatCard
                  label="Pending Balance"
                  value={formatCurrency(paymentSummary.pending_balance)}
                />
                <StatCard
                  label="Open Requests"
                  value={formatCurrency(paymentSummary.open_request_total)}
                />
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Pay Rate &amp; Last Payment</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Hourly Rate</p>
                      <p className="font-medium mt-1">
                        {paymentSummary.hourly_rate != null ? (
                          <>
                            <Val>{formatCurrency(paymentSummary.hourly_rate)}</Val>/hr
                          </>
                        ) : (
                          <span className="text-muted-foreground italic">
                            Per-task (varies by project)
                          </span>
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Last Payment</p>
                      {paymentSummary.last_payment ? (
                        <p className="font-medium mt-1">
                          <Val>{formatCurrency(paymentSummary.last_payment.amount)}</Val>
                          <span className="text-muted-foreground">
                            {" "}· {formatDate(paymentSummary.last_payment.date)}
                          </span>
                          {paymentSummary.last_payment.payment_email && (
                            <span className="text-xs text-muted-foreground block mt-0.5">
                              {paymentSummary.last_payment.payment_email}
                            </span>
                          )}
                        </p>
                      ) : (
                        <p className="text-muted-foreground italic mt-1">No payments yet</p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Anomalies — Unpaid &gt; 30 days
                    {paymentSummary.anomalies.unpaid_over_30d_count > 0 && (
                      <span className="ml-2 inline-flex items-center justify-center min-w-[1.5rem] px-1.5 rounded-full text-xs bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                        {paymentSummary.anomalies.unpaid_over_30d_count}
                      </span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {paymentSummary.anomalies.unpaid_over_30d_count === 0 ? (
                    <p className="text-sm text-muted-foreground italic">
                      No validated tasks older than 30 days are awaiting payment.
                    </p>
                  ) : (
                    <>
                      <p className="text-sm text-muted-foreground mb-3">
                        Total unpaid:{" "}
                        <Val>
                          {formatCurrency(paymentSummary.anomalies.unpaid_over_30d_amount)}
                        </Val>
                        {paymentSummary.anomalies.tasks.length <
                          paymentSummary.anomalies.unpaid_over_30d_count && (
                          <span className="ml-2 text-xs">
                            (showing first {paymentSummary.anomalies.tasks.length} of{" "}
                            {paymentSummary.anomalies.unpaid_over_30d_count})
                          </span>
                        )}
                      </p>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm" style={{ minWidth: 500 }}>
                          <thead className="bg-muted border-b border-border">
                            <tr>
                              <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Task</th>
                              <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Project</th>
                              <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Type</th>
                              <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Validated</th>
                              <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Rate</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {paymentSummary.anomalies.tasks.map((a) => (
                              <tr key={`${a.task_id}-${a.type}`}>
                                <td className="px-3 py-2 font-mono">#{a.task_id}</td>
                                <td className="px-3 py-2">{a.project}</td>
                                <td className="px-3 py-2 capitalize">{a.type}</td>
                                <td className="px-3 py-2 whitespace-nowrap">
                                  {formatDate(a.date_validated)}
                                </td>
                                <td className="px-3 py-2">
                                  <Val>{formatCurrency(a.rate)}</Val>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Open Pay Requests
                    {paymentSummary.open_requests.length > 0 && (
                      <span className="ml-2 text-sm font-normal text-muted-foreground">
                        ({paymentSummary.open_requests.length})
                      </span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {paymentSummary.open_requests.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">
                      No open pay requests.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm" style={{ minWidth: 500 }}>
                        <thead className="bg-muted border-b border-border">
                          <tr>
                            <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Date</th>
                            <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Amount</th>
                            <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Tasks</th>
                            <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Notes</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {paymentSummary.open_requests.map((r) => (
                            <tr key={r.id}>
                              <td className="px-3 py-2 whitespace-nowrap">
                                {formatDate(r.date_requested)}
                              </td>
                              <td className="px-3 py-2">
                                <Val>{formatCurrency(r.amount_requested)}</Val>
                              </td>
                              <td className="px-3 py-2">{r.task_count}</td>
                              <td className="px-3 py-2 text-muted-foreground">
                                {r.notes || "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Recent Payments</CardTitle>
                </CardHeader>
                <CardContent>
                  {paymentSummary.recent_payments.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">
                      No payments yet.
                    </p>
                  ) : (
                    (() => {
                      const totalPages = Math.max(
                        1,
                        Math.ceil(
                          paymentSummary.recent_payments.length /
                            PAYMENT_TAB_PAGE_SIZE,
                        ),
                      );
                      const safePage = Math.min(paymentTabPage, totalPages);
                      const slice = paymentSummary.recent_payments.slice(
                        (safePage - 1) * PAYMENT_TAB_PAGE_SIZE,
                        safePage * PAYMENT_TAB_PAGE_SIZE,
                      );
                      return (
                        <>
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm" style={{ minWidth: 500 }}>
                              <thead className="bg-muted border-b border-border">
                                <tr>
                                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Date</th>
                                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Amount</th>
                                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Projects</th>
                                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Tasks</th>
                                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Notes</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border">
                                {slice.map((p) => (
                                  <tr key={p.id}>
                                    <td className="px-3 py-2 whitespace-nowrap">
                                      {formatDate(p.date)}
                                    </td>
                                    <td className="px-3 py-2">
                                      <Val>{formatCurrency(p.amount)}</Val>
                                    </td>
                                    <td className="px-3 py-2">
                                      {p.projects.length > 0
                                        ? p.projects.join(", ")
                                        : "—"}
                                    </td>
                                    <td className="px-3 py-2">{p.task_count}</td>
                                    <td className="px-3 py-2 text-muted-foreground">
                                      {p.notes || "—"}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {paymentSummary.recent_payments.length >
                            PAYMENT_TAB_PAGE_SIZE && (
                            <div className="flex items-center justify-between mt-3 text-sm text-muted-foreground">
                              <span>
                                Showing {(safePage - 1) * PAYMENT_TAB_PAGE_SIZE + 1}–
                                {Math.min(
                                  safePage * PAYMENT_TAB_PAGE_SIZE,
                                  paymentSummary.recent_payments.length,
                                )}{" "}
                                of {paymentSummary.recent_payments.length}
                              </span>
                              <div className="flex gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={safePage === 1}
                                  onClick={() => setPaymentTabPage((p) => p - 1)}
                                >
                                  Previous
                                </Button>
                                <span className="flex items-center px-2">
                                  Page {safePage} of {totalPages}
                                </span>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={safePage >= totalPages}
                                  onClick={() => setPaymentTabPage((p) => p + 1)}
                                >
                                  Next
                                </Button>
                              </div>
                            </div>
                          )}
                        </>
                      );
                    })()
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}

      {/* Assigned Projects — moved to bottom (was a flex chip grid); now a
          sortable/filterable/paginated table per 2026-04 meeting B3 + UI12 */}
      {user && activeTab === "overview" && (
        <Card>
          <CardHeader>
            <CardTitle>
              Assigned Projects ({user.assigned_projects?.length ?? 0})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <AssignedProjectsTable projects={user.assigned_projects ?? []} />
          </CardContent>
        </Card>
      )}

      {/* Edit Time Entry Modal */}
      <Modal
        isOpen={!!editingEntry}
        onClose={() => setEditingEntry(null)}
        title="Edit Time Entry"
        description={
          editingEntry
            ? `${editingEntry.userName} — ${editingEntry.projectName || "No project"}`
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
              onClick={handleSaveEditEntry}
              isLoading={editingTimeEntry}
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
              <label className="block text-sm font-medium mb-1">Clock In</label>
              <input
                type="datetime-local"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={editClockIn}
                onChange={(e) => setEditClockIn(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Clock Out</label>
              <input
                type="datetime-local"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={editClockOut}
                onChange={(e) => setEditClockOut(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Category</label>
              <select
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={editCategory}
                onChange={(e) => setEditCategory(e.target.value)}
              >
                {TIME_CATEGORY_OPTIONS.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat.charAt(0).toUpperCase() + cat.slice(1)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </Modal>

      {/* Full Edit User Modal */}
      <Modal
        isOpen={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        title="Edit User"
        size="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSaveEditModal} disabled={updateDetailsLoading}>
              {updateDetailsLoading ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="First Name"
              value={editFirstName}
              onChange={(e) => setEditFirstName(e.target.value)}
              placeholder="First name"
            />
            <Input
              label="Last Name"
              value={editLastName}
              onChange={(e) => setEditLastName(e.target.value)}
              placeholder="Last name"
            />
          </div>
          <Input
            label="Email"
            value={editEmail}
            onChange={(e) => setEditEmail(e.target.value)}
            placeholder="user@example.com"
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="OSM Username"
              value={editOsmUsername}
              onChange={(e) => setEditOsmUsername(e.target.value)}
              placeholder="osm_username"
            />
            <Input
              label="Mapillary Username"
              value={editMapillaryUsername2}
              onChange={(e) => setEditMapillaryUsername2(e.target.value)}
              placeholder="mapillary_username"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            {canEditRole ? (
              <Select
                label="Role"
                value={editRole}
                onChange={setEditRole}
                options={[
                  { value: "user", label: roleLabel("user") },
                  { value: "validator", label: roleLabel("validator") },
                  { value: "team_admin", label: roleLabel("team_admin") },
                  { value: "admin", label: roleLabel("admin") },
                  ...(viewerRole === "super_admin"
                    ? [{ value: "super_admin", label: roleLabel("super_admin") }]
                    : []),
                ]}
              />
            ) : (
              <div>
                <label className="block text-sm font-medium mb-1">Role</label>
                <div className="w-full px-3 py-2 border border-input rounded-lg bg-muted text-sm text-muted-foreground">
                  {roleLabel(editRole)}
                  <span className="ml-2 text-xs italic">(read-only)</span>
                </div>
              </div>
            )}
            <Select
              label="Timezone"
              value={editTimezone2}
              onChange={setEditTimezone2}
              options={(() => {
                try {
                  return Intl.supportedValuesOf("timeZone").map((tz) => ({ value: tz, label: tz }));
                } catch {
                  return [];
                }
              })()}
              placeholder="Select timezone"
            />
          </div>
          <Select
            label="Country"
            value={editCountryId2}
            onChange={setEditCountryId2}
            options={countryOptions}
            placeholder="Select country"
          />
          <div className="flex items-center justify-between p-3 border border-border rounded-lg">
            <div>
              <p className="text-sm font-medium">Show Micropayments</p>
              <p className="text-xs text-muted-foreground">User can see micropayment rates, earnings, and request payouts</p>
            </div>
            <div
              onClick={() => setEditPaymentsVisible(!editPaymentsVisible)}
              className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
                editPaymentsVisible ? "bg-green-500" : "bg-muted"
              }`}
            >
              <div
                className={`w-5 h-5 rounded-full bg-white shadow absolute top-0.5 transition-transform ${
                  editPaymentsVisible ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Hourly Rate</label>
            <input
              type="number"
              step="0.01"
              min="0"
              className="w-full px-3 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
              value={editHourlyRate}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditHourlyRate(e.target.value)}
              placeholder="Not set"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
