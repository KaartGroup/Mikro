"use client";

import { useState, useEffect } from "react";
import { Modal, Button, useToastActions } from "@/components/ui";
import { useRequestNewTimeEntry, useUserProjects } from "@/hooks/useApi";

interface NewEntryRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmitted?: () => void;
}

export function NewEntryRequestModal({
  isOpen,
  onClose,
  onSubmitted,
}: NewEntryRequestModalProps) {
  const toast = useToastActions();
  const { mutate: requestNewEntry, loading: submitting } = useRequestNewTimeEntry();
  const { data: projectsData } = useUserProjects(isOpen);

  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [durationMinutes, setDurationMinutes] = useState<number | "">(60);
  const [projectId, setProjectId] = useState<string>("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (isOpen) {
      setDate("");
      setStartTime("");
      setDurationMinutes(60);
      setProjectId("");
      setReason("");
    }
  }, [isOpen]);

  const projects = projectsData?.user_projects ?? [];

  const canSubmit =
    date.trim() !== "" &&
    startTime.trim() !== "" &&
    typeof durationMinutes === "number" &&
    durationMinutes >= 1 &&
    durationMinutes <= 120 &&
    reason.trim() !== "";

  const handleSubmit = async () => {
    if (!canSubmit) return;

    try {
      const localDT = new Date(`${date}T${startTime}`);
      const clockIn = localDT.toISOString();
      const clockOut = new Date(
        localDT.getTime() + (durationMinutes as number) * 60_000,
      ).toISOString();

      await requestNewEntry({
        clockIn,
        clockOut,
        projectId: projectId ? Number(projectId) : null,
        reason: reason.trim(),
      });
      toast.success("New entry request submitted. An admin will review it.");
      onClose();
      onSubmitted?.();
    } catch {
      toast.error("Failed to submit request");
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Request New Time Entry"
      description="Submit a request to add a missing work session. An admin will review and approve the entry. Sessions are capped at 2 hours."
      footer={
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            isLoading={submitting}
          >
            Submit Request
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground">Date</label>
            <input
              type="date"
              className="h-10 rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              max={new Date().toLocaleDateString("en-CA")}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground">Start time</label>
            <input
              type="time"
              className="h-10 rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-foreground">
            Duration (minutes, max 120)
          </label>
          <input
            type="number"
            min={1}
            max={120}
            className="h-10 rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            value={durationMinutes}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "") {
                setDurationMinutes("");
                return;
              }
              const n = Number(v);
              setDurationMinutes(isNaN(n) ? "" : Math.min(120, Math.max(1, n)));
            }}
          />
          {typeof durationMinutes === "number" && durationMinutes > 120 && (
            <p className="text-xs text-destructive">Maximum is 120 minutes (2 hours).</p>
          )}
        </div>

        {projects.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground">
              Project <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <select
              className="h-10 rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">— No project —</option>
              {projects.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-foreground">
            Reason / explanation
          </label>
          <textarea
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            rows={3}
            placeholder="e.g., Forgot to clock in that morning — worked from 9 AM to 10:30 AM on project X"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}
