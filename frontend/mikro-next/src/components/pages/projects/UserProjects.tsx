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
import { useUserProjectsPaged, useFetchFilterOptions } from "@/hooks";
import { useRole } from "@/contexts/RoleContext";
import {
  getProjectExternalUrl,
  formatNumber,
  formatCurrency,
} from "@/lib/utils";
import type { Project, UserProjectsPagedResponse } from "@/types";
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

export function UserProjects() {
  const { mutate: fetchUserPage } = useUserProjectsPaged();
  const { data: filterOptions } = useFetchFilterOptions();
  const { paymentsVisible } = useRole();
  const toast = useToastActions();

  const [filters, setFilters] = useState<ProjectFiltersValue>(DEFAULT_FILTERS);
  // Debounced search → one server request after typing settles.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const ROWS_PER_PAGE = 20;
  const [currentPage, setCurrentPage] = useState(1);

  const [listResp, setListResp] = useState<UserProjectsPagedResponse | null>(
    null,
  );
  const [listLoading, setListLoading] = useState(true);

  // Debounce the search box.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(filters.search.trim()), 300);
    return () => clearTimeout(t);
  }, [filters.search]);

  // Filter dimensions sent to the server. Depends on individual fields (not
  // the whole `filters` object) so it doesn't change on every keystroke —
  // only the debounced search feeds it.
  const buildFilterBody = useCallback((): Record<string, unknown> => {
    const body: Record<string, unknown> = {};
    if (debouncedSearch) body.search = debouncedSearch;
    if (filters.countryId) body.country_id = Number(filters.countryId);
    if (filters.regionId) body.region_id = Number(filters.regionId);
    if (filters.communityFilter)
      body.community = filters.communityFilter === "community";
    if (filters.priorityFilter) body.priority = filters.priorityFilter;
    return body;
  }, [
    debouncedSearch,
    filters.countryId,
    filters.regionId,
    filters.communityFilter,
    filters.priorityFilter,
  ]);

  const fetchList = useCallback(async () => {
    setListLoading(true);
    try {
      const resp = await fetchUserPage({
        ...buildFilterBody(),
        page: currentPage,
        page_size: ROWS_PER_PAGE,
      });
      setListResp(resp ?? null);
    } catch (e) {
      toast.error(
        `Projects: ${e instanceof Error ? e.message : "Failed to load"}`,
      );
    } finally {
      setListLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildFilterBody, currentPage]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  // Reset to page 1 whenever the filtered result set changes (debounced
  // for search). Page itself is intentionally excluded.
  useEffect(() => {
    setCurrentPage(1);
  }, [
    debouncedSearch,
    filters.countryId,
    filters.regionId,
    filters.communityFilter,
    filters.priorityFilter,
  ]);

  const projectsPage = listResp?.user_projects ?? [];
  const total = listResp?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / ROWS_PER_PAGE));
  const showingStart = total > 0 ? (currentPage - 1) * ROWS_PER_PAGE + 1 : 0;
  const showingEnd = Math.min(currentPage * ROWS_PER_PAGE, total);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      <ProjectFilters
        filterOptions={filterOptions ?? null}
        onChange={setFilters}
      />
      {listLoading && !listResp ? (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-kaart-orange" />
        </div>
      ) : total > 0 ? (
        <>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {projectsPage.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                paymentsVisible={paymentsVisible}
              />
            ))}
          </div>
          {total > ROWS_PER_PAGE && (
            <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
              <span>
                Showing {showingStart}-{showingEnd} of {total}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage === 1 || listLoading}
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
                  disabled={currentPage >= totalPages || listLoading}
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
