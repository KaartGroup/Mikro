"use client";

import { useState, useEffect, useCallback } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { NotesButton } from "./NotesButton";
import {
  sortProjectsRecentPinned,
  projectDisplayName,
} from "@/lib/sortProjects";
import { useFetchSubcategories, useUserProjects } from "@/hooks";
import { TOPIC_OPTIONS, requiresProjectFor } from "@/lib/timeTracking";
import type { Subcategory } from "@/types";

// Native <select>/<input> styling. We intentionally use native form controls
// here (not the custom Select) so their dropdowns render as OS overlays —
// inside a scrollable modal body the custom Select's absolute dropdown gets
// clipped, producing a cramped "scroll-to-find-another-scroll" experience.
const fieldClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

type UserProject = {
  id: number;
  name: string;
  short_name?: string;
  last_worked_on?: string | null;
  total_mapped?: number;
  total_tasks?: number;
  in_user_country?: boolean;
};

export interface TaskMetadataPayload {
  category: string;
  subcategoryId: number | null;
  project_id: number | null;
  task_name: string | null;
  userNotes: string | null;
}

interface TaskMetadataModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called with the collected metadata. Should throw on failure so the modal
   *  can surface the error and stay open. */
  onSubmit: (payload: TaskMetadataPayload) => Promise<void>;
  title: string;
  description?: string;
  submitLabel: string;
  loading?: boolean;
}

/**
 * Collects the deferred metadata for a "Switch Task" session that was started
 * without details. Enforces the same minimum as clock-in: a category is
 * required, and a project is required when the chosen activity/subcategory
 * demands one. Subcategory, task name, and notes stay optional.
 *
 * Reused by the main widget (switch + clock-out) and the sidebar (clock-out),
 * so validation lives in exactly one place.
 */
export function TaskMetadataModal({
  isOpen,
  onClose,
  onSubmit,
  title,
  description,
  submitLabel,
  loading = false,
}: TaskMetadataModalProps) {
  const [selectedTopic, setSelectedTopic] = useState("");
  const [selectedSub, setSelectedSub] = useState<Subcategory | null>(null);
  const [subOptions, setSubOptions] = useState<Subcategory[]>([]);
  const [selectedProject, setSelectedProject] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const [taskName, setTaskName] = useState("");
  const [notes, setNotes] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { mutate: fetchSubcategories } = useFetchSubcategories();
  const { data: unFormattedProjects } = useUserProjects();

  const projects = sortProjectsRecentPinned(
    unFormattedProjects?.user_projects?.map((p: UserProject) => ({
      id: p.id,
      name: p.name,
      short_name: p.short_name ?? null,
      last_worked_on: p.last_worked_on ?? null,
      total_mapped: p.total_mapped ?? 0,
      total_tasks: p.total_tasks ?? 0,
      in_user_country: p.in_user_country ?? false,
    })) ?? [],
  );

  // Reset all fields whenever the modal (re)opens.
  useEffect(() => {
    if (isOpen) {
      setSelectedTopic("");
      setSelectedSub(null);
      setSubOptions([]);
      setSelectedProject("");
      setProjectSearch("");
      setTaskName("");
      setNotes(null);
      setError(null);
    }
  }, [isOpen]);

  // Load tier-2 subcategories for the chosen activity.
  useEffect(() => {
    setSelectedSub(null);
    setSelectedProject("");
    setProjectSearch("");
    setTaskName("");
    if (!selectedTopic) {
      setSubOptions([]);
      return;
    }
    let cancelled = false;
    fetchSubcategories({ activity: selectedTopic })
      .then((res) => {
        if (!cancelled) setSubOptions(res?.subcategories ?? []);
      })
      .catch(() => {
        if (!cancelled) setSubOptions([]);
      });
    return () => {
      cancelled = true;
    };
    // fetchSubcategories is a non-stable mutation hook; intentionally excluded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTopic]);

  const needsProject = requiresProjectFor(selectedTopic, selectedSub);

  const filteredProjects = projectSearch.trim()
    ? projects.filter((p) => {
        const q = projectSearch.toLowerCase();
        if (p.name.toLowerCase().includes(q)) return true;
        if (p.short_name && p.short_name.toLowerCase().includes(q)) return true;
        if (selectedProject && p.id.toString() === selectedProject) return true;
        return false;
      })
    : projects;

  const handleSubmit = useCallback(async () => {
    setError(null);
    if (!selectedTopic) {
      setError("Please pick a category.");
      return;
    }
    if (needsProject && !selectedProject) {
      setError("This category requires a project.");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        category: selectedTopic,
        subcategoryId: selectedSub?.id ?? null,
        project_id: selectedProject ? parseInt(selectedProject, 10) : null,
        task_name: taskName || null,
        userNotes: notes,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }, [
    selectedTopic,
    selectedSub,
    selectedProject,
    taskName,
    notes,
    needsProject,
    onSubmit,
  ]);

  const busy = loading || submitting;

  return (
    <Modal
      isOpen={isOpen}
      onClose={busy ? () => {} : onClose}
      title={title}
      description={description}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={
              busy || !selectedTopic || (needsProject && !selectedProject)
            }
          >
            {busy ? "Saving..." : submitLabel}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            Task <span className="text-red-500">*</span>
          </label>
          <select
            className={fieldClass}
            value={selectedTopic}
            onChange={(e) => setSelectedTopic(e.target.value)}
          >
            <option value="">Select task...</option>
            {TOPIC_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        {subOptions.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Subcategory
            </label>
            <select
              className={fieldClass}
              value={selectedSub?.id ?? ""}
              onChange={(e) => {
                const id = e.target.value ? parseInt(e.target.value, 10) : null;
                setSelectedSub(
                  id == null
                    ? null
                    : (subOptions.find((s) => s.id === id) ?? null),
                );
              }}
            >
              <option value="">Select subcategory (optional)...</option>
              {subOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {selectedTopic && needsProject && (
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Project <span className="text-red-500">*</span>
            </label>
            {projects.length > 6 && (
              <input
                type="text"
                className={`${fieldClass} mb-2`}
                value={projectSearch}
                onChange={(e) => setProjectSearch(e.target.value)}
                placeholder={`Search ${projects.length} projects...`}
                aria-label="Search projects"
              />
            )}
            <select
              className={fieldClass}
              value={selectedProject}
              onChange={(e) => setSelectedProject(e.target.value)}
              size={1}
            >
              <option value="">
                {filteredProjects.length === 0
                  ? "No matching projects"
                  : "Select a project..."}
              </option>
              {filteredProjects.map((p) => {
                const isComplete =
                  p.total_tasks > 0 && p.total_mapped >= p.total_tasks;
                return (
                  <option key={p.id} value={p.id.toString()}>
                    {isComplete
                      ? `✓ ${projectDisplayName(p)}`
                      : projectDisplayName(p)}
                  </option>
                );
              })}
            </select>
          </div>
        )}

        {selectedTopic && !needsProject && (
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Task Name
            </label>
            <input
              type="text"
              value={taskName}
              onChange={(e) => setTaskName(e.target.value)}
              placeholder="Describe the task (optional)"
              className={fieldClass}
            />
          </div>
        )}

        {selectedTopic && (
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Notes
            </label>
            <NotesButton
              notes={notes}
              editable={true}
              onSave={(v) => {
                setNotes(v);
                return Promise.resolve();
              }}
            />
          </div>
        )}
      </div>
    </Modal>
  );
}
