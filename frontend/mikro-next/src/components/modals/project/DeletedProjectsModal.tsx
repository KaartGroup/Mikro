"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Modal,
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
  useCurrentUserRole,
} from "@/hooks";
import type { DeletedProject } from "@/hooks/useApi";
import { isOrgAdminOrAbove } from "@/types";
import { formatDate } from "@/lib/utils";

interface DeletedProjectsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after a successful restore/purge so the parent can refresh
   *  its main projects list + stats. */
  onChanged?: () => void;
}

/**
 * Lists soft-deleted projects (deleted_date set) and lets admins restore
 * them. Org admins (admin/super_admin) additionally get a "Permanently
 * delete" action that hard-purges the project after a confirm dialog.
 */
export function DeletedProjectsModal({
  isOpen,
  onClose,
  onChanged,
}: DeletedProjectsModalProps) {
  const toast = useToastActions();
  const { role } = useCurrentUserRole();
  const canPurge = isOrgAdminOrAbove(role);

  const { mutate: fetchDeleted, loading: fetching } = useFetchDeletedProjects();
  const { mutate: restoreProject } = useRestoreProject();
  const { mutate: purgeProject } = usePurgeProject();

  const [projects, setProjects] = useState<DeletedProject[] | null>(null);
  // Tracks which row is mid-action so only that row's buttons spin/disable.
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const [purgingId, setPurgingId] = useState<number | null>(null);
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

  // Fetch the list each time the modal opens.
  useEffect(() => {
    if (isOpen) {
      setProjects(null);
      loadList();
    }
  }, [isOpen, loadList]);

  const handleRestore = async (project: DeletedProject) => {
    setRestoringId(project.id);
    try {
      await restoreProject({ project_id: project.id });
      toast.success(`Restored "${project.short_name || project.name}"`);
      await loadList();
      onChanged?.();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to restore project";
      toast.error(message);
    } finally {
      setRestoringId(null);
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
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title="Deleted Projects"
        description="Restore a soft-deleted project, or permanently remove it."
        size="2xl"
      >
        {fetching && projects === null ? (
          <div className="space-y-3">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : isEmpty ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No deleted projects.
          </p>
        ) : (
          <div className="space-y-2">
            {(projects ?? []).map((project) => (
              <div
                key={project.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
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
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Deleted {formatDate(project.deleted_date)}
                  </p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleRestore(project)}
                    isLoading={restoringId === project.id}
                    disabled={restoringId !== null || purgingId !== null}
                  >
                    Restore
                  </Button>
                  {canPurge && (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setPurgeTarget(project)}
                      isLoading={purgingId === project.id}
                      disabled={restoringId !== null || purgingId !== null}
                    >
                      Permanently delete
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* Org-admin-only permanent purge confirmation */}
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
