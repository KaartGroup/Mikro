"use client";

import { useState, useEffect, useCallback } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Select, SelectOption } from "@/components/ui/Select";
import { NotesButton } from "./NotesButton";
import {
  sortProjectsRecentPinned,
  projectDisplayName,
} from "@/lib/sortProjects";
import { useFetchSubcategories, useUserProjects } from "@/hooks";
import { TOPIC_OPTIONS as _TOPIC_OPTIONS, requiresProjectFor } from "@/lib/timeTracking";
import type { Subcategory } from "@/types";

const TOPIC_OPTIONS: SelectOption[] = _TOPIC_OPTIONS.map((t) => ({
  value: t.value,
  label: t.label,
}));

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
  const [taskName, setTaskName] = useState("");
  const [notes, setNotes] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { mutate: fetchSubcategories } = useFetchSubcategories();
  const { data: unFormattedProjects } = useUserProjects();

  const projects =
    unFormattedProjects?.user_projects?.map((p: UserProject) => ({
      id: p.id,
      name: p.name,
      short_name: p.short_name,
      last_worked_on: p.last_worked_on ?? null,
      total_mapped: p.total_mapped ?? 0,
      total_tasks: p.total_tasks ?? 0,
      in_user_country: p.in_user_country ?? false,
    })) ?? [];

  // Reset all fields whenever the modal (re)opens.
  useEffect(() => {
    if (isOpen) {
      setSelectedTopic("");
      setSelectedSub(null);
      setSubOptions([]);
      setSelectedProject("");
      setTaskName("");
      setNotes(null);
      setError(null);
    }
  }, [isOpen]);

  // Load tier-2 subcategories for the chosen activity.
  useEffect(() => {
    setSelectedSub(null);
    setSelectedProject("");
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

  const projectOptions: SelectOption[] = sortProjectsRecentPinned(projects).map(
    (p) => {
      const isComplete = p.total_tasks > 0 && p.total_mapped >= p.total_tasks;
      const displayName = projectDisplayName(p);
      return {
        value: p.id.toString(),
        label: isComplete ? `✓ ${displayName}` : displayName,
      };
    },
  );

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
      size="md"
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
      <div className="space-y-3">
        {error && <p className="text-xs text-red-600">{error}</p>}
        <Select
          label="Task"
          options={TOPIC_OPTIONS}
          value={selectedTopic}
          onChange={setSelectedTopic}
          placeholder="Select task"
        />
        {subOptions.length > 0 ? (
          <Select
            label="Subcategory"
            options={subOptions.map((s) => ({
              value: String(s.id),
              label: s.name,
            }))}
            value={selectedSub ? String(selectedSub.id) : ""}
            onChange={(v) => {
              const id = v ? parseInt(v, 10) : null;
              setSelectedSub(
                id == null
                  ? null
                  : (subOptions.find((s) => s.id === id) ?? null),
              );
            }}
            placeholder="Select subcategory"
          />
        ) : null}
        {selectedTopic && needsProject && (
          <Select
            label="Project"
            options={projectOptions}
            value={selectedProject}
            onChange={setSelectedProject}
            placeholder="Select a project"
            searchable
          />
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
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        )}
        {selectedTopic && (
          <NotesButton
            notes={notes}
            editable={true}
            onSave={(v) => {
              setNotes(v);
              return Promise.resolve();
            }}
          />
        )}
      </div>
    </Modal>
  );
}
