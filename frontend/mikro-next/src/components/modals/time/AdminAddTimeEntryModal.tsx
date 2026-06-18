"use client";

import { useState, useEffect } from "react";
import { Modal, Button, useToastActions } from "@/components/ui";
import {
  CATEGORY_LABELS,
  categoryLabel,
  fromDatetimeLocal,
  isValidTimeZone,
  timeZoneLabel,
} from "@/lib/timeTracking";
import { useAdminAddTimeEntry } from "@/hooks/useApi";
import {
  sortProjectsAlphabetical,
  projectDisplayName,
} from "@/lib/sortProjects";
import type { User, Project } from "@/types";

const CATEGORY_OPTIONS = Object.keys(CATEGORY_LABELS);

interface AdminAddTimeEntryModalProps {
  isOpen: boolean;
  onClose: () => void;
  users: User[];
  projects: Project[];
  /** Called after an entry is successfully created, e.g. to refresh the list. */
  onCreated?: () => void;
}

export function AdminAddTimeEntryModal({
  isOpen,
  onClose,
  users,
  projects,
  onCreated,
}: AdminAddTimeEntryModalProps) {
  const toast = useToastActions();
  const { mutate: addTimeEntry, loading } = useAdminAddTimeEntry();

  const [userId, setUserId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [category, setCategory] = useState("editing");
  const [clockIn, setClockIn] = useState("");
  const [clockOut, setClockOut] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  // The typed clock times are interpreted in the SELECTED user's timezone
  // (not the admin's browser zone), so a Manila mapper's manual entry lands
  // at the right UTC instant regardless of where the admin sits. Falls back
  // to browser-local until a user with a timezone is picked.
  const selectedUser = users.find((u) => u.id === userId);
  const tz = selectedUser?.timezone ?? undefined;
  const hasUserTz = isValidTimeZone(tz);

  // Reset all fields each time the modal opens.
  useEffect(() => {
    if (isOpen) {
      setUserId("");
      setProjectId("");
      setCategory("editing");
      setClockIn("");
      setClockOut("");
      setNotes("");
      setError(null);
    }
  }, [isOpen]);

  const handleSave = async () => {
    setError(null);

    if (!userId) {
      setError("User is required");
      return;
    }
    if (!clockIn) {
      setError("Clock in time is required");
      return;
    }
    if (!clockOut) {
      setError("Clock out time is required");
      return;
    }

    try {
      await addTimeEntry({
        userId,
        projectId: projectId ? Number(projectId) : undefined,
        category,
        clockIn: fromDatetimeLocal(clockIn, tz),
        clockOut: fromDatetimeLocal(clockOut, tz),
        notes,
      });
      toast.success("Time entry created");
      onClose();
      onCreated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create entry");
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add Time Entry"
      description="Manually create a time entry for a user"
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} isLoading={loading}>
            Create Entry
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <p className="text-sm text-red-600">{error}</p>}

        <div>
          <label className="block text-sm font-medium mb-1">User</label>
          <select
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          >
            <option value="">Select a user...</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            Project (optional)
          </label>
          <select
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">No project</option>
            {sortProjectsAlphabetical(projects).map((p) => (
              <option key={p.id} value={p.id}>
                {projectDisplayName(p)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Category</label>
          <select
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {CATEGORY_OPTIONS.map((cat) => (
              <option key={cat} value={cat}>
                {categoryLabel(cat)}
              </option>
            ))}
          </select>
        </div>

        {userId && (
          <p className="text-xs text-muted-foreground">
            {hasUserTz ? (
              <>
                Enter clock times in {selectedUser?.first_name || "the user"}
                &rsquo;s timezone &mdash;{" "}
                <span className="font-medium text-foreground">
                  {timeZoneLabel(tz)}
                </span>
              </>
            ) : (
              <>
                {selectedUser?.first_name || "This user"} has no timezone set
                &mdash; enter times in your local timezone
              </>
            )}
          </p>
        )}

        <div>
          <label className="block text-sm font-medium mb-1">Clock In</label>
          <input
            type="datetime-local"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            value={clockIn}
            onChange={(e) => setClockIn(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Clock Out</label>
          <input
            type="datetime-local"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            value={clockOut}
            onChange={(e) => setClockOut(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            Notes (optional)
          </label>
          <textarea
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Reason for manual entry..."
          />
        </div>
      </div>
    </Modal>
  );
}
