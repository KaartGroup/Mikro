"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Button,
  Badge,
  Skeleton,
  ConfirmDialog,
  useToastActions,
} from "@/components/ui";
import {
  useFetchDeletedProjects,
  useRestoreProject,
  usePurgeProject,
  useDismissReactivationRequest,
  useCurrentUserRole,
} from "@/hooks";
import type { DeletedProject } from "@/hooks/useApi";
import { isAnyAdmin } from "@/types";
import { formatDate } from "@/lib/utils";

interface ArchivedProjectsTabProps {
  /** Whether this tab is currently selected — drives lazy (re)load. */
  isActive: boolean;
  /** Called after a successful reactivate/purge/dismiss so the parent can
   *  refresh its main projects list + stats. */
  onChanged?: () => void;
}

/**
 * Inline tab content listing archived (soft-deleted) projects. All admin
 * roles (team_admin and above) can Reactivate, Permanently delete, and
 * Dismiss a pending reactivation request. Rows with a pending request show
 * a "Reactivation requested" badge with the reason/requester.
 */
export function ArchivedProjectsTab({
  isActive,
  onChanged,
}: ArchivedProjectsTabProps) {
  const toast = useToastActions();
  const { role } = useCurrentUserRole();
  // Any admin role (team_admin+) can reactivate, purge, and dismiss requests.
  const canManage = isAnyAdmin(role);

  const { mutate: fetchDeleted, loading: fetching } = useFetchDeletedProjects();
  const { mutate: restoreProject } = useRestoreProject();
  const { mutate: purgeProject } = usePurgeProject();
  const { mutate: dismissRequest } = useDismissReactivationRequest();

  const [projects, setProjects] = useState<DeletedProject[] | null>(null);
  // Tracks which row is mid-action so only that row's buttons spin/disable.
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const [purgingId, setPurgingId] = useState<number | null>(null);
  const [dismissingId, setDismissingId] = useState<number | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<DeletedProject | null>(null);

  const loadList = useCallback(async () => {
    try {
      const resp = await fetchDeleted({});
      setProjects(resp?.projects ?? []);
    } catch {
      setProjects([]);
      /* errors surfaced by the mutation hook */
    }
  }, [fetchDeleted]);

  // Lazily fetch the list when the tab becomes active.
  useEffect(() => {
    if (isActive) {
      setProjects(null);
      loadList();
    }
  }, [isActive, loadList]);

  const busy =
    restoringId !== null || purgingId !== null || dismissingId !== null;

  const handleReactivate = async (project: DeletedProject) => {
    setRestoringId(project.id);
    try {
      await restoreProject({ project_id: project.id });
      toast.success(`Reactivated "${project.short_name || project.name}"`);
      await loadList();
      onChanged?.();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to reactivate project";
      toast.error(message);
    } finally {
      setRestoringId(null);
    }
  };

  const handleDismiss = async (project: DeletedProject) => {
    setDismissingId(project.id);
    try {
      await dismissRequest({ project_id: project.id });
      toast.success(
        `Dismissed reactivation request for "${
          project.short_name || project.name
        }"`,
      );
      await loadList();
      onChanged?.();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to dismiss request";
      toast.error(message);
    } finally {
      setDismissingId(null);
    }
  };

  const handlePurge = async () => {
    if (!purgeTarget) return;
    const project = purgeTarget;
    setPurgingId(project.id);
    try {
      await purgeProject({ project_id: project.id });
      toast.success(
        `Permanently deleted "${project.short_name || project.name}"`,
      );
      setPurgeTarget(null);
      await loadList();
      onChanged?.();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to delete project";
      toast.error(message);
    } finally {
      setPurgingId(null);
    }
  };

  const isEmpty = !fetching && projects !== null && projects.length === 0;

  return (
    <>
      {fetching && projects === null ? (
        <div className="space-y-3 p-4">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : isEmpty ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No archived projects.
        </p>
      ) : (
        <div className="space-y-2 p-4">
          {(projects ?? []).map((project) => {
            const requested = project.reactivation_requested_at !== null;
            return (
              <div
                key={project.id}
                className="flex items-start justify-between gap-3 rounded-md border border-border p-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium truncate">
                      {project.short_name || project.name}
                    </span>
                    {project.source === "mr" ? (
                      <Badge
                        variant="default"
                        className="text-[10px] bg-blue-500"
                      >
                        MR
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[10px]">
                        TM4
                      </Badge>
                    )}
                    {requested && (
                      <Badge
                        variant="warning"
                        className="text-[10px]"
                        title={
                          project.reactivation_reason ??
                          "Reactivation requested"
                        }
                      >
                        Reactivation requested
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Archived {formatDate(project.deleted_date)}
                  </p>
                  {requested && (
                    <div className="mt-1 rounded border border-amber-300 bg-amber-50 p-2 dark:border-amber-700 dark:bg-amber-950/40">
                      <p className="text-xs text-amber-800 dark:text-amber-200">
                        <span className="font-medium">
                          Reactivation requested
                        </span>
                        {project.reactivation_requested_by && (
                          <> by {project.reactivation_requested_by}</>
                        )}
                        {project.reactivation_requested_at && (
                          <>
                            {" "}
                            on{" "}
                            {formatDate(project.reactivation_requested_at)}
                          </>
                        )}
                      </p>
                      {project.reactivation_reason && (
                        <p className="mt-0.5 text-xs italic text-amber-700 dark:text-amber-300">
                          &ldquo;{project.reactivation_reason}&rdquo;
                        </p>
                      )}
                    </div>
                  )}
                </div>
                {canManage && (
                  <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleReactivate(project)}
                      isLoading={restoringId === project.id}
                      disabled={busy}
                    >
                      Reactivate
                    </Button>
                    {requested && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDismiss(project)}
                        isLoading={dismissingId === project.id}
                        disabled={busy}
                      >
                        Dismiss request
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setPurgeTarget(project)}
                      isLoading={purgingId === project.id}
                      disabled={busy}
                    >
                      Permanently delete
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Permanent purge confirmation */}
      <ConfirmDialog
        isOpen={purgeTarget !== null}
        onClose={() => setPurgeTarget(null)}
        onConfirm={handlePurge}
        title="Permanently Delete Project"
        message={`Permanently delete "${
          purgeTarget?.short_name || purgeTarget?.name
        }"? This cannot be undone and will remove all associated task and payment data.`}
        confirmText="Permanently delete"
        variant="destructive"
        isLoading={purgingId !== null}
      />
    </>
  );
}
