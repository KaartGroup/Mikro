"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  Button,
  Val,
  useToastActions,
} from "@/components/ui";
import { useUserProjects, usePaymentsVisible, useFetchFilterOptions } from "@/hooks";
import {
  getProjectExternalUrl,
  formatNumber,
  formatCurrency,
} from "@/lib/utils";
import type { Project } from "@/types";
import { ProjectFilters, DEFAULT_FILTERS } from "./ProjectFilters";
import type { ProjectFiltersValue } from "./ProjectFilters";

function ProjectCard({
  project,
  paymentsVisible,
}: {
  project: Project;
  paymentsVisible: boolean;
}) {
  const progressPercent =
    project.total_tasks > 0
      ? Math.round(((project.total_mapped ?? 0) / project.total_tasks) * 100)
      : 0;

  const externalUrl = getProjectExternalUrl(project.id, project.source);

  return (
    <Card
      className="hover:shadow-lg hover:-translate-y-0.5 hover:border-kaart-orange/50 transition-all duration-200 cursor-pointer"
      onClick={() => window.open(externalUrl, "_blank", "noopener,noreferrer")}
    >
      <CardHeader>
        <div className="flex justify-end gap-1.5 mb-2">
          <Badge
            variant="secondary"
            className={project.community ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" : ""}
          >
            {project.community ? "Community" : "Internal"}
          </Badge>
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
          <Badge
            variant={
              project.priority === "High"
                ? "destructive"
                : project.priority === "Low"
                  ? "success"
                  : "warning"
            }
          >
            {project.priority ?? "Medium"}
          </Badge>
        </div>
        <div>
          <CardTitle className="text-lg truncate" title={project.name}>
            {project.name}
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-0.5">
            #{project.id} &mdash;{" "}
            {project.source === "mr" ? "MapRoulette" : "Tasking Manager"}
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
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

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Total Tasks</p>
            <p className="font-semibold text-lg">
              <Val>{formatNumber(project.total_tasks)}</Val>
            </p>
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

        {paymentsVisible && project.payments_enabled !== false && (
          <div className="border-t border-border pt-4">
            <p className="text-sm text-muted-foreground mb-2">Payment Rates</p>
            <div className="flex gap-4">
              <div className="flex-1 bg-green-50 dark:bg-green-950 rounded-lg p-3 text-center">
                <p className="text-xs text-green-700 dark:text-green-300">
                  Mapping
                </p>
                <p className="font-bold text-green-800 dark:text-green-200">
                  <Val>{formatCurrency(project.mapping_rate_per_task)}</Val>
                </p>
              </div>
              <div className="flex-1 bg-blue-50 dark:bg-blue-950 rounded-lg p-3 text-center">
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  Validation
                </p>
                <p className="font-bold text-blue-800 dark:text-blue-200">
                  <Val>{formatCurrency(project.validation_rate_per_task)}</Val>
                </p>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const normalizeForSearch = (s: string): string =>
  (s || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

export function UserProjects() {
  const { data: projects, loading, error, refetch } = useUserProjects();
  const { data: filterOptions } = useFetchFilterOptions();
  const { paymentsVisible } = usePaymentsVisible();
  const toast = useToastActions();


  const [filters, setFilters] = useState<ProjectFiltersValue>(DEFAULT_FILTERS);

  const buildRefetchBody = useCallback((): Record<string, unknown> => {
    const body: Record<string, unknown> = {};
    if (filters.countryId) body.country_id = Number(filters.countryId);
    if (filters.regionId) body.region_id = Number(filters.regionId);
    return body;
  }, [filters.countryId, filters.regionId]);

  useEffect(() => {
    if (refetch) {
      const body = buildRefetchBody();
      refetch(Object.keys(body).length > 0 ? body : {});
    }
  }, [buildRefetchBody, refetch]);

  // Show error as toast instead of inline
  useEffect(() => {
    if (error) {
      toast.error(`Projects: ${error}`);
    }
  }, [error]);

  const ROWS_PER_PAGE = 20;
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    setCurrentPage(1);
  }, [filters]);

  const getCompletionPct = (p: Project): number =>
    p.total_tasks > 0 ? Math.round(((p.total_mapped ?? 0) / p.total_tasks) * 100) : 0;

  const allProjects = projects?.user_projects ?? [];
  const activeProjects = allProjects.filter((p) => {
    if (filters.search.trim()) {
      const q = normalizeForSearch(filters.search.trim());
      const matches =
        normalizeForSearch(p.name || "").includes(q) ||
        normalizeForSearch(p.short_name || "").includes(q) ||
        normalizeForSearch(p.url || "").includes(q) ||
        String(p.id).includes(q);
      if (!matches) return false;
    }
    if (filters.completionFilter) {
      const pct = getCompletionPct(p);
      if (filters.completionFilter === "not-started" && pct !== 0) return false;
      if (filters.completionFilter === "in-progress" && (pct < 1 || pct > 49)) return false;
      if (filters.completionFilter === "almost-done" && (pct < 50 || pct > 99)) return false;
      if (filters.completionFilter === "complete" && pct !== 100) return false;
    }
    if (filters.communityFilter === "community" && !p.community) return false;
    if (filters.communityFilter === "internal" && p.community) return false;
    if (filters.priorityFilter && p.priority !== filters.priorityFilter) return false;
    return true;
  });

  const totalPages = Math.ceil(activeProjects.length / ROWS_PER_PAGE);
  const paginatedProjects = activeProjects.slice(
    (currentPage - 1) * ROWS_PER_PAGE,
    currentPage * ROWS_PER_PAGE,
  );
  const showingStart =
    activeProjects.length > 0 ? (currentPage - 1) * ROWS_PER_PAGE + 1 : 0;
  const showingEnd = Math.min(
    currentPage * ROWS_PER_PAGE,
    activeProjects.length,
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      <ProjectFilters
        filterOptions={filterOptions ?? null}
        onChange={setFilters}
        withCompletion
      />
      {loading && !projects ? (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-kaart-orange" />
        </div>
      ) : activeProjects.length > 0 ? (
        <>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {paginatedProjects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                paymentsVisible={paymentsVisible}
              />
            ))}
          </div>
          {activeProjects.length > ROWS_PER_PAGE && (
            <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
              <span>
                Showing {showingStart}-{showingEnd} of {activeProjects.length}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <span className="flex items-center px-2">
                  Page {currentPage} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      ) : (
        <EmptyUserProjectsPage />
      )}
    </div>
  );
}

function EmptyUserProjectsPage() {
  return (
            <Card>
          <CardContent style={{ padding: "48px 24px", textAlign: "center" }}>
            <div
              style={{
                width: 48,
                height: 48,
                margin: "0 auto 16px",
                borderRadius: "50%",
                backgroundColor: "#f3f4f6",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
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
            <h3 style={{ fontWeight: 600, fontSize: 18, marginBottom: 8 }}>
              No Projects Assigned
            </h3>
            <p style={{ color: "#6b7280", maxWidth: 320, margin: "0 auto" }}>
              You don&apos;t have any projects assigned yet. Contact your
              administrator to get started with mapping.
            </p>
          </CardContent>
        </Card>
  )
}
