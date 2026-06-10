"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  useToastActions,
} from "@/components/ui";
import {
  useAdminDashboardStats,
  useOrgTransactions,
  useUsersList,
  useOrgProjects,
  usePurgeTaskStats,
  useAdminSyncAllTasks,
  useCheckSyncStatus,
  useAdminActiveSessions,
  useAdminLongSessions,
  useAdminTimeStats,
  useCurrentUserRole,
  useManagedTeams,
} from "@/hooks";
import { TimeTrackingWidget } from "@/components/widgets/TimeTrackingWidget";
import { DashboardStatCard } from "@/components/admin/DashboardStatCard";
import { TeamAdminEmptyState } from "@/components/admin/TeamAdminEmptyState";
import { RecentTransactionCard } from "@/components/admin/RecentTransactionCard";
import { DashboardLoadingSkeleton } from "@/components/admin/DashboardLoadingSkeleton";
import { DashboardFilterToolbar } from "@/components/admin/DashboardFilterToolbar";
import { isOrgAdminOrAbove } from "@/types";
import { formatNumber, formatCurrency, formatDate, formatDateTime } from "@/lib/utils";
import { ROUTES } from "@/lib/routes";

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

function DashboardStats({
  teamId,
  onTeamIdChange,
  regionCountryId,
  onRegionCountryIdChange,
  viewerRole,
}: DashboardStatsProps) {
  const isTeamAdmin = viewerRole === "team_admin";
  const canPurge = isOrgAdminOrAbove(viewerRole);
  const {
    data: stats,
    loading: statsLoading,
    error: statsError,
    refetch: refetchStats,
  } = useAdminDashboardStats();
  const { data: transactions, loading: transactionsLoading } =
    useOrgTransactions();
  const { data: users, loading: usersLoading } = useUsersList();
  const {
    data: serverTimeStats,
    loading: timeHistoryLoading,
    refetch: refetchTimeStats,
  } = useAdminTimeStats();
  const { data: activeSessions, refetch: refetchActiveSessions } =
    useAdminActiveSessions();
  const { data: longSessions, refetch: refetchLongSessions } =
    useAdminLongSessions();

  // When the team scope changes, refetch the time-related panels.
  useEffect(() => {
    refetchTimeStats(teamId ? { teamId } : undefined).catch(() => {});
    refetchActiveSessions(teamId ? { teamId } : undefined).catch(() => {});
    refetchLongSessions(teamId ? { teamId } : undefined).catch(() => {});
  }, [teamId, refetchTimeStats, refetchActiveSessions, refetchLongSessions]);

  // Region filter — refetch stats when admin picks a country.
  useEffect(() => {
    refetchStats(
      regionCountryId != null ? { country_id: regionCountryId } : undefined,
    ).catch(() => {});
  }, [regionCountryId, refetchStats]);
  const { mutate: purgeTaskStats, loading: purging } = usePurgeTaskStats();
  const { mutate: syncAllTasks } = useAdminSyncAllTasks();
  const { mutate: checkSyncStatus } = useCheckSyncStatus();
  const toast = useToastActions();

  // Snapshot timestamp — records when this data was loaded
  const [snapshotTime] = useState(() => new Date());

  // Merge server-aggregated time stats with client-derived active-session counts.
  const timeStats = useMemo(() => {
    const sessions = activeSessions?.sessions || [];
    // Long-running count comes from the dedicated endpoint (10h threshold
    // lives backend-side, SSOT) — covers both still-open sessions and
    // recently-closed ones that recorded >10h.
    const longRunning = longSessions?.sessions?.length ?? 0;
    return {
      weekHours: serverTimeStats?.weekHours ?? 0,
      lastWeekHours: serverTimeStats?.lastWeekHours ?? 0,
      pendingAdjustments: serverTimeStats?.pendingAdjustments ?? 0,
      lastWeekPendingAdjustments:
        serverTimeStats?.lastWeekPendingAdjustments ?? 0,
      shortSessionClusters: serverTimeStats?.shortSessionClusters ?? 0,
      longRunning,
      activeCount: sessions.length,
    };
  }, [serverTimeStats, activeSessions, longSessions]);
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
        if (
          result.sync_status === "running" ||
          result.sync_status === "queued"
        ) {
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
      toast.error(
        "Failed to purge task stats: " +
          (err instanceof Error ? err.message : "Unknown error"),
      );
    }
  };

  return (
    <>
      <DashboardFilterToolbar
        teamId={teamId}
        onTeamIdChange={onTeamIdChange}
        regionCountryId={regionCountryId}
        onRegionCountryIdChange={onRegionCountryIdChange}
        isTeamAdmin={isTeamAdmin}
        syncing={syncing}
        syncProgress={syncProgress}
        onSyncAllTasks={handleSyncAllTasks}
      />

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
          href={ROUTES.projects}
          linkLabel="Manage projects"
          tooltip="Projects currently active across Tasking Manager and MapRoulette"
          loading={statsLoading}
        />
        <DashboardStatCard
          label="Total Users"
          value={formatNumber(users?.users?.length ?? 0)}
          subtitle="In organization"
          href={ROUTES.users}
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
          href={ROUTES.reports}
          linkLabel="View task reports"
          tooltip="Total mapping and validation tasks completed this calendar month"
          loading={statsLoading}
        />
        <DashboardStatCard
          label="Hours This Week"
          value={`${timeStats.weekHours}h`}
          delta={{
            value:
              Math.round((timeStats.weekHours - timeStats.lastWeekHours) * 10) /
              10,
            period: "vs last week",
            format: "hours",
            goodDirection: "up",
          }}
          href={ROUTES.adminTime}
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
            value:
              timeStats.pendingAdjustments -
              timeStats.lastWeekPendingAdjustments,
            period: "vs last week",
            format: "number",
            goodDirection: "down",
          }}
          href={ROUTES.adminTime}
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
              ? "Sessions over 10 hours (open now or recently closed)"
              : "No suspicious sessions"
          }
          href={ROUTES.adminTime}
          linkLabel="Review active sessions"
          tooltip="Sessions over 10 hours — open now or recently closed; may indicate a forgotten clock-out."
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
          href={ROUTES.adminTime}
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
          href={ROUTES.reports}
          linkLabel="View self-validation details in reports"
          tooltip="Tasks where the same user both mapped and validated — flagged as not payable to prevent abuse"
          severity={
            (stats?.self_validated_count ?? 0) > 0 ? "warning" : "neutral"
          }
          loading={statsLoading}
        />
      </div>

      {/* Snapshot notice */}
      <p className="text-xs text-muted-foreground text-right">
        Stats as of{" "}
        {formatDateTime(snapshotTime.toISOString())}
      </p>

      {/* TASKS STRIP — all-time totals. Brand colors preserved (orange/
          green/red) per Aaron's preference: 'the boss likes colors'. */}
      <div className="grid gap-3 md:grid-cols-3">
        <DashboardStatCard
          label="Mapped Tasks (All Time)"
          value={formatNumber(stats?.mapped_tasks)}
          href={ROUTES.reports}
          linkLabel="View mapped tasks in reports"
          tooltip="Total tasks marked as mapped across all projects since tracking began"
          severity="info"
          loading={statsLoading}
        />
        <DashboardStatCard
          label="Validated Tasks (All Time)"
          value={formatNumber(stats?.validated_tasks)}
          href={ROUTES.reports}
          linkLabel="View validated tasks in reports"
          tooltip="Tasks reviewed and approved by a validator since tracking began"
          severity="success"
          loading={statsLoading}
        />
        <DashboardStatCard
          label="Invalidated Tasks (All Time)"
          value={formatNumber(stats?.invalidated_tasks)}
          href={ROUTES.reports}
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
          href={ROUTES.payments}
          linkLabel="View payments"
          tooltip="Total amount owed to all users based on completed tasks and payment rates"
          loading={statsLoading}
        />
        <DashboardStatCard
          label="Pending Requests"
          value={formatCurrency(stats?.requests_total)}
          subtitle={`${formatNumber(transactions?.requests?.length ?? 0).text} pending request${(transactions?.requests?.length ?? 0) === 1 ? "" : "s"}`}
          href={ROUTES.payments}
          linkLabel="Review payment requests"
          tooltip="Payment requests submitted by users awaiting admin approval"
          severity={(stats?.requests_total ?? 0) > 0 ? "warning" : "neutral"}
          loading={statsLoading}
        />
        <DashboardStatCard
          label="Total Paid Out"
          value={formatCurrency(stats?.payouts_total)}
          href={ROUTES.payments}
          linkLabel="View payments"
          tooltip="Total amount already paid out to users"
          severity="success"
          loading={statsLoading}
        />
      </div>

      {/* Recent Activity */}
      <div className="grid gap-4 md:grid-cols-2">
        <RecentTransactionCard
          title="Recent Payment Requests"
          tooltipContent="Most recent payment requests from users — click View All to manage"
          href={ROUTES.payments}
          loading={transactionsLoading}
          items={(transactions?.requests ?? []).map((r) => ({
            id: r.id,
            name: r.user,
            subtext: `${r.osm_username} • ${formatDate(r.date_requested)}`,
            amount: formatCurrency(r.amount_requested),
            badgeVariant: "warning" as const,
            badgeLabel: "Pending",
          }))}
          emptyMessage="No pending payment requests."
        />
        <RecentTransactionCard
          title="Recent Payouts"
          tooltipContent="Most recent completed payments to users"
          href={ROUTES.payments}
          loading={transactionsLoading}
          items={(transactions?.payments ?? []).map((p) => ({
            id: p.id,
            name: p.user,
            subtext: `${p.osm_username} • ${formatDate(p.date_paid)}`,
            amount: formatCurrency(p.amount_paid),
            amountColorClass: "text-green-600",
            badgeVariant: "success" as const,
            badgeLabel: "Paid",
          }))}
          emptyMessage="No recent payouts to display."
        />
      </div>

      {/* DEV ONLY: Danger Zone — Org Admin / Super Admin only.
          Hidden for team_admin since the purge endpoint is gated
          server-side and the button would 403. */}
      {/* Dev/purge tools hidden per management request 2026-05-19 —
          restore by removing the `false &&` guard below. */}
      {false && canPurge && (
        <Card className="border-2 border-dashed border-yellow-400 bg-yellow-50/50 mt-8 relative">
          <div className="absolute top-2 right-2 z-10">
            <span className="bg-yellow-400 text-yellow-900 text-xs font-bold px-2 py-1 rounded uppercase tracking-wider">
              Dev Only
            </span>
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
              Deletes all tasks, user_tasks, validator_task_actions and resets
              all user/project task counts to 0.
            </p>
          </CardContent>
        </Card>
      )}
    </>
  );
}

// --- Main page component ---
// The time section renders eagerly; the heavier stats are deferred to
// DashboardStats. Visual order: stats first, time section at the bottom.

const TEAM_SCOPE_STORAGE_KEY = "mikro.dashboard.teamScope";

export function AdminDashboard() {
  const { data: projects } = useOrgProjects();
  const [showStats, setShowStats] = useState(false);

  // Role-aware behavior (F3 Phase 3.4):
  // - team_admin: dashboard scope is auto-restricted via TeamScopeSelector
  //   `managedOnly` mode and we show an info chip identifying the tier.
  const { role: viewerRole } = useCurrentUserRole();
  const { teams: managedTeams, loading: managedTeamsLoading } =
    useManagedTeams();
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
  if (isTeamAdmin && !managedTeamsLoading && managedTeams.length === 0) {
    return (
      <div className="space-y-6">
        <TeamAdminEmptyState />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stat cards — first thing visible after the title. Deferred
          one animation frame so the page paints before the heavier
          stats render. */}
      {showStats ? (
        <DashboardStats
          teamId={teamId}
          onTeamIdChange={handleTeamIdChange}
          regionCountryId={regionCountryId}
          onRegionCountryIdChange={setRegionCountryId}
          viewerRole={viewerRole}
        />
      ) : (
        <DashboardLoadingSkeleton />
      )}

      {/* Time Tracking — bottom-most row of the page. Moved below the
          stat cards so the stats are the first thing the admin sees. */}
      <div className="grid gap-4 lg:grid-cols-4">
        <div className="lg:col-span-1">
          <TimeTrackingWidget
            projects={
              projects?.org_active_projects?.map(
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
      </div>
    </div>
  );
}
