"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  Button,
  Val,
  StatCard,
} from "@/components/ui";
import { useFetchProjectProfile, useSyncProject } from "@/hooks/useApi";
import { useToastActions } from "@/components/ui";
import {
  formatNumber,
  formatCurrency,
  displayRole,
  formatDate,
  formatDateTime,
} from "@/lib/utils";
import type { ProjectProfileResponse } from "@/types";
import { NotesButton } from "@/components/widgets/NotesButton";
import { formatDuration } from "@/lib/timeTracking";
import { ROUTES, dynamicRoutes } from "@/lib/routes";

function ProgressBar({
  value,
  color = "bg-kaart-orange",
}: {
  value: number;
  color?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full ${color} rounded-full transition-all`}
          style={{ width: `${Math.min(value, 100)}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground w-12 text-right">
        {value.toFixed(1)}%
      </span>
    </div>
  );
}


const MR_STATUS_LABELS: Record<number, string> = {
  1: "Fixed",
  2: "Not an Issue",
  3: "Skipped",
  5: "Already Fixed",
  6: "Can't Complete",
};

export function AdminProjectProfile() {
  const params = useParams();
  const projectId = Number(params.id);

  const {
    mutate: fetchProfile,
    error: profileError,
  } = useFetchProjectProfile();
  const { mutate: syncProject, loading: syncing } = useSyncProject();
  const toast = useToastActions();

  const [data, setData] = useState<ProjectProfileResponse | null>(null);
  const [pageLoading, setPageLoading] = useState(true);

  // Pagination
  const ROWS_PER_PAGE = 20;
  const [contributorsPage, setContributorsPage] = useState(1);
  const [tasksPage, setTasksPage] = useState(1);
  const [timeEntriesPage, setTimeEntriesPage] = useState(1);

  useEffect(() => {
    if (projectId) {
      fetchProfile({ project_id: projectId })
        .then((res) => {
          if (res?.project) setData(res);
        })
        .catch(() => {})
        .finally(() => setPageLoading(false));
    }
  }, [projectId, fetchProfile]);

  if (pageLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-kaart-orange" />
      </div>
    );
  }

  if (profileError && !data) {
    return (
      <div className="space-y-4">
        <Link
          href={ROUTES.projects}
          className="text-kaart-orange hover:underline text-sm"
        >
          {"\u2190"} Back to Projects
        </Link>
        <Card>
          <CardContent className="p-8 text-center text-red-500">
            Failed to load project profile: {profileError}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  const { project: proj } = data;
  const totalTasks = proj.total_tasks || 0;
  const pctMapped = totalTasks
    ? Math.min((proj.effective_mapped / totalTasks) * 100, 100)
    : 0;
  const pctValidated = totalTasks
    ? Math.min((proj.effective_validated / totalTasks) * 100, 100)
    : 0;
  const remaining = (proj.max_payment || 0) - (proj.total_payout || 0);
  const isMR = proj.source === "mr";

  return (
    <div className="space-y-6">
      {/* Breadcrumb + Header */}
      <div>
        <Link
          href={ROUTES.projects}
          className="text-kaart-orange hover:underline text-sm"
        >
          {"\u2190"} Back to Projects
        </Link>

        <div className="flex items-start justify-between mt-2">
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold">{proj.name}</h1>
              <Badge variant={isMR ? "secondary" : "default"}>
                {isMR ? "MapRoulette" : "TM4"}
              </Badge>
              {proj.status ? (
                <Badge variant="success">Active</Badge>
              ) : (
                <Badge variant="secondary">Inactive</Badge>
              )}
              <Badge variant="outline">{proj.difficulty || "Unknown"}</Badge>
            </div>
            {/* 2026-05-21 (Logan ask): display short name, source ID, and
                source URL alongside the long name. All read-only here —
                short name is editable via the Edit Project modal on the
                projects list. */}
            <dl className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-1 text-sm">
              {proj.short_name && (
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">Short Name:</dt>
                  <dd className="font-medium truncate" title={proj.short_name}>
                    {proj.short_name}
                  </dd>
                </div>
              )}
              <div className="flex gap-2">
                <dt className="text-muted-foreground">Source ID:</dt>
                <dd className="font-mono">{proj.id}</dd>
              </div>
              {proj.url && (
                <div className="flex gap-2 md:col-span-1 min-w-0">
                  <dt className="text-muted-foreground shrink-0">
                    Source URL:
                  </dt>
                  <dd className="min-w-0">
                    <a
                      href={proj.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-kaart-orange hover:underline truncate inline-block max-w-full align-bottom"
                      title={proj.url}
                    >
                      {proj.url}
                    </a>
                  </dd>
                </div>
              )}
            </dl>
            {proj.created_by_name && (
              <p className="text-sm text-muted-foreground mt-2">
                Created by {proj.created_by_name}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={syncing}
              onClick={async () => {
                try {
                  const res = await syncProject({ project_id: projectId });
                  toast.success(res.message || "Sync queued");
                } catch {
                  toast.error("Failed to queue sync");
                }
              }}
            >
              <svg
                className={`w-4 h-4 mr-1 ${syncing ? "animate-spin" : ""}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              {syncing ? "Syncing..." : "Sync Tasks"}
            </Button>
            {proj.url && (
              <a
                href={proj.url}
                target="_blank"
                rel="noopener noreferrer"
                title={isMR ? "Open in MapRoulette" : "Open in Tasking Manager"}
              >
                <Button variant="outline" size="sm">
                  Open External {"\u2197"}
                </Button>
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Section 1: Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Tasks" value={formatNumber(totalTasks)} />
        <StatCard
          label="Mapped"
          value={`${pctMapped.toFixed(1)}%`}
          sub={`${formatNumber(proj.effective_mapped).text} / ${formatNumber(totalTasks).text}`}
        />
        <StatCard
          label="Validated"
          value={`${pctValidated.toFixed(1)}%`}
          sub={`${formatNumber(proj.effective_validated).text} / ${formatNumber(totalTasks).text}`}
        />
        <StatCard
          label="Avg Time / Task"
          value={formatDuration(data.avg_time_per_task)}
        />
      </div>

      {/* Section 2: Financial Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Financial Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div>
              <p className="text-sm text-muted-foreground">Budget</p>
              <p className="text-xl font-semibold">
                <Val>{formatCurrency(proj.max_payment)}</Val>
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Paid Out</p>
              <p className="text-xl font-semibold text-green-600">
                <Val>{formatCurrency(proj.total_payout)}</Val>
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Remaining</p>
              <p className="text-xl font-semibold">
                <Val>{formatCurrency(remaining)}</Val>
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Rates</p>
              <p className="text-sm">
                Map:{" "}
                <span className="font-medium">
                  <Val>{formatCurrency(proj.mapping_rate_per_task)}</Val>
                </span>
                {" / "}
                Val:{" "}
                <span className="font-medium">
                  <Val>{formatCurrency(proj.validation_rate_per_task)}</Val>
                </span>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Section 3: Task Progress */}
      <Card>
        <CardHeader>
          <CardTitle>Task Progress</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground mb-1">
                Mapped (<Val>{formatNumber(proj.effective_mapped)}</Val> /{" "}
                <Val>{formatNumber(totalTasks)}</Val>)
              </p>
              <ProgressBar value={pctMapped} />
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">
                Validated (<Val>{formatNumber(proj.effective_validated)}</Val> /{" "}
                <Val>{formatNumber(totalTasks)}</Val>)
              </p>
              <ProgressBar value={pctValidated} color="bg-blue-500" />
            </div>
          </div>

          {/* MR Status Breakdown */}
          {isMR &&
            proj.mr_status_breakdown &&
            Object.keys(proj.mr_status_breakdown).length > 0 && (
              <div className="mt-4">
                <p className="text-sm font-medium mb-2">
                  MapRoulette Status Breakdown
                </p>
                <div className="flex flex-wrap gap-3">
                  {Object.entries(proj.mr_status_breakdown).map(
                    ([status, count]) => (
                      <div
                        key={status}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-muted rounded-md"
                      >
                        <span className="text-sm font-medium">
                          {MR_STATUS_LABELS[Number(status)] ||
                            `Status ${status}`}
                        </span>
                        <Badge variant="secondary">
                          <Val>{formatNumber(count as number)}</Val>
                        </Badge>
                      </div>
                    ),
                  )}
                </div>
              </div>
            )}

          {proj.split_task_groups > 0 && (
            <p className="text-xs text-muted-foreground">
              {proj.split_task_groups} split task group(s) detected — counts
              reflect effective completions
            </p>
          )}
        </CardContent>
      </Card>

      {/* Section 4: Assigned Users */}
      {data.assigned_users.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Contributors ({data.assigned_users.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted border-b border-border">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-semibold">
                      User
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">
                      Role
                    </th>
                    <th className="px-4 py-3 text-right text-sm font-semibold">
                      Mapped
                    </th>
                    <th className="px-4 py-3 text-right text-sm font-semibold">
                      Validated
                    </th>
                    <th className="px-4 py-3 text-right text-sm font-semibold">
                      Time Logged
                    </th>
                    <th className="px-4 py-3 text-right text-sm font-semibold">
                      Earnings
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.assigned_users
                    .sort((a, b) => b.tasks_mapped - a.tasks_mapped)
                    .slice(
                      (contributorsPage - 1) * ROWS_PER_PAGE,
                      contributorsPage * ROWS_PER_PAGE,
                    )
                    .map((user) => (
                      <tr key={user.id}>
                        <td className="px-4 py-3">
                          <Link
                            href={dynamicRoutes.user(user.id)}
                            className="text-kaart-orange hover:underline font-medium"
                            title="View user profile"
                          >
                            {user.name}
                          </Link>
                          {user.osm_username && (
                            <span className="text-xs text-muted-foreground ml-2">
                              ({user.osm_username})
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="secondary">
                            {displayRole(user.role)}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Val>{formatNumber(user.tasks_mapped)}</Val>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Val>{formatNumber(user.tasks_validated)}</Val>
                        </td>
                        <td className="px-4 py-3 text-right text-muted-foreground">
                          {formatDuration(user.time_logged_seconds)}
                        </td>
                        <td className="px-4 py-3 text-right font-medium">
                          <Val>{formatCurrency(user.earnings)}</Val>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {data.assigned_users.length > ROWS_PER_PAGE && (
              <div className="flex items-center justify-between px-4 py-3 text-sm text-muted-foreground">
                <span>
                  Showing {(contributorsPage - 1) * ROWS_PER_PAGE + 1}-
                  {Math.min(
                    contributorsPage * ROWS_PER_PAGE,
                    data.assigned_users.length,
                  )}{" "}
                  of {data.assigned_users.length}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={contributorsPage === 1}
                    onClick={() => setContributorsPage((p) => p - 1)}
                  >
                    Previous
                  </Button>
                  <span className="flex items-center px-2">
                    Page {contributorsPage} of{" "}
                    {Math.ceil(data.assigned_users.length / ROWS_PER_PAGE)}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={
                      contributorsPage ===
                      Math.ceil(data.assigned_users.length / ROWS_PER_PAGE)
                    }
                    onClick={() => setContributorsPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Section 5: Assigned Teams */}
      {data.assigned_teams.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Teams ({data.assigned_teams.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              {data.assigned_teams.map((team) => (
                <Link
                  key={team.id}
                  href={dynamicRoutes.team(team.id)}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-muted rounded-lg hover:bg-muted/80 transition-colors"
                  title="View team details"
                >
                  <span className="font-medium">{team.name}</span>
                  <Badge variant="secondary">
                    {team.member_count} member
                    {team.member_count !== 1 ? "s" : ""}
                  </Badge>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Section 6: Time Tracking */}
      {data.time_summary.total_seconds > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Time Tracking</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="text-center p-3 bg-muted rounded-lg">
                <p className="text-xs text-muted-foreground">Total</p>
                <p className="text-lg font-bold">
                  {formatDuration(data.time_summary.total_seconds)}
                </p>
              </div>
              {Object.entries(data.time_summary.by_category).map(
                ([cat, secs]) => (
                  <div
                    key={cat}
                    className="text-center p-3 bg-muted rounded-lg"
                  >
                    <p className="text-xs text-muted-foreground capitalize">
                      {cat}
                    </p>
                    <p className="text-lg font-bold">{formatDuration(secs)}</p>
                  </div>
                ),
              )}
            </div>

            {/* Recent Time Entries */}
            {data.recent_time_entries.length > 0 && (
              <div>
                <p className="text-sm font-medium mb-2">Recent Entries</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted border-b border-border">
                      <tr>
                        <th className="px-4 py-2 text-left font-semibold">
                          User
                        </th>
                        <th className="px-4 py-2 text-left font-semibold">
                          Category
                        </th>
                        <th className="px-4 py-2 text-left font-semibold">
                          Clock In
                        </th>
                        <th className="px-4 py-2 text-left font-semibold">
                          Clock Out
                        </th>
                        <th className="px-4 py-2 text-right font-semibold">
                          Duration
                        </th>
                        <th className="px-4 py-2 text-left font-semibold">
                          Notes
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {data.recent_time_entries
                        .slice(
                          (timeEntriesPage - 1) * ROWS_PER_PAGE,
                          timeEntriesPage * ROWS_PER_PAGE,
                        )
                        .map((entry, i) => (
                          <tr key={i}>
                            <td className="px-4 py-2">{entry.user_name}</td>
                            <td className="px-4 py-2 capitalize">
                              {entry.category}
                            </td>
                            <td className="px-4 py-2 text-muted-foreground">
                              {formatDateTime(entry.clock_in)}
                            </td>
                            <td className="px-4 py-2 text-muted-foreground">
                              {formatDateTime(entry.clock_out)}
                            </td>
                            <td className="px-4 py-2 text-right">
                              {formatDuration(entry.duration_seconds)}
                            </td>
                            <td className="px-4 py-2">
                              <NotesButton
                                notes={entry.user_notes}
                                editable={false}
                                size="xs"
                                title={`Note from ${entry.user_name}`}
                              />
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                {data.recent_time_entries.length > ROWS_PER_PAGE && (
                  <div className="flex items-center justify-between mt-3 text-sm text-muted-foreground">
                    <span>
                      Showing {(timeEntriesPage - 1) * ROWS_PER_PAGE + 1}-
                      {Math.min(
                        timeEntriesPage * ROWS_PER_PAGE,
                        data.recent_time_entries.length,
                      )}{" "}
                      of {data.recent_time_entries.length}
                    </span>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={timeEntriesPage === 1}
                        onClick={() => setTimeEntriesPage((p) => p - 1)}
                      >
                        Previous
                      </Button>
                      <span className="flex items-center px-2">
                        Page {timeEntriesPage} of{" "}
                        {Math.ceil(
                          data.recent_time_entries.length / ROWS_PER_PAGE,
                        )}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={
                          timeEntriesPage ===
                          Math.ceil(
                            data.recent_time_entries.length / ROWS_PER_PAGE,
                          )
                        }
                        onClick={() => setTimeEntriesPage((p) => p + 1)}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Section 7: Trainings & Locations */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Trainings */}
        {data.assigned_trainings.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>
                Required Trainings ({data.assigned_trainings.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border">
                {data.assigned_trainings.map((t) => (
                  <div
                    key={t.id}
                    className="px-4 py-3 flex items-center justify-between"
                  >
                    <div>
                      <p className="font-medium">{t.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {t.training_type} &middot; {t.difficulty}
                      </p>
                    </div>
                    <Badge variant="outline">{t.point_value} pts</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Locations */}
        {data.assigned_locations.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>
                Locations ({data.assigned_locations.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {data.assigned_locations.map((loc) => (
                  <Badge
                    key={loc.id}
                    variant="outline"
                    className="text-sm py-1"
                  >
                    {loc.code} &mdash; {loc.name}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Section 8: Recent Tasks */}
      {data.tasks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Tasks (last 50)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted border-b border-border sticky top-0">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold">
                      Task ID
                    </th>
                    <th className="px-4 py-2 text-left font-semibold">
                      Mapped By
                    </th>
                    <th className="px-4 py-2 text-left font-semibold">
                      Validated By
                    </th>
                    <th className="px-4 py-2 text-left font-semibold">
                      Date Mapped
                    </th>
                    <th className="px-4 py-2 text-left font-semibold">
                      Date Validated
                    </th>
                    {isMR && (
                      <th className="px-4 py-2 text-left font-semibold">
                        MR Status
                      </th>
                    )}
                    <th className="px-4 py-2 text-center font-semibold">
                      Paid
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.tasks
                    .slice(
                      (tasksPage - 1) * ROWS_PER_PAGE,
                      tasksPage * ROWS_PER_PAGE,
                    )
                    .map((task, i) => (
                      <tr key={i}>
                        <td className="px-4 py-2 font-mono">{task.task_id}</td>
                        <td className="px-4 py-2">
                          {task.mapped_by || "\u2014"}
                        </td>
                        <td className="px-4 py-2">
                          {task.validated_by || "\u2014"}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {formatDate(task.date_mapped)}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {formatDate(task.date_validated)}
                        </td>
                        {isMR && (
                          <td className="px-4 py-2">
                            {task.mr_status
                              ? MR_STATUS_LABELS[task.mr_status] ||
                                `Status ${task.mr_status}`
                              : "\u2014"}
                          </td>
                        )}
                        <td className="px-4 py-2 text-center">
                          {task.paid_out ? (
                            <span className="text-green-600">Yes</span>
                          ) : (
                            <span className="text-muted-foreground">No</span>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {data.tasks.length > ROWS_PER_PAGE && (
              <div className="flex items-center justify-between px-4 py-3 text-sm text-muted-foreground">
                <span>
                  Showing {(tasksPage - 1) * ROWS_PER_PAGE + 1}-
                  {Math.min(tasksPage * ROWS_PER_PAGE, data.tasks.length)} of{" "}
                  {data.tasks.length}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={tasksPage === 1}
                    onClick={() => setTasksPage((p) => p - 1)}
                  >
                    Previous
                  </Button>
                  <span className="flex items-center px-2">
                    Page {tasksPage} of{" "}
                    {Math.ceil(data.tasks.length / ROWS_PER_PAGE)}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={
                      tasksPage === Math.ceil(data.tasks.length / ROWS_PER_PAGE)
                    }
                    onClick={() => setTasksPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
