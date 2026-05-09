"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, Skeleton, Badge, Button, useToastActions, Tooltip, Val } from "@/components/ui";
import {
  useAdminDashboardStats,
  useOrgTransactions,
  useUsersList,
  useOrgProjects,
  usePurgeTaskStats,
  useAdminSyncAllTasks,
  useCheckSyncStatus,
  useAdminTimeHistory,
  useAdminActiveSessions,
  useCurrentUserRole,
  useManagedTeams,
} from "@/hooks";
import { TimeTrackingWidget } from "@/components/widgets/TimeTrackingWidget";
import { AdminTimeManagement } from "@/components/widgets/AdminTimeManagement";
import { DashboardStatCard } from "@/components/admin/DashboardStatCard";
import { TeamScopeSelector } from "@/components/admin/TeamScopeSelector";
import { RegionFilter } from "@/components/admin/RegionFilter";
import { TeamAdminEmptyState } from "@/components/admin/TeamAdminEmptyState";
import { isOrgAdminOrAbove } from "@/types";
import { formatNumber, formatCurrency } from "@/lib/utils";
import Link from "next/link";

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// --- Lower dashboard section (deferred) ---
// This component manages its own data fetching so it doesn't block the time section above.

interface DashboardStatsProps {
  /** Selected team scope (controlled from the page); null = all teams. */
  teamId: number | null;
  /** Setter for the team scope; rendered inside the toolbar near Sync All Tasks. */
  onTeamIdChange: (teamId: number | null) => void;
  /** Selected region (country id), null = all regions. */
  regionCountryId: number | null;
  /** Setter for the region scope. */
  onRegionCountryIdChange: (id: number | null) => void;
  /**
   * Viewer role — decides:
   *  - whether team_admin gets the managed-only TeamScopeSelector
   *  - whether dev tools (purge) are rendered.
   */
  viewerRole: string;
}

function DashboardStats({ teamId, onTeamIdChange, regionCountryId, onRegionCountryIdChange, viewerRole }: DashboardStatsProps) {
  const isTeamAdmin = viewerRole === "team_admin";
  const canPurge = isOrgAdminOrAbove(viewerRole);
  const { data: stats, loading: statsLoading, error: statsError, refetch: refetchStats } = useAdminDashboardStats();
  const { data: transactions, loading: transactionsLoading } = useOrgTransactions();
  const { data: users, loading: usersLoading } = useUsersList();
  const { data: timeHistory, loading: timeHistoryLoading, refetch: refetchTimeHistory } = useAdminTimeHistory();
  const { data: activeSessions, refetch: refetchActiveSessions } = useAdminActiveSessions();

  // When the team scope changes, refetch the time-related panels with
  // the new scope. Other dashboard panels stay org-wide for now —
  // they need backend work to support team scoping (tracked under F23).
  useEffect(() => {
    refetchTimeHistory(teamId ? { teamId } : undefined).catch(() => {});
    refetchActiveSessions(teamId ? { teamId } : undefined).catch(() => {});
  }, [teamId, refetchTimeHistory, refetchActiveSessions]);

  // Region filter — refetch stats when admin picks a country. Project
  // and task counts narrow to that region. Payment totals stay
  // org-wide (user-scoped, not project-scoped).
  useEffect(() => {
    refetchStats(regionCountryId != null ? { country_id: regionCountryId } : undefined).catch(() => {});
  }, [regionCountryId, refetchStats]);
  const { mutate: purgeTaskStats, loading: purging } = usePurgeTaskStats();
  const { mutate: syncAllTasks } = useAdminSyncAllTasks();
  const { mutate: checkSyncStatus } = useCheckSyncStatus();
  const toast = useToastActions();

  // Snapshot timestamp — records when this data was loaded
  const [snapshotTime] = useState(() => new Date());

  // Time management quick stats
  const timeStats = useMemo(() => {
    const entries = timeHistory?.entries || [];
    const sessions = activeSessions?.sessions || [];
    const now = new Date();

    // This week (Sunday start)
    const dayOfWeek = now.getDay();
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek);
    const lastWeekStart = new Date(weekStart);
    lastWeekStart.setDate(weekStart.getDate() - 7);

    // Split entries into this-week vs last-week buckets for the delta.
    let weekSec = 0;
    let lastWeekSec = 0;
    let pendingAdjustments = 0;
    let lastWeekPendingAdjustments = 0;

    for (const e of entries) {
      if (!e.clockIn) continue;
      const t = new Date(e.clockIn).getTime();
      const inThisWeek = t >= weekStart.getTime();
      const inLastWeek = t >= lastWeekStart.getTime() && t < weekStart.getTime();
      if (e.status === "completed") {
        if (inThisWeek) weekSec += e.durationSeconds ?? 0;
        else if (inLastWeek) lastWeekSec += e.durationSeconds ?? 0;
      }
      if (
        e.status === "completed" &&
        e.notes?.startsWith("[ADJUSTMENT REQUESTED]")
      ) {
        if (inThisWeek) pendingAdjustments += 1;
        else if (inLastWeek) lastWeekPendingAdjustments += 1;
      }
    }

    const weekHours = Math.round((weekSec / 3600) * 10) / 10;
    const lastWeekHours = Math.round((lastWeekSec / 3600) * 10) / 10;

    // Suspicious long sessions: active sessions running 10+ hours
    const longRunning = sessions.filter((s) => {
      if (!s.clockIn) return false;
      const elapsed = (now.getTime() - new Date(s.clockIn).getTime()) / 1000;
      return elapsed > 10 * 3600; // 10+ hours
    }).length;

    // Active session count
    const activeCount = sessions.length;

    // Short-session clusters (UI6). A "cluster" = one user logging 3 or
    // more completed sessions under 5 minutes on the same calendar day.
    // Catches the "forgot to clock out / kept bouncing" pattern Aaron
    // flagged (Andre's 3×1-minute sessions).
    const SHORT_CUTOFF_SEC = 5 * 60;
    const CLUSTER_MIN_COUNT = 3;
    const shortByUserDay: Record<string, number> = {};
    for (const e of entries) {
      if (!e.clockIn || e.status !== "completed") continue;
      if ((e.durationSeconds ?? 0) >= SHORT_CUTOFF_SEC) continue;
      const day = (e.clockIn || "").slice(0, 10);
      const key = `${e.userId || "?"}::${day}`;
      shortByUserDay[key] = (shortByUserDay[key] ?? 0) + 1;
    }
    const shortSessionClusters = Object.values(shortByUserDay).filter(
      (n) => n >= CLUSTER_MIN_COUNT,
    ).length;

    return {
      weekHours,
      lastWeekHours,
      pendingAdjustments,
      lastWeekPendingAdjustments,
      longRunning,
      activeCount,
      shortSessionClusters,
    };
  }, [timeHistory, activeSessions]);
  const [purgeConfirm, setPurgeConfirm] = useState(false);
  const [syncProgress, setSyncProgress] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    setSyncing(true);

    pollRef.current = setInterval(async () => {
      try {
        const result = await checkSyncStatus({});
        if (result.sync_status === "running" || result.sync_status === "queued") {
          setSyncProgress(result.progress || "Syncing...");
        } else if (result.sync_status === "completed") {
          stopPolling();
          setSyncing(false);
          setSyncProgress(null);
          toast.success("Task sync complete");
          refetchStats();
        } else if (result.sync_status === "failed") {
          stopPolling();
          setSyncing(false);
          setSyncProgress(null);
          toast.error(result.error || "Sync failed");
        }
      } catch {
        stopPolling();
        setSyncing(false);
        setSyncProgress(null);
      }
    }, 5000);
  }, [checkSyncStatus, stopPolling, toast, refetchStats]);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  // Refresh stats when a clock-in/out happens elsewhere (sidebar, widget,
  // other admins) so the dashboard numbers don't go stale on this page.
  useEffect(() => {
    const handler = () => setTimeout(() => refetchStats(), 500);
    window.addEventListener("clock-state-changed", handler);
    return () => window.removeEventListener("clock-state-changed", handler);
  }, [refetchStats]);

  const handleSyncAllTasks = async () => {
    try {
      const result = await syncAllTasks({});
      setSyncing(true);
      setSyncProgress(result.message || "Queued...");
      startPolling();
    } catch {
      toast.error("Failed to start sync");
    }
  };

  const handlePurgeTaskStats = async () => {
    if (!purgeConfirm) {
      setPurgeConfirm(true);
      return;
    }
    try {
      await purgeTaskStats({});
      setPurgeConfirm(false);
      refetchStats();
      toast.success("All task stats purged successfully");
    } catch (err) {
      toast.error("Failed to purge task stats: " + (err instanceof Error ? err.message : "Unknown error"));
    }
  };

  return (
    <>
      {/* Toolbar: Region filter + Team scope selector + Sync button.
          Region + Team share the same Select primitive (consistent
          look). Sync button aligns to the bottom of the filter row
          via items-end so its h-9 button visually sits with the
          h-10 Select buttons (the labels above add ~24px). */}
      <div className="flex items-end justify-end gap-3">
        <div className="w-48">
          <RegionFilter value={regionCountryId} onChange={onRegionCountryIdChange} />
        </div>
        <div className="w-48">
          <TeamScopeSelector
            value={teamId}
            onChange={onTeamIdChange}
            managedOnly={isTeamAdmin}
          />
        </div>
        {syncing && syncProgress && (
          <span className="text-sm text-muted-foreground">{syncProgress}</span>
        )}
        <Tooltip content="Pull latest task data from Tasking Manager and MapRoulette" position="bottom">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSyncAllTasks}
            disabled={syncing}
          >
            {syncing ? "Syncing..." : "Sync All Tasks"}
          </Button>
        </Tooltip>
      </div>

      {/* Subtle scope indicator — makes it clear that only the time-related
          panels below are filtered. Other panels (project counts, payment
          totals) stay org-wide until F23/follow-up backend work. */}
      {teamId !== null && (
        <div className="text-xs text-muted-foreground italic -mt-2">
          Time stats below are scoped to the selected team. Project counts
          and payment totals remain org-wide.
        </div>
      )}

      {statsError && (
        <div className="rounded-lg bg-destructive/10 p-4 text-destructive">
          Error loading dashboard: {statsError}
        </div>
      )}

      {/* KPI STRIP — 4 compact cards, the headline numbers. Deltas land
          on rate-type stats (tasks/mo, hours/wk); point-in-time counts
          (projects, users) show a static subtitle instead. */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <DashboardStatCard
          label="Active Projects"
          value={formatNumber(stats?.active_projects)}
          subtitle={`${formatNumber(stats?.inactive_projects).text} inactive, ${formatNumber(stats?.completed_projects).text} completed`}
          href="/admin/projects"
          linkLabel="Manage projects"
          tooltip="Projects currently active across Tasking Manager and MapRoulette"
          loading={statsLoading}
        />
        <DashboardStatCard
          label="Total Users"
          value={formatNumber(users?.users?.length ?? 0)}
          subtitle="In organization"
          href="/admin/users"
          linkLabel="Manage users"
          tooltip="Total registered users in your organization"
          loading={usersLoading}
        />
        <DashboardStatCard
          label="Tasks This Month"
          value={formatNumber(stats?.total_contributions_for_month)}
          delta={
            stats?.month_contribution_change !== undefined
              ? {
                  value: stats.month_contribution_change,
                  period: "vs last month",
                  format: "number",
                  goodDirection: "up",
                }
              : null
          }
          href="/admin/reports"
          linkLabel="View task reports"
          tooltip="Total mapping and validation tasks completed this calendar month"
          loading={statsLoading}
        />
        <DashboardStatCard
          label="Hours This Week"
          value={`${timeStats.weekHours}h`}
          delta={{
            value: Math.round((timeStats.weekHours - timeStats.lastWeekHours) * 10) / 10,
            period: "vs last week",
            format: "hours",
            goodDirection: "up",
          }}
          href="/admin/time"
          linkLabel="View time tracking"
          tooltip="Total hours logged by all users this week (Sunday to now)"
          loading={timeHistoryLoading}
        />
      </div>

      {/* HEALTH STRIP — alerts + anomalies. Severity coloring drives the
          at-a-glance read; 0s stay neutral. Self-Validation folded in as
          the 4th card rather than living as a standalone conditional. */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <DashboardStatCard
          label="Pending Adjustments"
          value={formatNumber(timeStats.pendingAdjustments)}
          delta={{
            value: timeStats.pendingAdjustments - timeStats.lastWeekPendingAdjustments,
            period: "vs last week",
            format: "number",
            goodDirection: "down",
          }}
          href="/admin/time#pending-adjustments"
          linkLabel="Review adjustment requests"
          tooltip="Time entries where a user has requested an adjustment that hasn't been resolved yet"
          severity={timeStats.pendingAdjustments > 0 ? "warning" : "neutral"}
          loading={timeHistoryLoading}
        />
        <DashboardStatCard
          label="Long-Running Sessions"
          value={formatNumber(timeStats.longRunning)}
          subtitle={
            timeStats.longRunning > 0
              ? "Sessions over 10 hours"
              : "No suspicious sessions"
          }
          href="/admin/time"
          linkLabel="Review active sessions"
          tooltip="Active clock-ins running longer than 10 hours — may indicate a user forgot to clock out"
          severity={timeStats.longRunning > 0 ? "critical" : "neutral"}
          loading={timeHistoryLoading}
        />
        <DashboardStatCard
          label="Short Sessions"
          value={formatNumber(timeStats.shortSessionClusters)}
          subtitle={
            timeStats.shortSessionClusters > 0
              ? `${timeStats.shortSessionClusters === 1 ? "user-day" : "user-days"} with 3+ sessions under 5 min`
              : "No short-session clusters"
          }
          href="/admin/time"
          linkLabel="Review time entries"
          tooltip="Users who logged three or more sessions under 5 minutes on the same day — often indicates a clock-in/out issue"
          severity={timeStats.shortSessionClusters > 0 ? "warning" : "neutral"}
          loading={timeHistoryLoading}
        />
        <DashboardStatCard
          label="Self-Validation Alerts"
          value={formatNumber(stats?.self_validated_count ?? 0)}
          subtitle={
            (stats?.self_validated_count ?? 0) > 0
              ? "Flagged as not payable"
              : "No self-validated tasks"
          }
          href="/admin/reports"
          linkLabel="View self-validation details in reports"
          tooltip="Tasks where the same user both mapped and validated — flagged as not payable to prevent abuse"
          severity={(stats?.self_validated_count ?? 0) > 0 ? "warning" : "neutral"}
          loading={statsLoading}
        />
      </div>

      {/* Snapshot notice */}
      <p className="text-xs text-muted-foreground text-right">
        Stats as of {snapshotTime.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })}
      </p>

      {/* TASKS STRIP — all-time totals. Brand colors preserved (orange/
          green/red) per Aaron's preference: 'the boss likes colors'. */}
      <div className="grid gap-3 md:grid-cols-3">
        <DashboardStatCard
          label="Mapped Tasks (All Time)"
          value={formatNumber(stats?.mapped_tasks)}
          href="/admin/reports"
          linkLabel="View mapped tasks in reports"
          tooltip="Total tasks marked as mapped across all projects since tracking began"
          severity="info"
          loading={statsLoading}
        />
        <DashboardStatCard
          label="Validated Tasks (All Time)"
          value={formatNumber(stats?.validated_tasks)}
          href="/admin/reports"
          linkLabel="View validated tasks in reports"
          tooltip="Tasks reviewed and approved by a validator since tracking began"
          severity="success"
          loading={statsLoading}
        />
        <DashboardStatCard
          label="Invalidated Tasks (All Time)"
          value={formatNumber(stats?.invalidated_tasks)}
          href="/admin/reports"
          linkLabel="View invalidated tasks in reports"
          tooltip="Tasks sent back for rework after validation review since tracking began"
          severity="critical"
          loading={statsLoading}
        />
      </div>

      {/* PAYMENTS STRIP. */}
      <div className="grid gap-3 md:grid-cols-3">
        <DashboardStatCard
          label="Total Payable"
          value={formatCurrency(stats?.payable_total)}
          href="/admin/payments"
          linkLabel="View payments"
          tooltip="Total amount owed to all users based on completed tasks and payment rates"
          loading={statsLoading}
        />
        <DashboardStatCard
          label="Pending Requests"
          value={formatCurrency(stats?.requests_total)}
          subtitle={`${formatNumber(transactions?.requests?.length ?? 0).text} pending request${(transactions?.requests?.length ?? 0) === 1 ? "" : "s"}`}
          href="/admin/payments"
          linkLabel="Review payment requests"
          tooltip="Payment requests submitted by users awaiting admin approval"
          severity={(stats?.requests_total ?? 0) > 0 ? "warning" : "neutral"}
          loading={statsLoading}
        />
        <DashboardStatCard
          label="Total Paid Out"
          value={formatCurrency(stats?.payouts_total)}
          href="/admin/payments"
          linkLabel="View payments"
          tooltip="Total amount already paid out to users"
          severity="success"
          loading={statsLoading}
        />
      </div>

      {/* Recent Activity */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <Tooltip content="Most recent payment requests from users — click View All to manage" position="bottom">
              <CardTitle>Recent Payment Requests</CardTitle>
            </Tooltip>
            <Link
              href="/admin/payments"
              className="text-sm text-kaart-orange hover:underline"
            >
              View all
            </Link>
          </CardHeader>
          <CardContent>
            {transactionsLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : transactions?.requests && transactions.requests.length > 0 ? (
              <div className="space-y-4">
                {transactions.requests.slice(0, 5).map((request) => (
                  <div
                    key={request.id}
                    className="flex items-center justify-between border-b border-border pb-3 last:border-0 last:pb-0"
                  >
                    <div>
                      <p className="font-medium">{request.user}</p>
                      <p className="text-sm text-muted-foreground">
                        {request.osm_username} • {formatDate(request.date_requested)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold">
                        <Val>{formatCurrency(request.amount_requested)}</Val>
                      </p>
                      <Badge variant="warning">Pending</Badge>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No pending payment requests.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <Tooltip content="Most recent completed payments to users" position="bottom">
              <CardTitle>Recent Payouts</CardTitle>
            </Tooltip>
            <Link
              href="/admin/payments"
              className="text-sm text-kaart-orange hover:underline"
            >
              View all
            </Link>
          </CardHeader>
          <CardContent>
            {transactionsLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : transactions?.payments && transactions.payments.length > 0 ? (
              <div className="space-y-4">
                {transactions.payments.slice(0, 5).map((payment) => (
                  <div
                    key={payment.id}
                    className="flex items-center justify-between border-b border-border pb-3 last:border-0 last:pb-0"
                  >
                    <div>
                      <p className="font-medium">{payment.user}</p>
                      <p className="text-sm text-muted-foreground">
                        {payment.osm_username} • {formatDate(payment.date_paid)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-green-600">
                        <Val>{formatCurrency(payment.amount_paid)}</Val>
                      </p>
                      <Badge variant="success">Paid</Badge>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No recent payouts to display.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* DEV ONLY: Danger Zone — Org Admin / Super Admin only.
          Hidden for team_admin since the purge endpoint is gated
          server-side and the button would 403. */}
      {canPurge && (
      <Card className="border-2 border-dashed border-yellow-400 bg-yellow-50/50 mt-8 relative">
        <div className="absolute top-2 right-2 z-10">
          <span className="bg-yellow-400 text-yellow-900 text-xs font-bold px-2 py-1 rounded uppercase tracking-wider">Dev Only</span>
        </div>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-red-800">
            Dev Tools
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <button
              onClick={handlePurgeTaskStats}
              disabled={purging}
              className={`inline-flex items-center rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                purgeConfirm
                  ? "bg-red-600 text-white hover:bg-red-700"
                  : "bg-red-100 text-red-700 hover:bg-red-200"
              } disabled:opacity-50`}
            >
              {purging
                ? "Purging..."
                : purgeConfirm
                ? "Click Again to Confirm Purge"
                : "Purge All Task Stats"}
            </button>
            {purgeConfirm && (
              <button
                onClick={() => setPurgeConfirm(false)}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Cancel
              </button>
            )}
          </div>
          <p className="text-xs text-red-600 mt-2">
            Deletes all tasks, user_tasks, validator_task_actions and resets all user/project task counts to 0.
          </p>
          {/* Sync Org IDs button — disabled, migration complete
          <hr className="my-3 border-border" />
          <div className="flex items-center gap-4">
            <button
              onClick={async () => {
                try {
                  const res = await fetch("/backend/user/sync_org_ids", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                  });
                  const data = await res.json();
                  if (data.status === 200) {
                    toast.success(data.message);
                  } else {
                    toast.error(data.message || "Failed to sync org IDs");
                  }
                } catch {
                  toast.error("Failed to sync org IDs");
                }
              }}
              className="inline-flex items-center rounded-lg px-4 py-2 text-sm font-medium transition-colors bg-blue-100 text-blue-700 hover:bg-blue-200"
            >
              Sync Org IDs from Auth0
            </button>
          </div>
          <p className="text-xs text-blue-600 mt-2">
            Sets org_id on all users, projects, tasks, and time entries. Also patches Auth0 app_metadata with roles and org_id for users missing it.
          </p>
          */}
        </CardContent>
      </Card>
      )}
    </>
  );
}

// --- Main page component ---
// Only the time section loads here; everything else is deferred to DashboardStats.

const TEAM_SCOPE_STORAGE_KEY = "mikro.dashboard.teamScope";

export default function AdminDashboard() {
  const { data: projects } = useOrgProjects();
  const [showStats, setShowStats] = useState(false);

  // Role-aware behavior (F3 Phase 3.4):
  // - team_admin: dashboard scope is auto-restricted via TeamScopeSelector
  //   `managedOnly` mode and we show an info chip identifying the tier.
  const { role: viewerRole } = useCurrentUserRole();
  const { teams: managedTeams, loading: managedTeamsLoading } = useManagedTeams();
  const isTeamAdmin = viewerRole === "team_admin";

  // Team scope persists across reloads via localStorage. Hydration
  // happens AFTER first render so SSR doesn't try to read window.
  const [teamId, setTeamId] = useState<number | null>(null);
  const [regionCountryId, setRegionCountryId] = useState<number | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(TEAM_SCOPE_STORAGE_KEY);
      if (raw && raw !== "all") {
        const parsed = parseInt(raw, 10);
        if (!Number.isNaN(parsed)) setTeamId(parsed);
      }
    } catch {
      // localStorage unavailable (private mode etc.) — silently ignore.
    }
  }, []);

  // For team_admin: default-select the first managed team if no
  // selection has been hydrated. Server returns aggregate-of-managed
  // when teamId is null, but the UI is clearer with an explicit pick.
  useEffect(() => {
    if (
      isTeamAdmin &&
      teamId == null &&
      !managedTeamsLoading &&
      managedTeams.length === 1
    ) {
      setTeamId(managedTeams[0].id);
    }
  }, [isTeamAdmin, teamId, managedTeams, managedTeamsLoading]);
  const handleTeamIdChange = useCallback((next: number | null) => {
    setTeamId(next);
    try {
      localStorage.setItem(
        TEAM_SCOPE_STORAGE_KEY,
        next == null ? "all" : String(next),
      );
    } catch {
      // Ignore — selection still applies for this session.
    }
  }, []);

  // Defer lower sections until after the time section has painted
  useEffect(() => {
    const id = requestAnimationFrame(() => setShowStats(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // team_admin with no managed teams → empty state, skip the rest.
  if (
    isTeamAdmin &&
    !managedTeamsLoading &&
    managedTeams.length === 0
  ) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Admin Dashboard</h1>
        <TeamAdminEmptyState />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Admin Dashboard</h1>
          <p className="text-muted-foreground">
            Organization overview and management
          </p>
        </div>
        {isTeamAdmin && (
          <Badge variant="warning" className="mt-1">
            Team Admin — viewing your managed teams
          </Badge>
        )}
      </div>

      {/* Time Tracking — loads first */}
      <div className="grid gap-4 lg:grid-cols-4">
        <div className="lg:col-span-1">
          <TimeTrackingWidget
            projects={projects?.org_active_projects?.map((p: { id: number; name: string; short_name?: string; last_worked_on?: string | null }) => ({ id: p.id, name: p.name, short_name: p.short_name, last_worked_on: p.last_worked_on ?? null })) ?? []}
          />
        </div>
        <div className="lg:col-span-3">
          <AdminTimeManagement teamId={teamId} />
        </div>
      </div>

      {/* Lower sections — deferred */}
      {showStats ? (
        <DashboardStats
          teamId={teamId}
          onTeamIdChange={handleTeamIdChange}
          regionCountryId={regionCountryId}
          onRegionCountryIdChange={setRegionCountryId}
          viewerRole={viewerRole}
        />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <Card key={i}>
                <CardHeader className="pb-2">
                  <Skeleton className="h-4 w-24" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-8 w-16" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
