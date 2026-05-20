"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { useMyTimeHistory, useRequestTimeAdjustment, useUpdateMyNotes } from "@/hooks";
import { NotesButton } from "./NotesButton";
import { formatDurationHM } from "@/lib/timeTracking";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function UserTimeHistory() {
  const [showFullHistory, setShowFullHistory] = useState(false);
  const [adjustmentEntryId, setAdjustmentEntryId] = useState<number | null>(null);
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [adjustmentSuccess, setAdjustmentSuccess] = useState<string | null>(null);

  const { data: historyData, loading: historyLoading, refetch: refetchHistory } = useMyTimeHistory();
  const { mutate: requestAdjustment, loading: submitting } = useRequestTimeAdjustment();
  const { mutate: updateMyNotes } = useUpdateMyNotes();

  const handleSaveNotes = async (entryId: number, value: string | null) => {
    await updateMyNotes({ entry_id: entryId, userNotes: value });
    await refetchHistory();
  };

  const entries = historyData?.entries || [];
  const recentEntries = entries.slice(0, 5);

  const handleRequestAdjustment = async () => {
    if (!adjustmentEntryId || !adjustmentReason.trim()) return;

    try {
      await requestAdjustment({
        entry_id: adjustmentEntryId,
        reason: adjustmentReason.trim(),
      });
      setAdjustmentSuccess("Adjustment request submitted. An admin will review it.");
      setAdjustmentEntryId(null);
      setAdjustmentReason("");
      await refetchHistory();
      setTimeout(() => setAdjustmentSuccess(null), 4000);
    } catch {
      // error is set by the hook
    }
  };

  // Loading state
  if (historyLoading) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading history...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {/* Compact dashboard view */}
      <Card className="h-full">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <svg
                className="w-4 h-4 text-muted-foreground"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                />
              </svg>
              Recent Activity
            </CardTitle>
            {entries.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowFullHistory(true)}
              >
                View All ({entries.length})
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {recentEntries.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: 500 }}>
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-1.5 px-2 font-medium text-muted-foreground">Date</th>
                    <th className="text-left py-1.5 px-2 font-medium text-muted-foreground">Project</th>
                    <th className="text-left py-1.5 px-2 font-medium text-muted-foreground">Category</th>
                    <th className="text-left py-1.5 px-2 font-medium text-muted-foreground">Subcategory</th>
                    <th className="text-left py-1.5 px-2 font-medium text-muted-foreground">Duration</th>
                    <th className="text-left py-1.5 px-2 font-medium text-muted-foreground">Status</th>
                    <th className="text-left py-1.5 px-2 font-medium text-muted-foreground">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {recentEntries.map((entry) => (
                    <tr
                      key={entry.id}
                      className={`border-b border-border last:border-0 ${
                        entry.status === "voided" ? "opacity-50" : ""
                      }`}
                    >
                      <td className="py-2 px-2 text-muted-foreground">
                        {entry.clockIn ? formatDateShort(entry.clockIn) : "—"}
                      </td>
                      <td className="py-2 px-2">{entry.projectName}</td>
                      <td className="py-2 px-2">
                        <Badge variant="secondary">{entry.category}</Badge>
                      </td>
                      <td className="py-2 px-2 text-muted-foreground">
                        {entry.subcategoryName || "—"}
                      </td>
                      <td className="py-2 px-2">
                        <span className="font-mono">{formatDurationHM(entry.durationSeconds)}</span>
                      </td>
                      <td className="py-2 px-2">
                        <Badge
                          variant={
                            entry.status === "completed"
                              ? "success"
                              : entry.status === "voided"
                              ? "destructive"
                              : "warning"
                          }
                        >
                          {entry.status}
                        </Badge>
                      </td>
                      <td className="py-2 px-2">
                        <NotesButton
                          notes={entry.userNotes}
                          editable={entry.status !== "voided"}
                          onSave={(v) => handleSaveNotes(entry.id, v)}
                          size="xs"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-2">
              No time entries yet. Clock in to start tracking your work.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Full history modal */}
      <Modal
        isOpen={showFullHistory}
        onClose={() => {
          setShowFullHistory(false);
          setAdjustmentEntryId(null);
          setAdjustmentReason("");
        }}
        title="Time History"
        description="Your complete time tracking history"
        size="xl"
      >
        {adjustmentSuccess && (
          <div className="mb-4 rounded-lg bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 p-3">
            <p className="text-sm text-green-700 dark:text-green-300">{adjustmentSuccess}</p>
          </div>
        )}

        {entries.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: 500 }}>
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-3 font-medium text-muted-foreground">Project</th>
                  <th className="text-left py-2 px-3 font-medium text-muted-foreground">Category</th>
                  <th className="text-left py-2 px-3 font-medium text-muted-foreground">Subcategory</th>
                  <th className="text-left py-2 px-3 font-medium text-muted-foreground">Clock In</th>
                  <th className="text-left py-2 px-3 font-medium text-muted-foreground">Clock Out</th>
                  <th className="text-left py-2 px-3 font-medium text-muted-foreground">Duration</th>
                  <th className="text-left py-2 px-3 font-medium text-muted-foreground">Status</th>
                  <th className="text-left py-2 px-3 font-medium text-muted-foreground">Notes</th>
                  <th className="text-left py-2 px-3 font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr
                    key={entry.id}
                    className={`border-b border-border last:border-0 ${
                      entry.status === "voided" ? "opacity-50" : ""
                    }`}
                  >
                    <td className="py-3 px-3">{entry.projectName}</td>
                    <td className="py-3 px-3">
                      <Badge variant="secondary">{entry.category}</Badge>
                    </td>
                    <td className="py-3 px-3 text-muted-foreground">
                      {entry.subcategoryName || "—"}
                    </td>
                    <td className="py-3 px-3 text-muted-foreground">
                      {entry.clockIn ? formatDateTime(entry.clockIn) : "—"}
                    </td>
                    <td className="py-3 px-3 text-muted-foreground">
                      {entry.clockOut ? formatDateTime(entry.clockOut) : "—"}
                    </td>
                    <td className="py-3 px-3">
                      <span className="font-mono">{formatDurationHM(entry.durationSeconds)}</span>
                    </td>
                    <td className="py-3 px-3">
                      <Badge
                        variant={
                          entry.status === "completed"
                            ? "success"
                            : entry.status === "voided"
                            ? "destructive"
                            : "warning"
                        }
                      >
                        {entry.status}
                      </Badge>
                      {entry.notes?.startsWith("[ADJUSTMENT REQUESTED]") && (
                        <Badge variant="warning" className="ml-1">adjustment pending</Badge>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      <NotesButton
                        notes={entry.userNotes}
                        editable={entry.status !== "voided"}
                        onSave={(v) => handleSaveNotes(entry.id, v)}
                        size="xs"
                      />
                    </td>
                    <td className="py-3 px-3">
                      {entry.status === "completed" && !entry.notes?.startsWith("[ADJUSTMENT REQUESTED]") && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="whitespace-nowrap"
                          onClick={() => {
                            setAdjustmentEntryId(entry.id);
                            setAdjustmentReason("");
                          }}
                        >
                          Request Adjustment
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No time entries yet.
          </p>
        )}

        {/* Adjustment request inline form */}
        {adjustmentEntryId && (
          <div className="mt-4 rounded-lg border border-border p-4">
            <h4 className="text-sm font-medium mb-2">
              Request Adjustment for Entry #{adjustmentEntryId}
            </h4>
            <p className="text-xs text-muted-foreground mb-3">
              Describe what needs to be corrected. An admin will review and edit the entry.
            </p>
            <textarea
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              rows={3}
              placeholder="e.g., Forgot to clock out — actual end time was 5:30 PM"
              value={adjustmentReason}
              onChange={(e) => setAdjustmentReason(e.target.value)}
            />
            <div className="flex gap-2 mt-2 justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setAdjustmentEntryId(null);
                  setAdjustmentReason("");
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleRequestAdjustment}
                disabled={!adjustmentReason.trim() || submitting}
                isLoading={submitting}
              >
                Submit Request
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
