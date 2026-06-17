"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  useToastActions,
} from "@/components/ui";
import {
  useAdminDashboardStats,
  useUsersList,
  useAdminSyncAllTasks,
  useCheckSyncStatus,
  useAdminActiveSessions,
  useAdminLongSessions,
  useAdminTimeStats,
  useCurrentUserRole,
  useManagedTeams,
} from "@/hooks";
import { DashboardStatCard } from "@/components/admin/DashboardStatCard";
import { EventProposalsPanel } from "@/components/admin/EventProposalsPanel";
import { TeamAdminEmptyState } from "@/components/admin/TeamAdminEmptyState";
import { DashboardFilterToolbar } from "@/components/admin/DashboardFilterToolbar";
import { formatNumber } from "@/lib/utils";
import { ROUTES } from "@/lib/routes";

const TEAM_SCOPE_STORAGE_KEY = "mikro.dashboard.teamScope";

export function AdminDashboard() {
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
  const onTeamIdChange = useCallback((next: number | null) => {
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

  const onRegionCountryIdChange = useCallback((next: number | null) => {
    setRegionCountryId(next);
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
  const {
    data: stats,
    loading: statsLoading,
    error: statsError,
    refetch: refetchStats,
  } = useAdminDashboardStats();
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
  const { mutate: syncAllTasks } = useAdminSyncAllTasks();
  const { mutate: checkSyncStatus } = useCheckSyncStatus();
  const toast = useToastActions();

  // Merge server-aggregated time stats with client-derived active-session counts.
  const timeStats = useMemo(() => {
    const sessions = activeSessions?.sessions || [];
    // Long-running count comes from the dedicated endpoint (10h threshold
    // lives backend-side, SSOT) — covers both still-open sessions and
    // recently-closed ones that recorded >10h.
    const longRunning = longSessions?.sessions?.length ?? 0;
    return {
      weekHours: serverTimeStats?.weekHours ?? 0,
      weekHoursToDate: serverTimeStats?.weekHoursToDate ?? 0,
      lastWeekHours: serverTimeStats?.lastWeekHours ?? 0,
      pendingAdjustments: serverTimeStats?.pendingAdjustments ?? 0,
      lastWeekPendingAdjustments:
        serverTimeStats?.lastWeekPendingAdjustments ?? 0,
      shortSessionClusters: serverTimeStats?.shortSessionClusters ?? 0,
      longRunning,
      activeCount: sessions.length,
    };
  }, [serverTimeStats, activeSessions, longSessions]);
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

  if (statsError) {
        <div className="rounded-lg bg-destructive/10 p-4 text-destructive">
          Error loading dashboard: {statsError}
        </div>
  }

  return (
    <div className="flex flex-col gap-4">
      <EventProposalsPanel />

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
      
      <div className="grid grid-cols-4 gap-3">
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
          tooltip="Total mapping and validation tasks completed this calendar month (Grand Junction time). The change compares completed days this month against the same number of completed days last month."
          loading={statsLoading}
        />
        <DashboardStatCard
          label="Hours This Week"
          value={`${timeStats.weekHours}h`}
          delta={{
            // Compare equal spans: this week's completed days vs the same
            // number of completed days last week (today's partial day excluded
            // from both sides so the trend isn't skewed by an in-progress day).
            value:
              Math.round(
                (timeStats.weekHoursToDate - timeStats.lastWeekHours) * 10,
              ) / 10,
            period: "vs last week",
            format: "hours",
            goodDirection: "up",
          }}
          href={ROUTES.adminTime}
          linkLabel="View time tracking"
          tooltip="Total hours logged by all users this week (Sunday to now, Grand Junction time). The change compares completed days this week against the same number of completed days last week."
          loading={timeHistoryLoading}
        />
      </div>

      {/* HEALTH STRIP — alerts + anomalies. Severity coloring drives the
          at-a-glance read; 0s stay neutral. Self-Validation folded in as
          the 4th card rather than living as a standalone conditional. */}
      <div className="grid grid-cols-4 gap-3">
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

      <div className="grid grid-cols-4 gap-3">
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
    </div>
  );
}
