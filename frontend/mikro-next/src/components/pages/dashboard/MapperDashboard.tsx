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
    </div>
  );
}
