"use client";

import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  Button,
  Skeleton,
  Val,
  useToastActions,
} from "@/components/ui";
import { useUserProjects, usePaymentsVisible } from "@/hooks";
import { getProjectExternalUrl, formatNumber, formatCurrency } from "@/lib/utils";
import Link from "next/link";
import type { Project } from "@/types";

function ProjectCard({ project, paymentsVisible }: { project: Project; paymentsVisible: boolean }) {
  const progressPercent = project.total_tasks > 0
    ? Math.round(((project.total_mapped ?? 0) / project.total_tasks) * 100)
    : 0;

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader>
        {/* Difficulty badge above project name, right-aligned */}
        <div className="flex justify-end mb-2">
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
        <div>
          <div className="group relative">
            <CardTitle
              className="text-lg truncate"
              style={{ maxHeight: "3.5rem", overflow: "hidden" }}
            >
              <Link
                href={`/projects/${project.id}`}
                className="text-kaart-orange hover:underline cursor-pointer"
                title="View project details"
              >
                {project.name}
              </Link>
            </CardTitle>
            {/* Tooltip on hover */}
            <div className="absolute left-0 top-full mt-1 z-50 hidden group-hover:block max-w-xs">
              <div className="bg-gray-900 text-white text-sm rounded-md px-3 py-2 shadow-lg">
                {project.name}
              </div>
            </div>
          </div>
          <a
            href={getProjectExternalUrl(project.id, project.source)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-kaart-orange hover:underline"
            title={project.source === "mr" ? "Open in MapRoulette" : "Open in Tasking Manager"}
          >
            #{project.id} - {project.source === "mr" ? "Open in MapRoulette" : "Open in TM4"}
          </a>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Progress Bar */}
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-muted-foreground">Progress</span>
            <span className="font-medium">{progressPercent}%</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-kaart-orange rounded-full transition-all"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Total Tasks</p>
            <p className="font-semibold text-lg"><Val>{formatNumber(project.total_tasks)}</Val></p>
          </div>
          <div>
            <p className="text-muted-foreground">Mapped</p>
            <p className="font-semibold text-lg text-green-600">
              <Val>{formatNumber(project.total_mapped)}</Val>
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Validated</p>
            <p className="font-semibold text-lg text-blue-600">
              <Val>{formatNumber(project.total_validated)}</Val>
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Invalidated</p>
            <p className="font-semibold text-lg text-red-600">
              <Val>{formatNumber(project.total_invalidated)}</Val>
            </p>
          </div>
        </div>

        {/* Payment Rates */}
        {paymentsVisible && project.payments_enabled !== false && (
          <div className="border-t border-border pt-4">
            <p className="text-sm text-muted-foreground mb-2">Payment Rates</p>
            <div className="flex gap-4">
              <div className="flex-1 bg-green-50 dark:bg-green-950 rounded-lg p-3 text-center">
                <p className="text-xs text-green-700 dark:text-green-300">Mapping</p>
                <p className="font-bold text-green-800 dark:text-green-200">
                  <Val>{formatCurrency(project.mapping_rate_per_task)}</Val>
                </p>
              </div>
              <div className="flex-1 bg-blue-50 dark:bg-blue-950 rounded-lg p-3 text-center">
                <p className="text-xs text-blue-700 dark:text-blue-300">Validation</p>
                <p className="font-bold text-blue-800 dark:text-blue-200">
                  <Val>{formatCurrency(project.validation_rate_per_task)}</Val>
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Action */}
        <a
          href={getProjectExternalUrl(project.id, project.source)}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full text-center py-2 px-4 bg-kaart-orange text-white rounded-lg hover:bg-kaart-orange-dark transition-colors font-medium"
          title={project.source === "mr" ? "Open this project on MapRoulette" : "Open this project on Tasking Manager"}
        >
          Start Mapping
        </a>
      </CardContent>
    </Card>
  );
}

export function UserProjects() {
  const { data: projects, loading, error } = useUserProjects();
  const { paymentsVisible } = usePaymentsVisible();
  const toast = useToastActions();

  // Show error as toast instead of inline
  useEffect(() => {
    if (error) {
      toast.error(`Projects: ${error}`);
    }
  }, [error]);

  const ROWS_PER_PAGE = 20;
  const [currentPage, setCurrentPage] = useState(1);

  const activeProjects = projects?.user_projects ?? [];

  const totalPages = Math.ceil(activeProjects.length / ROWS_PER_PAGE);
  const paginatedProjects = activeProjects.slice((currentPage - 1) * ROWS_PER_PAGE, currentPage * ROWS_PER_PAGE);
  const showingStart = activeProjects.length > 0 ? (currentPage - 1) * ROWS_PER_PAGE + 1 : 0;
  const showingEnd = Math.min(currentPage * ROWS_PER_PAGE, activeProjects.length);

  if (loading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
        <Skeleton className="h-10 w-48" />
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-80 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      {/* Header */}
      <div style={{ marginBottom: 8 }}>
        <h1 className="text-3xl font-bold tracking-tight">Your Projects</h1>
        <p className="text-muted-foreground" style={{ marginTop: 8 }}>
          Projects assigned to you for mapping and validation
        </p>
      </div>

      {/* Stats Summary - Compact Row */}
      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(4, 1fr)" }} className="grid-stats">
        <Card style={{ padding: 0 }}>
          <div style={{ padding: "12px 16px" }}>
            <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>Active Projects</p>
            <div style={{ fontSize: 20, fontWeight: 700 }}><Val>{formatNumber(activeProjects.length)}</Val></div>
          </div>
        </Card>
        <Card style={{ padding: 0 }}>
          <div style={{ padding: "12px 16px" }}>
            <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>Total Tasks</p>
            <div style={{ fontSize: 20, fontWeight: 700 }}>
              <Val>{formatNumber(activeProjects.reduce((sum, p) => sum + p.total_tasks, 0))}</Val>
            </div>
          </div>
        </Card>
        <Card style={{ padding: 0 }}>
          <div style={{ padding: "12px 16px" }}>
            <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>Tasks Completed</p>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#16a34a" }}>
              <Val>{formatNumber(activeProjects.reduce((sum, p) => sum + (p.total_mapped ?? 0), 0))}</Val>
            </div>
          </div>
        </Card>
        {paymentsVisible && (
          <Card style={{ padding: 0 }}>
            <div style={{ padding: "12px 16px" }}>
              <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>Potential Earnings</p>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#ff6b35" }}>
                <Val>{formatCurrency(
                  activeProjects
                    .filter((p) => p.payments_enabled !== false)
                    .reduce(
                      (sum, p) =>
                        sum +
                        (p.total_tasks - (p.total_mapped ?? 0)) * p.mapping_rate_per_task,
                      0
                    )
                )}</Val>
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* Projects Grid */}
      {activeProjects.length > 0 ? (
        <>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {paginatedProjects.map((project) => (
              <ProjectCard key={project.id} project={project} paymentsVisible={paymentsVisible} />
            ))}
          </div>
          {activeProjects.length > ROWS_PER_PAGE && (
            <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
              <span>Showing {showingStart}-{showingEnd} of {activeProjects.length}</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={currentPage === 1}
                  onClick={() => setCurrentPage(p => p - 1)}>Previous</Button>
                <span className="flex items-center px-2">Page {currentPage} of {totalPages}</span>
                <Button variant="outline" size="sm" disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </>
      ) : (
        <Card>
          <CardContent style={{ padding: "48px 24px", textAlign: "center" }}>
            <div style={{
              width: 48,
              height: 48,
              margin: "0 auto 16px",
              borderRadius: "50%",
              backgroundColor: "#f3f4f6",
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ color: "#6b7280" }}
              >
                <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
            </div>
            <h3 style={{ fontWeight: 600, fontSize: 18, marginBottom: 8 }}>No Projects Assigned</h3>
            <p style={{ color: "#6b7280", maxWidth: 320, margin: "0 auto" }}>
              You don&apos;t have any projects assigned yet. Contact your administrator to get
              started with mapping.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
