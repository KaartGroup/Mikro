"use client";

import { useState } from "react";
import { useUser } from "@auth0/nextjs-auth0/client";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
  Badge,
  Button,
  Val,
  StatCardLink,
} from "@/components/ui";
import { useToastActions } from "@/components/ui";
import { TimeTrackingWidget } from "@/components/widgets/TimeTrackingWidget";
import { UserTimeHistory } from "@/components/widgets/UserTimeHistory";
import {
  useUserDashboardStats,
  useValidatorDashboardStats,
  useUserProjects,
  useValidatorProjects,
  useUserPayable,
  useSubmitPaymentRequest,
  useSyncUserTasks,
} from "@/hooks";
import { useRole } from "@/contexts/RoleContext";
import type { Project, ValidatorDashboardStats } from "@/types";
import {
  formatNumber,
  formatCurrency,
  getProjectExternalUrl,
} from "@/lib/utils";
import Link from "next/link";

const ROWS_PER_PAGE = 20;

function ValidatorProjectsTable({
  projects,
  paymentsVisible,
}: {
  projects: Project[];
  paymentsVisible: boolean;
}) {
  const [page, setPage] = useState(1);

  return (
    <Card>
      <CardHeader>
        <CardTitle>All Assigned Projects</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: 600 }}>
            <thead className="bg-muted">
              <tr>
                <th className="px-2 py-2 text-left text-xs font-medium whitespace-nowrap">
                  Project
                </th>
                {paymentsVisible && (
                  <th className="px-2 py-2 text-left text-xs font-medium whitespace-nowrap">
                    Map Rate
                  </th>
                )}
                {paymentsVisible && (
                  <th className="px-2 py-2 text-left text-xs font-medium whitespace-nowrap">
                    Val Rate
                  </th>
                )}
                <th className="px-2 py-2 text-left text-xs font-medium whitespace-nowrap">
                  Total Tasks
                </th>
                <th className="px-2 py-2 text-left text-xs font-medium whitespace-nowrap">
                  Your Mapped
                </th>
                <th className="px-2 py-2 text-left text-xs font-medium whitespace-nowrap">
                  Your Validated
                </th>
                {paymentsVisible && (
                  <th className="px-2 py-2 text-left text-xs font-medium whitespace-nowrap">
                    Your Earnings
                  </th>
                )}
                <th className="px-2 py-2 text-left text-xs font-medium whitespace-nowrap">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {projects
                .slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE)
                .map((project) => (
                  <tr
                    key={project.id}
                    className="cursor-pointer hover:bg-muted/50 transition-colors"
                    onDoubleClick={() =>
                      window.open(
                        getProjectExternalUrl(project.id, project.source),
                        "_blank",
                        "noopener,noreferrer",
                      )
                    }
                  >
                    <td className="px-2 py-2 font-medium">
                      <Link
                        href={`/projects/${project.id}`}
                        className="text-kaart-orange hover:underline"
                        title="View project details"
                      >
                        {project.name}
                      </Link>
                    </td>
                    {paymentsVisible && (
                      <td className="px-2 py-2">
                        <Val>
                          {formatCurrency(project.mapping_rate_per_task)}
                        </Val>
                      </td>
                    )}
                    {paymentsVisible && (
                      <td className="px-2 py-2">
                        <Val>
                          {formatCurrency(project.validation_rate_per_task)}
                        </Val>
                      </td>
                    )}
                    <td className="px-2 py-2">
                      <Val>{formatNumber(project.total_tasks)}</Val>
                    </td>
                    <td className="px-2 py-2">
                      <Val>{formatNumber(project.tasks_mapped)}</Val>
                    </td>
                    <td className="px-2 py-2">
                      <Val>{formatNumber(project.tasks_validated)}</Val>
                    </td>
                    {paymentsVisible && (
                      <td className="px-2 py-2 text-kaart-orange font-medium">
                        <Val>{formatCurrency(project.user_earnings)}</Val>
                      </td>
                    )}
                    <td className="px-2 py-2">
                      {(project as Project & { unassigned?: boolean })
                        .unassigned ? (
                        <Badge variant="outline">Unassigned</Badge>
                      ) : (
                        <Badge variant="success">Assigned</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              {projects.length === 0 && (
                <tr>
                  <td
                    colSpan={paymentsVisible ? 8 : 5}
                    className="px-4 py-8 text-center text-muted-foreground"
                  >
                    No projects assigned. Contact an admin to be assigned to
                    projects.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {projects.length > ROWS_PER_PAGE && (
          <div className="flex items-center justify-between mt-4 px-4 pb-4 text-sm text-muted-foreground">
            <span>
              Showing {(page - 1) * ROWS_PER_PAGE + 1}–
              {Math.min(page * ROWS_PER_PAGE, projects.length)} of{" "}
              {projects.length}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <span className="flex items-center px-2">
                Page {page} of {Math.ceil(projects.length / ROWS_PER_PAGE)}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page === Math.ceil(projects.length / ROWS_PER_PAGE)}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface Props {
  isValidator?: boolean;
}

export function MapperDashboard({ isValidator = false }: Props) {
  const { user } = useUser();

  // Stats — only one endpoint fetches; the other is disabled at mount
  const {
    data: userStats,
    loading: userStatsLoading,
    refetch: refetchUserStats,
  } = useUserDashboardStats(!isValidator);
  const {
    data: validatorStats,
    loading: validatorStatsLoading,
    refetch: refetchValidatorStats,
  } = useValidatorDashboardStats(isValidator);

  const statsLoading = isValidator ? validatorStatsLoading : userStatsLoading;
  const refetchStats = isValidator ? refetchValidatorStats : refetchUserStats;

  // Projects — only one endpoint fetches
  const {
    data: userProjectsData,
    loading: userProjectsLoading,
    refetch: refetchUserProjects,
  } = useUserProjects(!isValidator);
  const {
    data: validatorProjectsData,
    loading: validatorProjectsLoading,
    refetch: refetchValidatorProjects,
  } = useValidatorProjects(isValidator);

  const projectsLoading = isValidator
    ? validatorProjectsLoading
    : userProjectsLoading;
  const refetchProjects = isValidator
    ? refetchValidatorProjects
    : refetchUserProjects;

  // Flat project list for TimeTrackingWidget, stats card, and validator table
  const projects: Project[] = isValidator
    ? [
        ...(validatorProjectsData?.org_active_projects || []),
        ...(validatorProjectsData?.unassigned_validation_projects || []),
      ]
    : userProjectsData?.user_projects || [];

  // Projects shown in the "Your Projects" card (user sees org-wide active; validator sees their list)
  const displayProjects = isValidator
    ? projects
    : userProjectsData?.org_active_projects || [];

  // Normalized stats fields shared by both views
  const vs = validatorStats as ValidatorDashboardStats | null;
  const tasksMapped = isValidator ? vs?.tasks_mapped : userStats?.mapped_tasks;
  const tasksValidated = isValidator
    ? vs?.tasks_validated
    : userStats?.validated_tasks;
  const tasksInvalidated = isValidator
    ? vs?.tasks_invalidated
    : userStats?.invalidated_tasks;
  const requestsTotal = isValidator
    ? vs?.requests_total
    : userStats?.requests_total;
  const payoutsTotal = isValidator
    ? (vs?.paid_total ?? vs?.payouts_total)
    : userStats?.payouts_total;

  const {
    data: payable,
    loading: payableLoading,
    refetch: refetchPayable,
  } = useUserPayable();
  const { mutate: submitPayment, loading: submittingPayment } =
    useSubmitPaymentRequest();
  const { mutate: syncTasks, loading: syncing } = useSyncUserTasks();
  const { paymentsVisible } = useRole();
  const toast = useToastActions();
  const [isRequestingPayment, setIsRequestingPayment] = useState(false);

  const handleRequestPayment = async () => {
    if (!payable || payable.payable_total <= 0) {
      toast.error("No payable amount available");
      return;
    }
    setIsRequestingPayment(true);
    try {
      await submitPayment({ notes: "" });
      toast.success("Payment request submitted successfully");
      await refetchPayable();
      await refetchStats();
    } catch {
      toast.error("Failed to submit payment request");
    } finally {
      setIsRequestingPayment(false);
    }
  };

  const handleManualSync = async () => {
    try {
      await syncTasks({});
      await Promise.all([refetchStats(), refetchProjects(), refetchPayable()]);
      toast.success("Tasks synced from TM4");
    } catch {
      toast.error("Failed to sync tasks");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
            {isValidator ? "Validator Dashboard" : "Dashboard"}
          </h1>
          <p className="text-muted-foreground" style={{ marginTop: 4 }}>
            Welcome back, {user?.name || user?.email}!
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleManualSync}
          disabled={syncing}
        >
          {syncing ? "Syncing..." : "Sync Tasks"}
        </Button>
      </div>

      {/* Time Tracking */}
      <div
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: "repeat(4, 1fr)",
        }}
      >
        <div style={{ gridColumn: "span 1" }}>
          <TimeTrackingWidget
            projects={projects.map((p) => ({
              id: p.id,
              name: p.name,
              short_name: p.short_name,
              last_worked_on:
                (p as Project & { last_worked_on?: string | null })
                  .last_worked_on ?? null,
            }))}
          />
        </div>
        <div style={{ gridColumn: "span 3" }}>
          <UserTimeHistory />
        </div>
      </div>

      {/* Validator: Self-Validation Warning */}
      {isValidator &&
        vs?.self_validated_count != null &&
        vs.self_validated_count > 0 && (
          <div className="rounded-lg bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 p-4">
            <div className="flex items-center gap-2 mb-2">
              <svg
                className="h-5 w-5 text-yellow-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <p className="font-medium text-yellow-800 dark:text-yellow-200">
                Self-Validation Warning
              </p>
            </div>
            <p className="text-sm text-yellow-700 dark:text-yellow-300">
              {formatNumber(vs.self_validated_count).text} task(s) you validated
              were mapped by you and are not eligible for payment.
            </p>
          </div>
        )}

      {/* Main Stats Cards */}
      <div
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: paymentsVisible
            ? "repeat(4, 1fr)"
            : "repeat(3, 1fr)",
        }}
        className="grid-stats"
      >
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Tasks Mapped</CardTitle>
            <StatCardLink href="/projects" label="View your projects">
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </StatCardLink>
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <>
                <div className="text-2xl font-bold text-kaart-orange">
                  <Val>{formatNumber(tasksMapped)}</Val>
                </div>
                <p className="text-xs text-muted-foreground">
                  {isValidator ? (
                    "Your mapping contributions"
                  ) : (
                    <>
                      <Val>
                        {formatNumber(userStats?.total_contributions_for_month)}
                      </Val>{" "}
                      this month
                    </>
                  )}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {isValidator ? "Tasks Approved" : "Tasks Validated"}
            </CardTitle>
            <StatCardLink href="/projects" label="View your projects">
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </StatCardLink>
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <>
                <div className="text-2xl font-bold text-green-600">
                  <Val>{formatNumber(tasksValidated)}</Val>
                </div>
                <p className="text-xs text-muted-foreground">
                  <Val>{formatNumber(tasksInvalidated)}</Val> invalidated
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {paymentsVisible && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {(requestsTotal ?? 0) > 0
                  ? "Available Balance"
                  : "Payable Total"}
              </CardTitle>
              <StatCardLink href="/payments" label="View payments">
                <svg
                  className={`h-4 w-4 ${(requestsTotal ?? 0) > 0 ? "text-yellow-500" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </StatCardLink>
            </CardHeader>
            <CardContent>
              {payableLoading || statsLoading ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                <>
                  <div className="text-2xl font-bold">
                    <Val>
                      {formatCurrency(
                        payable?.payable_total ?? vs?.payable_total,
                      )}
                    </Val>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {(requestsTotal ?? 0) > 0
                      ? "Request pending"
                      : "Available for payout"}
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Active Projects
            </CardTitle>
            <StatCardLink href="/projects" label="View your projects">
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                />
              </svg>
            </StatCardLink>
          </CardHeader>
          <CardContent>
            {projectsLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <>
                <div className="text-2xl font-bold">{projects.length}</div>
                <p className="text-xs text-muted-foreground">Assigned to you</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Validator: Validation Work Stats */}
      {isValidator && (
        <div>
          <h2 className="text-base font-semibold mb-3">Your Validation Work</h2>
          <div
            style={{
              display: "grid",
              gap: 16,
              gridTemplateColumns: paymentsVisible
                ? "repeat(3, 1fr)"
                : "repeat(2, 1fr)",
            }}
            className="grid-stats"
          >
            <Card className="border-blue-200 bg-blue-50/50 dark:bg-blue-950/20">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Tasks You Validated
                </CardTitle>
                <StatCardLink href="/projects" label="View your projects">
                  <svg
                    className="h-4 w-4 text-blue-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                    />
                  </svg>
                </StatCardLink>
              </CardHeader>
              <CardContent>
                {statsLoading ? (
                  <Skeleton className="h-8 w-16" />
                ) : (
                  <>
                    <div className="text-2xl font-bold text-blue-600">
                      <Val>{formatNumber(vs?.validator_validated)}</Val>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Tasks approved by you
                    </p>
                  </>
                )}
              </CardContent>
            </Card>

            <Card className="border-purple-200 bg-purple-50/50 dark:bg-purple-950/20">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Tasks You Invalidated
                </CardTitle>
                <StatCardLink href="/projects" label="View your projects">
                  <svg
                    className="h-4 w-4 text-purple-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                </StatCardLink>
              </CardHeader>
              <CardContent>
                {statsLoading ? (
                  <Skeleton className="h-8 w-16" />
                ) : (
                  <>
                    <div className="text-2xl font-bold text-purple-600">
                      <Val>{formatNumber(vs?.validator_invalidated)}</Val>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Sent back for fixes
                    </p>
                  </>
                )}
              </CardContent>
            </Card>

            {paymentsVisible && (
              <Card className="border-green-200 bg-green-50/50 dark:bg-green-950/20">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    Validation Earnings
                  </CardTitle>
                  <StatCardLink href="/payments" label="View payments">
                    <svg
                      className="h-4 w-4 text-green-600"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                  </StatCardLink>
                </CardHeader>
                <CardContent>
                  {statsLoading ? (
                    <Skeleton className="h-8 w-20" />
                  ) : (
                    <>
                      <div className="text-2xl font-bold text-green-600">
                        <Val>
                          {formatCurrency(
                            vs?.calculated_validation_earnings ??
                              vs?.validation_payable_total,
                          )}
                        </Val>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        From validation work
                      </p>
                    </>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* Earnings Row */}
      {paymentsVisible && (
        <div
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns: isValidator
              ? "repeat(4, 1fr)"
              : "repeat(5, 1fr)",
          }}
          className="grid-earnings"
        >
          {[
            {
              label: "Mapping Earnings",
              value:
                payable?.mapping_earnings ??
                vs?.mapping_payable_total ??
                userStats?.mapping_payable_total,
              color: "#ff6b35",
              link: "/payments",
              linkLabel: "View payments",
            },
            {
              label: "Validation Earnings",
              value:
                payable?.validation_earnings ??
                vs?.validation_payable_total ??
                userStats?.validation_payable_total,
              color: "#2563eb",
              link: "/payments",
              linkLabel: "View payments",
            },
          ].map(({ label, value, color, link, linkLabel }) => (
            <Card key={label} style={{ padding: 0 }}>
              <div style={{ padding: "10px 14px", position: "relative" }}>
                <div style={{ position: "absolute", top: 8, right: 10 }}>
                  <StatCardLink href={link} label={linkLabel} />
                </div>
                <p style={{ fontSize: 11, color: "#6b7280", marginBottom: 2 }}>
                  {label}
                </p>
                {payableLoading ? (
                  <Skeleton className="h-6 w-20" />
                ) : (
                  <div
                    style={{
                      fontSize: isValidator ? 20 : 18,
                      fontWeight: 700,
                      color,
                    }}
                  >
                    <Val>{formatCurrency(value)}</Val>
                  </div>
                )}
              </div>
            </Card>
          ))}
          {!isValidator && (
            <Card style={{ padding: 0 }}>
              <div style={{ padding: "10px 14px", position: "relative" }}>
                <div style={{ position: "absolute", top: 8, right: 10 }}>
                  <StatCardLink
                    href="/checklists"
                    label="View your checklists"
                  />
                </div>
                <p style={{ fontSize: 11, color: "#6b7280", marginBottom: 2 }}>
                  Checklist Earnings
                </p>
                {payableLoading ? (
                  <Skeleton className="h-6 w-20" />
                ) : (
                  <div
                    style={{ fontSize: 18, fontWeight: 700, color: "#9333ea" }}
                  >
                    <Val>{formatCurrency(payable?.checklist_earnings)}</Val>
                  </div>
                )}
              </div>
            </Card>
          )}
          <Card style={{ padding: 0 }}>
            <div style={{ padding: "10px 14px", position: "relative" }}>
              <div style={{ position: "absolute", top: 8, right: 10 }}>
                <StatCardLink
                  href="/payments"
                  label="Review payment requests"
                />
              </div>
              <p style={{ fontSize: 11, color: "#6b7280", marginBottom: 2 }}>
                Pending Requests
              </p>
              {statsLoading ? (
                <Skeleton className="h-6 w-20" />
              ) : (
                <div
                  style={{
                    fontSize: isValidator ? 20 : 18,
                    fontWeight: 700,
                    color: "#ca8a04",
                  }}
                >
                  <Val>{formatCurrency(requestsTotal)}</Val>
                </div>
              )}
            </div>
          </Card>
          <Card style={{ padding: 0 }}>
            <div style={{ padding: "10px 14px", position: "relative" }}>
              <div style={{ position: "absolute", top: 8, right: 10 }}>
                <StatCardLink href="/payments" label="View payments" />
              </div>
              <p style={{ fontSize: 11, color: "#6b7280", marginBottom: 2 }}>
                Total Received
              </p>
              {statsLoading ? (
                <Skeleton className="h-6 w-20" />
              ) : (
                <div
                  style={{
                    fontSize: isValidator ? 20 : 18,
                    fontWeight: 700,
                    color: "#16a34a",
                  }}
                >
                  <Val>{formatCurrency(payoutsTotal)}</Val>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* Projects + Quick Actions */}
      <div
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: "repeat(2, 1fr)",
        }}
        className="grid-projects"
      >
        <Card>
          <CardHeader
            className="flex flex-row items-center justify-between"
            style={{ padding: "16px 20px 8px" }}
          >
            <CardTitle style={{ fontSize: 18 }}>Your Projects</CardTitle>
            <Link
              href="/projects"
              className="text-sm text-kaart-orange hover:underline"
            >
              View all
            </Link>
          </CardHeader>
          <CardContent style={{ padding: "8px 20px 16px" }}>
            {projectsLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : displayProjects.length > 0 ? (
              <div className="space-y-3">
                {displayProjects.slice(0, 3).map((project) => (
                  <div
                    key={project.id}
                    className={`flex items-center justify-between border-b border-border pb-2 last:border-0 last:pb-0${isValidator ? " cursor-pointer hover:bg-muted/50 -mx-2 px-2 rounded" : ""}`}
                    onClick={
                      isValidator
                        ? () =>
                            window.open(
                              getProjectExternalUrl(project.id, project.source),
                              "_blank",
                              "noopener,noreferrer",
                            )
                        : undefined
                    }
                  >
                    <div>
                      <Link
                        href={`/projects/${project.id}`}
                        className="font-medium text-sm text-kaart-orange hover:underline cursor-pointer"
                        title="View project details"
                        onClick={
                          isValidator ? (e) => e.stopPropagation() : undefined
                        }
                      >
                        {project.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        <a
                          href={getProjectExternalUrl(
                            project.id,
                            project.source,
                          )}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-muted-foreground hover:text-kaart-orange hover:underline cursor-pointer"
                          title={
                            project.source === "mr"
                              ? "Open in MapRoulette"
                              : "Open in Tasking Manager"
                          }
                          onClick={
                            isValidator ? (e) => e.stopPropagation() : undefined
                          }
                        >
                          #{project.id}
                        </a>{" "}
                        &bull; {formatNumber(project.total_tasks).text} tasks
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {isValidator &&
                        (project as Project & { unassigned?: boolean })
                          .unassigned && (
                          <Badge variant="outline" className="text-xs">
                            Unassigned
                          </Badge>
                        )}
                      <Badge
                        variant={
                          project.difficulty === "Easy"
                            ? "success"
                            : project.difficulty === "Medium"
                              ? "warning"
                              : "destructive"
                        }
                      >
                        <Val fallback="Unknown">{project.difficulty}</Val>
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No projects assigned yet. Contact your admin to get started.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader style={{ padding: "16px 20px 8px" }}>
            <CardTitle style={{ fontSize: 18 }}>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent
            className="space-y-3"
            style={{ padding: "8px 20px 16px" }}
          >
            {paymentsVisible && (
              <>
                {(requestsTotal ?? 0) > 0 ? (
                  <div className="rounded-lg bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <svg
                        className="h-4 w-4 text-yellow-600"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                      <p className="font-medium text-sm text-yellow-800 dark:text-yellow-200">
                        Payment Request Pending
                      </p>
                    </div>
                    <p className="text-xs text-yellow-700 dark:text-yellow-300">
                      {isValidator
                        ? `You have a pending request for ${formatCurrency(requestsTotal).text}. You can submit a new request after this one is processed.`
                        : `Pending: ${formatCurrency(requestsTotal).text}`}
                    </p>
                    {isValidator && (payable?.payable_total ?? 0) > 0 && (
                      <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">
                        Additional earnings:{" "}
                        {formatCurrency(payable?.payable_total).text}
                      </p>
                    )}
                  </div>
                ) : (payable?.payable_total ?? vs?.payable_total ?? 0) > 0 ? (
                  <div className="rounded-lg bg-green-50 dark:bg-green-950 p-3">
                    <p className="font-medium text-sm text-green-800 dark:text-green-200">
                      {
                        formatCurrency(
                          payable?.payable_total ?? vs?.payable_total,
                        ).text
                      }{" "}
                      available!
                    </p>
                    <Button
                      variant="primary"
                      size="sm"
                      className="mt-2"
                      onClick={handleRequestPayment}
                      isLoading={isRequestingPayment || submittingPayment}
                      disabled={(payable?.payable_total ?? 0) <= 0}
                    >
                      Request Payment
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {isValidator
                      ? "Complete mapping and validation tasks to earn money. Your validated work will appear here."
                      : "Complete tasks to earn money."}
                  </p>
                )}
              </>
            )}
            <div className="flex flex-wrap gap-2">
              <Link
                href="/projects"
                className="inline-flex items-center rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium hover:bg-secondary/80 transition-colors"
                title="Browse all your assigned projects"
              >
                View Projects
              </Link>
              {paymentsVisible && (
                <Link
                  href="/payments"
                  className="inline-flex items-center rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium hover:bg-secondary/80 transition-colors"
                  title="View your payment history"
                >
                  Payment History
                </Link>
              )}
              {isValidator ? (
                <Link
                  href="/checklists"
                  className="inline-flex items-center rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium hover:bg-secondary/80 transition-colors"
                  title="View your checklists"
                >
                  Checklists
                </Link>
              ) : (
                <Link
                  href="/training"
                  className="inline-flex items-center rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium hover:bg-secondary/80 transition-colors"
                  title="View your training modules"
                >
                  Training
                </Link>
              )}
              <Link
                href="/account"
                className="inline-flex items-center rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium hover:bg-secondary/80 transition-colors"
                title="Manage your account settings"
              >
                Account
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* User-only: Monthly Progress */}
      {!isValidator && (
        <Card>
          <CardHeader style={{ padding: "16px 20px 8px" }}>
            <CardTitle style={{ fontSize: 18 }}>Monthly Progress</CardTitle>
          </CardHeader>
          <CardContent style={{ padding: "8px 20px 16px" }}>
            {statsLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : (
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground mb-1">
                    Contributions this month
                  </p>
                  <div className="text-3xl font-bold">
                    <Val>
                      {formatNumber(userStats?.total_contributions_for_month)}
                    </Val>
                  </div>
                  <p className="text-xs mt-1">
                    {userStats?.month_contribution_change !== undefined &&
                    userStats.month_contribution_change >= 0 ? (
                      <span className="text-green-600">
                        +
                        {formatNumber(userStats.month_contribution_change).text}{" "}
                        from last month
                      </span>
                    ) : (
                      <span className="text-red-600">
                        {
                          formatNumber(userStats?.month_contribution_change)
                            .text
                        }{" "}
                        from last month
                      </span>
                    )}
                  </p>
                </div>
                {userStats?.weekly_contributions_array &&
                  userStats.weekly_contributions_array.length > 0 && (
                    <div className="flex items-end gap-1 h-12">
                      {userStats.weekly_contributions_array.map((count, i) => (
                        <div
                          key={i}
                          className="w-6 bg-kaart-orange rounded-t"
                          style={{
                            height: `${Math.max(10, (count / Math.max(...userStats.weekly_contributions_array)) * 100)}%`,
                          }}
                          title={`Week ${i + 1}: ${count} tasks`}
                        />
                      ))}
                    </div>
                  )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Validator-only: All Projects Table */}
      {isValidator && (
        <>
          <ValidatorProjectsTable
            projects={projects}
            paymentsVisible={paymentsVisible}
          />
          <p className="text-sm text-muted-foreground">
            Double-click a project row to open it in the Tasking Manager.
          </p>
        </>
      )}
    </div>
  );
}
