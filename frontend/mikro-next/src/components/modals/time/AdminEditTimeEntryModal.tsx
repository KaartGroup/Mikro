"use client";

import { useState, useEffect } from "react";
import { Modal, Button, useToastActions } from "@/components/ui";
import {
  CATEGORY_LABELS,
  categoryLabel,
  toDatetimeLocal,
  fromDatetimeLocal,
  resolveCategoryKey,
  isValidTimeZone,
  timeZoneLabel,
} from "@/lib/timeTracking";
import { useEditTimeEntry } from "@/hooks/useApi";
import type { TimeEntry } from "@/types";

const CATEGORY_OPTIONS = Object.keys(CATEGORY_LABELS);

interface AdminEditTimeEntryModalProps {
  entry: TimeEntry | null;
  onClose: () => void;
  /** Called after the entry is successfully saved, e.g. to refresh the list. */
  onSaved?: () => void;
}

export function AdminEditTimeEntryModal({
  entry,
  onClose,
  onSaved,
}: AdminEditTimeEntryModalProps) {
  const toast = useToastActions();
  const { mutate: editEntry, loading } = useEditTimeEntry();

  const [clockIn, setClockIn] = useState("");
  const [clockOut, setClockOut] = useState("");
  const [category, setCategory] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Clock times are rendered and re-interpreted in the entry owner's
  // timezone (not the admin's browser zone), so an admin in Denver editing
  // a Manila mapper's entry sees and edits Manila wall-clock times. Falls
  // back to browser-local when the user has no timezone set.
  const tz = entry?.timezone ?? undefined;
  const hasUserTz = isValidTimeZone(tz);

  // Seed / reset fields whenever a new entry is opened.
  useEffect(() => {
    if (!entry) return;
    setClockIn(entry.clockIn ? toDatetimeLocal(entry.clockIn, tz) : "");
    setClockOut(entry.clockOut ? toDatetimeLocal(entry.clockOut, tz) : "");
    setCategory(resolveCategoryKey(entry.category) ?? "editing");
    setError(null);
  }, [entry, tz]);

  const handleSave = async () => {
    if (!entry) return;
    setError(null);

    if (!clockIn) {
      setError("Clock in time is required");
      return;
    }

    try {
      await editEntry({
        entry_id: entry.id,
        clockIn: fromDatetimeLocal(clockIn, tz),
        clockOut: clockOut ? fromDatetimeLocal(clockOut, tz) : undefined,
        category,
      });
      toast.success("Time entry updated");
      // Tell PendingAdjustmentsStrip (and anyone else listening) to
      // re-fetch so a just-resolved adjustment disappears immediately.
      window.dispatchEvent(new Event("time-entry-updated"));
      onClose();
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update entry");
    }
  };

  return (
    <Modal
      isOpen={!!entry}
      onClose={onClose}
      title="Edit Time Entry"
      description={
        entry ? `${entry.userName} -- ${entry.projectName || "No project"}` : ""
      }
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} isLoading={loading}>
            Save Changes
          </Button>
        </>
      }
    >
      {entry && (
        <div className="space-y-4">
          {error && <p className="text-sm text-red-600">{error}</p>}

          {entry.notes?.startsWith("[ADJUSTMENT REQUESTED]") && (
            <div className="rounded-lg bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 p-3">
              <p className="text-xs font-medium text-yellow-800 dark:text-yellow-200 mb-1">
                User Requested Adjustment
              </p>
              <p className="text-xs text-yellow-700 dark:text-yellow-300">
                {entry.notes.replace("[ADJUSTMENT REQUESTED] ", "")}
              </p>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            {hasUserTz ? (
              <>
                Times shown in {entry.firstName || entry.userName}&rsquo;s
                timezone &mdash;{" "}
                <span className="font-medium text-foreground">
                  {timeZoneLabel(tz)}
                </span>
              </>
            ) : (
              <>
                {entry.firstName || entry.userName} has no timezone set &mdash;
                times shown in your local timezone
              </>
            )}
          </p>

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
        </div>
      )}
    </Modal>
  );
}
