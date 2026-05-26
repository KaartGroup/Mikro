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
  StatCard,
  Val,
} from "@/components/ui";
import { useUser } from "@auth0/nextjs-auth0/client";
import { useFetchProjectProfile } from "@/hooks/useApi";
import { usePaymentsVisible } from "@/hooks";
import {
  formatNumber,
  formatCurrency,
  getProjectExternalUrl,
} from "@/lib/utils";
import type { ProjectProfileResponse } from "@/types";

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

export function UserProjectProfile() {
  const params = useParams();
  const projectId = Number(params.id);
  const { user: auth0User } = useUser();
  const { paymentsVisible } = usePaymentsVisible();

  const {
    mutate: fetchProfile,
    loading: profileLoading,
    error: profileError,
  } = useFetchProjectProfile();

  const [data, setData] = useState<ProjectProfileResponse | null>(null);
  const [pageLoading, setPageLoading] = useState(true);

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
          href="/projects"
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
    ? (proj.effective_mapped / totalTasks) * 100
    : 0;
  const pctValidated = totalTasks
    ? (proj.effective_validated / totalTasks) * 100
    : 0;
  const isMR = proj.source === "mr";
  const sourceLabel = isMR ? "MapRoulette" : "Tasking Manager";
  const externalUrl = getProjectExternalUrl(proj.id, proj.source);

  return (
    <div className="space-y-6">
      {/* Breadcrumb + Header */}
      <div>
        <Link
          href="/projects"
          className="text-kaart-orange hover:underline text-sm"
        >
          {"\u2190"} Back to Projects
        </Link>

        <div className="flex items-start justify-between mt-2">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">{proj.name}</h1>
              <Badge
                variant={isMR ? "secondary" : "default"}
                className="text-kaart-orange"
              >
                {isMR ? "MapRoulette" : "TM4"}
              </Badge>
              {proj.difficulty && (
                <Badge variant="outline">{proj.difficulty}</Badge>
              )}
            </div>
          </div>

          <a
            href={externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={`Open this project on ${sourceLabel}`}
          >
            <Button variant="outline" size="sm">
              Open in {sourceLabel} {"\u2197"}
            </Button>
          </a>
        </div>
      </div>

      {/* Stats Cards */}
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
          label="Difficulty"
          value={proj.difficulty || "Unknown"}
        />
      </div>

      {/* Your Progress */}
      {data.assigned_users.length > 0 && (() => {
        // Find the current logged-in user by matching their Auth0 email
        const me = data.assigned_users.find((u) => u.email === auth0User?.email);
        if (!me) return null;
        return (
          <Card>
            <CardHeader>
              <CardTitle>Your Progress</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                <div>
                  <p className="text-sm text-muted-foreground">Tasks Mapped</p>
                  <p className="text-xl font-semibold">
                    <Val>{formatNumber(me.tasks_mapped)}</Val>
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Tasks Validated</p>
                  <p className="text-xl font-semibold">
                    <Val>{formatNumber(me.tasks_validated)}</Val>
                  </p>
                </div>
                {paymentsVisible && proj.payments_enabled !== false && (
                  <div>
                    <p className="text-sm text-muted-foreground">Your Earnings</p>
                    <p className="text-xl font-semibold text-green-600">
                      <Val>{formatCurrency(me.earnings)}</Val>
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-sm text-muted-foreground">Time Logged</p>
                  <p className="text-xl font-semibold">
                    {me.time_logged_seconds > 0
                      ? me.time_logged_seconds >= 3600
                        ? `${Math.floor(me.time_logged_seconds / 3600)}h ${Math.floor((me.time_logged_seconds % 3600) / 60)}m`
                        : `${Math.floor(me.time_logged_seconds / 60)}m`
                      : "\u2014"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Task Progress */}
      <Card>
        <CardHeader>
          <CardTitle>Task Progress</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground mb-1">
                Mapped ({formatNumber(proj.effective_mapped).text} /{" "}
                {formatNumber(totalTasks).text})
              </p>
              <ProgressBar value={pctMapped} />
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">
                Validated ({formatNumber(proj.effective_validated).text} /{" "}
                {formatNumber(totalTasks).text})
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
                    )
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

      {/* Rates */}
      {paymentsVisible && proj.payments_enabled !== false && (
        <Card>
          <CardHeader>
            <CardTitle>Rates</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <p className="text-sm text-muted-foreground">
                  Mapping Rate per Task
                </p>
                <p className="text-xl font-semibold">
                  <Val>{formatCurrency(proj.mapping_rate_per_task)}</Val>
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  Validation Rate per Task
                </p>
                <p className="text-xl font-semibold">
                  <Val>{formatCurrency(proj.validation_rate_per_task)}</Val>
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
