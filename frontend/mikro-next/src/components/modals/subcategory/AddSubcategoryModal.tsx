"use client";

import { useEffect, useState } from "react";
import { Modal, Button, Input, Select, useToastActions } from "@/components/ui";
import { TOPIC_OPTIONS, slugifyName } from "@/lib/timeTracking";
import { useCreateSubcategory } from "@/hooks";
import type { SubcategoryScope } from "@/types";

interface AddSubcategoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  scopeOptions: { value: SubcategoryScope; label: string }[];
  teams: { id: number; name: string }[];
  /** Called after a subcategory is successfully created, e.g. to refresh the list. */
  onCreated?: () => void;
}

export function AddSubcategoryModal({
  isOpen,
  onClose,
  scopeOptions,
  teams,
  onCreated,
}: AddSubcategoryModalProps) {
  const toast = useToastActions();
  const { mutate: createSubcategory, loading: creating } =
    useCreateSubcategory();

  const [activity, setActivity] = useState("");
  const [name, setName] = useState("");
  const [scope, setScope] = useState<SubcategoryScope>(
    scopeOptions[0]?.value ?? "org",
  );
  const [teamId, setTeamId] = useState("");
  const [requiresProject, setRequiresProject] = useState(false);
  const [allowEventFields, setAllowEventFields] = useState(false);
  const [sortOrder, setSortOrder] = useState("0");

  // Seed / reset fields whenever the modal (re)opens.
  useEffect(() => {
    if (isOpen) {
      setActivity("");
      setName("");
      setScope(scopeOptions[0]?.value ?? "org");
      setTeamId("");
      setRequiresProject(false);
      setAllowEventFields(false);
      setSortOrder("0");
    }
  }, [isOpen, scopeOptions]);

  const handleCreate = async () => {
    if (!activity) {
      toast.error("Pick an activity");
      return;
    }
    if (!name.trim()) {
      toast.error("Enter a name");
      return;
    }
    if (scope === "team" && !teamId) {
      toast.error("Pick a team for team-scoped subcategories");
      return;
    }
    try {
      await createSubcategory({
        activity,
        name: name.trim(),
        scope,
        teamId: scope === "team" ? parseInt(teamId, 10) : undefined,
        requiresProject,
        allowEventFields,
        sortOrder: parseInt(sortOrder, 10) || 0,
      });
      toast.success(`Created "${name.trim()}"`);
      onClose();
      onCreated?.();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Failed to create subcategory",
      );
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add Subcategory"
      description="Create a tier-2 subcategory under an existing activity."
    >
      <div className="space-y-3">
        <Select
          label="Activity"
          value={activity}
          onChange={setActivity}
          options={[
            { value: "", label: "Select activity" },
            ...TOPIC_OPTIONS.map((t) => ({ value: t.value, label: t.label })),
          ]}
        />
        <Input
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Daily Standup"
        />
        {name && (
          <p className="text-xs text-muted-foreground">
            Slug: <code>{slugifyName(name)}</code>
          </p>
        )}
        <Select
          label="Scope"
          value={scope}
          onChange={(v) => setScope(v as SubcategoryScope)}
          options={scopeOptions}
        />
        {scope === "team" && (
          <Select
            label="Team"
            value={teamId}
            onChange={setTeamId}
            options={[
              { value: "", label: "Select team" },
              ...teams.map((t) => ({ value: String(t.id), label: t.name })),
            ]}
          />
        )}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={requiresProject}
            onChange={(e) => setRequiresProject(e.target.checked)}
          />
          Requires project — clock-in form forces a project pick
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={allowEventFields}
            onChange={(e) => setAllowEventFields(e.target.checked)}
          />
          Allow event fields — show # Retained / # New Participants inputs
        </label>
        <Input
          label="Sort order"
          type="number"
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Lower sort-order numbers appear first in the dropdown.
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={creating}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={creating}>
            {creating ? "Creating…" : "Create"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
