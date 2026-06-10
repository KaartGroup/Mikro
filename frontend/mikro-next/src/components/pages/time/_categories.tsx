"use client";

/**
 * Admin → Time → Categories tab
 *
 * Manage tier-2 subcategories for each pan-org activity. Visibility:
 *
 *   - super_admin: can create/manage global, org, or team subs.
 *   - admin:       org + team subs in their own org.
 *   - team_admin:  only team subs for teams they LEAD.
 *
 * The activity (tier-1) list itself stays a hardcoded enum (SSOT in
 * lib/timeTracking.ts) — this view only manages tier-2 rows.
 *
 * Originally lived at /admin/time-categories as its own page; folded
 * into /admin/time as a tab on 2026-05-19 so the sidebar stays lean
 * (one "Time" entry covers both sessions and the catalog).
 *
 * SSOT note: visibility/permission rules live on the backend
 * (TimeTracking.py `_can_manage_subcategory`). The frontend mirrors
 * the same scope choices in the form but the backend is authoritative
 * — it 403s on anything the user shouldn't be doing.
 */

import { useEffect, useMemo, useState, useCallback } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  Select,
  useToastActions,
} from "@/components/ui";
import { AddSubcategoryModal } from "@/components/modals/subcategory/AddSubcategoryModal";
import {
  useAdminFetchSubcategories,
  useUpdateSubcategory,
  useDeleteSubcategory,
  useCurrentUserRole,
  useFetchTeams,
} from "@/hooks";
import { TOPIC_OPTIONS } from "@/lib/timeTracking";
import type { Subcategory, SubcategoryScope } from "@/types";

const SCOPE_BADGE: Record<
  SubcategoryScope,
  "secondary" | "warning" | "destructive"
> = {
  global: "destructive",
  org: "warning",
  team: "secondary",
};

export function AdminTimeCategoriesView() {
  const { role } = useCurrentUserRole();
  const isSuper = role === "super_admin";
  const isOrgAdmin = role === "admin" || isSuper;
  const isTeamAdmin = role === "team_admin";
  const toast = useToastActions();

  const { mutate: fetchSubcategories, loading: loadingList } =
    useAdminFetchSubcategories();
  const { mutate: updateSubcategory, loading: updating } =
    useUpdateSubcategory();
  const { mutate: deleteSubcategory, loading: deleting } =
    useDeleteSubcategory();
  const { data: teamsData } = useFetchTeams();

  const [activityFilter, setActivityFilter] = useState<string>("");
  const [subs, setSubs] = useState<Subcategory[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetchSubcategories(
        activityFilter ? { activity: activityFilter } : {},
      );
      setSubs(res?.subcategories ?? []);
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Failed to load subcategories";
      toast.error(msg);
      setSubs([]);
    }
  }, [activityFilter, fetchSubcategories, toast]);

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityFilter]);

  const teams: { id: number; name: string }[] = useMemo(
    () =>
      (teamsData?.teams ?? []).map((t: { id: number; name: string }) => ({
        id: t.id,
        name: t.name,
      })),
    [teamsData],
  );

  // Scope options visible to the current role.
  const scopeOptions = useMemo(() => {
    const opts: { value: SubcategoryScope; label: string }[] = [];
    if (isSuper) opts.push({ value: "global", label: "Global (every org)" });
    if (isOrgAdmin) opts.push({ value: "org", label: "Org (your org)" });
    if (isOrgAdmin || isTeamAdmin) opts.push({ value: "team", label: "Team" });
    return opts;
  }, [isSuper, isOrgAdmin, isTeamAdmin]);

  const handleToggleActive = async (sub: Subcategory) => {
    try {
      if (sub.isActive) {
        await deleteSubcategory({ id: sub.id });
        toast.success(`Disabled "${sub.name}"`);
      } else {
        await updateSubcategory({ id: sub.id, isActive: true });
        toast.success(`Re-enabled "${sub.name}"`);
      }
      reload();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Failed to update subcategory",
      );
    }
  };

  const handleSaveEdit = async (
    sub: Subcategory,
    patch: Partial<{
      name: string;
      sortOrder: number;
      requiresProject: boolean;
      allowEventFields: boolean;
    }>,
  ) => {
    try {
      await updateSubcategory({ id: sub.id, ...patch });
      toast.success(`Updated "${sub.name}"`);
      setEditingId(null);
      reload();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Failed to update subcategory",
      );
    }
  };

  // Group by activity for display.
  const grouped = useMemo(() => {
    const m: Record<string, Subcategory[]> = {};
    for (const s of subs) {
      (m[s.activity] = m[s.activity] || []).push(s);
    }
    for (const k of Object.keys(m)) {
      m[k].sort((a, b) =>
        a.sortOrder !== b.sortOrder
          ? a.sortOrder - b.sortOrder
          : a.name.localeCompare(b.name),
      );
    }
    return m;
  }, [subs]);

  const activitiesForFilter = useMemo(
    () => [
      { value: "", label: "All activities" },
      ...TOPIC_OPTIONS.map((t) => ({ value: t.value, label: t.label })),
    ],
    [],
  );

  return (
    <div className="space-y-6">
      {/* Inline header — page title "Time Management" already lives in the
          parent /admin/time page; this view just gets a one-liner that
          explains the catalog plus the +Add Subcategory action. */}
      <div className="flex items-start justify-between gap-3">
        <p className="text-muted-foreground max-w-2xl">
          Configure the tier-2 subcategories users pick when clocking in.
          Activities (Editing, Validating, Meeting, …) are fixed; the
          subcategories under each one live here and apply per scope.
        </p>
        <Button onClick={() => setShowCreate(true)}>
          + Add Subcategory
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Filter
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-w-xs">
            <Select
              label="Activity"
              value={activityFilter}
              onChange={setActivityFilter}
              options={activitiesForFilter}
            />
          </div>
        </CardContent>
      </Card>

      {loadingList && subs.length === 0 && (
        <p className="text-sm text-muted-foreground">Loading subcategories…</p>
      )}
      {!loadingList && subs.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No subcategories yet for this filter. Click{" "}
            <strong>+ Add Subcategory</strong> to create one.
          </CardContent>
        </Card>
      )}

      {Object.keys(grouped)
        .sort()
        .map((activity) => (
          <Card key={activity}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base capitalize">
                {TOPIC_OPTIONS.find((t) => t.value === activity)?.label ||
                  activity}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-2 font-medium text-muted-foreground">
                        Name
                      </th>
                      <th className="text-left py-2 px-2 font-medium text-muted-foreground">
                        Scope
                      </th>
                      <th className="text-left py-2 px-2 font-medium text-muted-foreground">
                        Slug
                      </th>
                      <th className="text-left py-2 px-2 font-medium text-muted-foreground">
                        Sort
                      </th>
                      <th className="text-left py-2 px-2 font-medium text-muted-foreground">
                        Project required
                      </th>
                      <th className="text-left py-2 px-2 font-medium text-muted-foreground">
                        Event fields
                      </th>
                      <th className="text-left py-2 px-2 font-medium text-muted-foreground">
                        Active
                      </th>
                      <th className="text-left py-2 px-2 font-medium text-muted-foreground">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {grouped[activity].map((sub) => {
                      const isEditing = editingId === sub.id;
                      return (
                        <SubRow
                          key={sub.id}
                          sub={sub}
                          isEditing={isEditing}
                          saving={updating}
                          deleting={deleting}
                          teams={teams}
                          onStartEdit={() => setEditingId(sub.id)}
                          onCancelEdit={() => setEditingId(null)}
                          onSave={(patch) => handleSaveEdit(sub, patch)}
                          onToggleActive={() => handleToggleActive(sub)}
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ))}

      <AddSubcategoryModal
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        scopeOptions={scopeOptions}
        teams={teams}
        onCreated={reload}
      />
    </div>
  );
}

// ─── Row component ──────────────────────────────────────────────

interface SubRowProps {
  sub: Subcategory;
  isEditing: boolean;
  saving: boolean;
  deleting: boolean;
  teams: { id: number; name: string }[];
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: (patch: {
    name?: string;
    sortOrder?: number;
    requiresProject?: boolean;
    allowEventFields?: boolean;
  }) => void;
  onToggleActive: () => void;
}

function SubRow({
  sub,
  isEditing,
  saving,
  deleting,
  teams,
  onStartEdit,
  onCancelEdit,
  onSave,
  onToggleActive,
}: SubRowProps) {
  const [name, setName] = useState(sub.name);
  const [sortOrder, setSortOrder] = useState(String(sub.sortOrder));
  const [requiresProject, setRequiresProject] = useState(sub.requiresProject);
  const [allowEventFields, setAllowEventFields] = useState(
    sub.allowEventFields,
  );

  useEffect(() => {
    if (!isEditing) {
      setName(sub.name);
      setSortOrder(String(sub.sortOrder));
      setRequiresProject(sub.requiresProject);
      setAllowEventFields(sub.allowEventFields);
    }
  }, [isEditing, sub]);

  const teamLabel = sub.teamId
    ? (teams.find((t) => t.id === sub.teamId)?.name ?? `Team #${sub.teamId}`)
    : null;

  if (isEditing) {
    return (
      <tr className="border-b border-border bg-muted/30">
        <td className="py-2 px-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
          />
        </td>
        <td className="py-2 px-2 text-xs text-muted-foreground">
          <Badge variant={SCOPE_BADGE[sub.scope]}>{sub.scope}</Badge>
          {teamLabel && <span className="ml-2">{teamLabel}</span>}
        </td>
        <td className="py-2 px-2 text-xs text-muted-foreground">
          <code>{sub.slug}</code>
        </td>
        <td className="py-2 px-2">
          <input
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            className="w-16 rounded border border-border bg-background px-2 py-1 text-sm"
          />
        </td>
        <td className="py-2 px-2">
          <input
            type="checkbox"
            checked={requiresProject}
            onChange={(e) => setRequiresProject(e.target.checked)}
          />
        </td>
        <td className="py-2 px-2">
          <input
            type="checkbox"
            checked={allowEventFields}
            onChange={(e) => setAllowEventFields(e.target.checked)}
          />
        </td>
        <td className="py-2 px-2">
          <Badge variant={sub.isActive ? "success" : "secondary"}>
            {sub.isActive ? "Active" : "Disabled"}
          </Badge>
        </td>
        <td className="py-2 px-2 space-x-2">
          <Button
            size="sm"
            onClick={() =>
              onSave({
                name: name.trim() || sub.name,
                sortOrder: parseInt(sortOrder, 10) || 0,
                requiresProject,
                allowEventFields,
              })
            }
            disabled={saving}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onCancelEdit}
            disabled={saving}
          >
            Cancel
          </Button>
        </td>
      </tr>
    );
  }

  return (
    <tr
      className={`border-b border-border ${!sub.isActive ? "opacity-50" : ""}`}
    >
      <td className="py-2 px-2 font-medium">{sub.name}</td>
      <td className="py-2 px-2 text-xs">
        <Badge variant={SCOPE_BADGE[sub.scope]}>{sub.scope}</Badge>
        {teamLabel && (
          <span className="ml-2 text-muted-foreground">{teamLabel}</span>
        )}
      </td>
      <td className="py-2 px-2 text-xs text-muted-foreground">
        <code>{sub.slug}</code>
      </td>
      <td className="py-2 px-2 text-muted-foreground">{sub.sortOrder}</td>
      <td className="py-2 px-2">{sub.requiresProject ? "Yes" : "—"}</td>
      <td className="py-2 px-2">{sub.allowEventFields ? "Yes" : "—"}</td>
      <td className="py-2 px-2">
        <Badge variant={sub.isActive ? "success" : "secondary"}>
          {sub.isActive ? "Active" : "Disabled"}
        </Badge>
      </td>
      <td className="py-2 px-2 space-x-2">
        <Button size="sm" variant="outline" onClick={onStartEdit}>
          Edit
        </Button>
        <Button
          size="sm"
          variant={sub.isActive ? "destructive" : "outline"}
          onClick={onToggleActive}
          disabled={deleting}
        >
          {sub.isActive ? "Disable" : "Re-enable"}
        </Button>
      </td>
    </tr>
  );
}
