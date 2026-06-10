"use client";

import { useState, useEffect } from "react";
import { Modal, Button } from "@/components/ui";
import {
  resolveCategoryKey,
  toDatetimeLocal,
  fromDatetimeLocal,
} from "@/lib/timeTracking";
import type { TimeEntry } from "@/types";

const TIME_CATEGORY_OPTIONS = [
  "mapping",
  "validation",
  "review",
  "training",
  "other",
];

interface TimeEntryEditModalProps {
  entry: TimeEntry | null;
  onClose: () => void;
  onSave: (data: {
    entry_id: number;
    clockIn: string;
    clockOut?: string;
    category: string;
  }) => Promise<void>;
  loading: boolean;
}

export function TimeEntryEditModal({
  entry,
  onClose,
  onSave,
  loading,
}: TimeEntryEditModalProps) {
  const [clockIn, setClockIn] = useState("");
  const [clockOut, setClockOut] = useState("");
  const [category, setCategory] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!entry) return;
    setClockIn(entry.clockIn ? toDatetimeLocal(entry.clockIn) : "");
    setClockOut(entry.clockOut ? toDatetimeLocal(entry.clockOut) : "");
    setCategory(resolveCategoryKey(entry.category) ?? "editing");
    setError(null);
  }, [entry]);

  const handleSave = async () => {
    if (!entry) return;
    setError(null);
    if (!clockIn) {
      setError("Clock in time is required");
      return;
    }
    try {
      await onSave({
        entry_id: entry.id,
        clockIn: fromDatetimeLocal(clockIn),
        clockOut: clockOut ? fromDatetimeLocal(clockOut) : undefined,
        category,
      });
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
        entry
          ? `${entry.userName} — ${entry.projectName || "No project"}`
          : ""
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
              {TIME_CATEGORY_OPTIONS.map((cat) => (
                <option key={cat} value={cat}>
                  {cat.charAt(0).toUpperCase() + cat.slice(1)}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </Modal>
  );
}
