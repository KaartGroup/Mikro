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
import { TablePaginator } from "@/components/tables/TablePaginator";
import {
  useUserProjectsPaged,
  useFetchFilterOptions,
  useFetchMyArchivedProjects,
} from "@/hooks";
import type { MyArchivedProject } from "@/hooks";
import { useRole } from "@/contexts/RoleContext";
import {
  getProjectExternalUrl,
  formatNumber,
  formatCurrency,
  formatDate,
} from "@/lib/utils";
import type { Project, UserProjectsPagedResponse } from "@/types";
import { projectDisplayName } from "@/lib/sortProjects";
import { ProjectFilters, DEFAULT_FILTERS } from "./ProjectFilters";
import type { ProjectFiltersValue } from "./ProjectFilters";
import { RequestReactivationModal } from "@/components/modals/project/RequestReactivationModal";
import { ProposeProjectModal } from "@/components/modals/project/ProposeProjectModal";
import {
  useMyProjectProposals,
  useWithdrawProjectProposal,
} from "@/hooks";
import type { ProjectProposal, ProjectProposalStatus } from "@/types";

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
            {projectDisplayName(project)}
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

  const [tab, setTab] = useState<"active" | "archived">("active");

  const [proposeOpen, setProposeOpen] = useState(false);
  const [proposalsKey, setProposalsKey] = useState(0);

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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      <div className="flex items-center justify-between border-b border-border">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setTab("active")}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === "active"
                ? "border-kaart-orange text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Active
          </button>
          <button
            type="button"
            onClick={() => setTab("archived")}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === "archived"
                ? "border-kaart-orange text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Archived
          </button>
        </div>
        <Button
          variant="primary"
          size="sm"
          className="mb-0.5"
          onClick={() => setProposeOpen(true)}
        >
          Propose a Project
        </Button>
      </div>

      <ProposeProjectModal
        open={proposeOpen}
        onClose={() => setProposeOpen(false)}
        onSuccess={() => setProposalsKey((k) => k + 1)}
      />

      {tab === "archived" ? (
        <ArchivedProjects />
      ) : (
        <>
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
            <TablePaginator
              page={currentPage}
              totalItems={total}
              pageSize={ROWS_PER_PAGE}
              onPageChange={setCurrentPage}
              disabled={listLoading}
            />
          )}
        </>
      ) : (
        <EmptyUserProjectsPage />
      )}
        </>
      )}

      <MyProposals key={proposalsKey} onProposalChanged={() => setProposalsKey((k) => k + 1)} />
    </div>
  );
}

/**
 * Read-only list of the current user's archived (soft-deleted) assigned
 * projects. Each row offers a "Request reactivation" action; once a request
 * exists the button is replaced with a "Reactivation requested" badge.
 */
function ArchivedProjects() {
  const { mutate: fetchArchived, loading: fetching } =
    useFetchMyArchivedProjects();
  const [projects, setProjects] = useState<MyArchivedProject[] | null>(null);
  const [reactivateTarget, setReactivateTarget] =
    useState<MyArchivedProject | null>(null);

  const loadList = useCallback(async () => {
    try {
      const resp = await fetchArchived({});
      setProjects(resp?.projects ?? []);
    } catch {
      setProjects([]);
      /* errors surfaced by the mutation hook */
    }
  }, [fetchArchived]);

  // Fetch when the Archived section opens.
  useEffect(() => {
    loadList();
  }, [loadList]);

  const isEmpty = !fetching && projects !== null && projects.length === 0;

  if (fetching && projects === null) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-kaart-orange" />
      </div>
    );
  }

  if (isEmpty) {
    return (
      <Card>
        <CardContent style={{ padding: "48px 24px", textAlign: "center" }}>
          <p style={{ color: "#6b7280" }}>No archived projects.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {(projects ?? []).map((project) => (
          <Card key={project.id} className="cursor-default">
            <CardHeader>
              <div className="flex justify-end gap-1.5 mb-2">
                {project.source === "mr" ? (
                  <Badge variant="default" className="bg-blue-500">
                    MapRoulette
                  </Badge>
                ) : (
                  <Badge variant="secondary">Tasking Manager</Badge>
                )}
                {project.reactivation_requested && (
                  <Badge variant="warning">Reactivation requested</Badge>
                )}
              </div>
              <div>
                <CardTitle className="text-lg truncate" title={project.name}>
                  {projectDisplayName(project)}
                </CardTitle>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Archived {formatDate(project.deleted_date)}
                </p>
              </div>
            </CardHeader>
            <CardContent>
              {project.reactivation_requested ? (
                <Button variant="outline" size="sm" disabled>
                  Reactivation requested
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setReactivateTarget(project)}
                >
                  Request reactivation
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <RequestReactivationModal
        isOpen={reactivateTarget !== null}
        project={reactivateTarget}
        onClose={() => setReactivateTarget(null)}
        onRequested={loadList}
      />
    </>
  );
}

// ── Status badge helper ──────────────────────────────────────────────────────

function ProposalStatusBadge({ status }: { status: ProjectProposalStatus }) {
  const config: Record<
    ProjectProposalStatus,
    { label: string; className: string }
  > = {
    pending: {
      label: "Pending",
      className:
        "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
    },
    changes_requested: {
      label: "Changes requested",
      className:
        "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
    },
    approved: {
      label: "Approved",
      className:
        "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
    },
    provisioned: {
      label: "Provisioned",
      className:
        "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
    },
    denied: {
      label: "Denied",
      className: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
    },
    deferred: {
      label: "Deferred",
      className:
        "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    },
    withdrawn: {
      label: "Withdrawn",
      className:
        "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    },
  };

  const { label, className } = config[status] ?? {
    label: status,
    className: "bg-gray-100 text-gray-700",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${className}`}
    >
      {label}
    </span>
  );
}

// ── My Proposals section ─────────────────────────────────────────────────────

function MyProposals({ onProposalChanged }: { onProposalChanged: () => void }) {
  const toast = useToastActions();
  const { mutate: fetchMyProposals, loading: fetching } =
    useMyProjectProposals();
  const { mutate: withdrawProposal } = useWithdrawProjectProposal();

  const [proposals, setProposals] = useState<ProjectProposal[] | null>(null);
  const [sectionOpen, setSectionOpen] = useState(true);
  const [withdrawingId, setWithdrawingId] = useState<number | null>(null);
  const [confirmWithdrawId, setConfirmWithdrawId] = useState<number | null>(
    null,
  );
  const [resubmitTarget, setResubmitTarget] = useState<ProjectProposal | null>(
    null,
  );

  const loadProposals = useCallback(async () => {
    try {
      const resp = await fetchMyProposals({});
      setProposals(resp?.proposals ?? []);
    } catch {
      setProposals([]);
    }
  }, [fetchMyProposals]);

  useEffect(() => {
    loadProposals();
  }, [loadProposals]);

  // Hide entire section if user has no proposals
  if (!fetching && proposals !== null && proposals.length === 0) return null;

  const handleWithdraw = async (proposalId: number) => {
    setWithdrawingId(proposalId);
    try {
      await withdrawProposal({ proposal_id: proposalId });
      toast.success("Proposal withdrawn.");
      onProposalChanged();
      await loadProposals();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to withdraw proposal",
      );
    } finally {
      setWithdrawingId(null);
      setConfirmWithdrawId(null);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <button
            type="button"
            className="flex w-full items-center justify-between"
            onClick={() => setSectionOpen((v) => !v)}
          >
            <CardTitle className="text-base">My Project Proposals</CardTitle>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`transition-transform ${sectionOpen ? "rotate-180" : ""}`}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </CardHeader>

        {sectionOpen && (
          <CardContent>
            {fetching && proposals === null ? (
              <div className="flex justify-center py-8">
                <div className="h-6 w-6 animate-spin rounded-full border-4 border-muted border-t-kaart-orange" />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="pb-2 pr-4 font-medium text-muted-foreground">
                        Name / Area
                      </th>
                      <th className="pb-2 pr-4 font-medium text-muted-foreground">
                        Status
                      </th>
                      <th className="pb-2 pr-4 font-medium text-muted-foreground">
                        Submitted
                      </th>
                      <th className="pb-2 pr-4 font-medium text-muted-foreground">
                        Reviewer note
                      </th>
                      <th className="pb-2 font-medium text-muted-foreground">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(proposals ?? []).map((proposal) => (
                      <tr
                        key={proposal.id}
                        className="border-b border-border last:border-0"
                      >
                        <td className="py-3 pr-4">
                          <p className="font-medium">
                            {proposal.proposed_name ||
                              proposal.area_description?.slice(0, 60) ||
                              `Proposal #${proposal.id}`}
                          </p>
                          {proposal.url && (
                            <a
                              href={proposal.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-kaart-orange hover:underline truncate block max-w-xs"
                            >
                              {proposal.url}
                            </a>
                          )}
                        </td>
                        <td className="py-3 pr-4">
                          <ProposalStatusBadge status={proposal.status} />
                        </td>
                        <td className="py-3 pr-4 text-muted-foreground whitespace-nowrap">
                          {formatDate(proposal.submitted_at)}
                        </td>
                        <td className="py-3 pr-4 text-muted-foreground max-w-xs">
                          {proposal.reviewer_note ? (
                            <span className="italic">
                              {proposal.reviewer_note}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/50">—</span>
                          )}
                        </td>
                        <td className="py-3">
                          <div className="flex gap-2">
                            {proposal.status === "pending" && (
                              <>
                                {confirmWithdrawId === proposal.id ? (
                                  <>
                                    <Button
                                      variant="destructive"
                                      size="sm"
                                      isLoading={withdrawingId === proposal.id}
                                      onClick={() =>
                                        handleWithdraw(proposal.id)
                                      }
                                    >
                                      Confirm
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() =>
                                        setConfirmWithdrawId(null)
                                      }
                                    >
                                      Cancel
                                    </Button>
                                  </>
                                ) : (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                      setConfirmWithdrawId(proposal.id)
                                    }
                                  >
                                    Withdraw
                                  </Button>
                                )}
                              </>
                            )}
                            {proposal.status === "changes_requested" && (
                              <Button
                                variant="primary"
                                size="sm"
                                onClick={() => setResubmitTarget(proposal)}
                              >
                                Edit &amp; Resubmit
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        )}
      </Card>

      <ProposeProjectModal
        open={resubmitTarget !== null}
        onClose={() => setResubmitTarget(null)}
        onSuccess={async () => {
          setResubmitTarget(null);
          onProposalChanged();
          await loadProposals();
        }}
        resubmitProposal={resubmitTarget ?? undefined}
      />
    </>
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
