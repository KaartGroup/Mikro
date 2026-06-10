"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  useCursorHistory,
  useRequestTimeAdjustment,
  useUpdateMyNotes,
} from "@/hooks";
import { NotesButton } from "./NotesButton";
import { formatDuration } from "@/lib/timeTracking";
import { formatDate } from "@/lib/utils";

const PAGE_SIZE = 10;

export function UserTimeHistory() {
  const [page, setPage] = useState(1);
  const [adjustmentEntryId, setAdjustmentEntryId] = useState<number | null>(
    null,
  );
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [adjustmentSuccess, setAdjustmentSuccess] = useState<string | null>(
    null,
  );

  const history = useCursorHistory("/timetracking/my_history");
  const { mutate: requestAdjustment, loading: submitting } =
    useRequestTimeAdjustment();
  const { mutate: updateMyNotes } = useUpdateMyNotes();

  useEffect(() => {
    history.fetchPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaveNotes = async (entryId: number, value: string | null) => {
    await updateMyNotes({ entry_id: entryId, userNotes: value });
    await history.fetchPage();
  };

  const handleRequestAdjustment = async () => {
    if (!adjustmentEntryId || !adjustmentReason.trim()) return;
    try {
      await requestAdjustment({
        entry_id: adjustmentEntryId,
        reason: adjustmentReason.trim(),
      });
      setAdjustmentSuccess(
        "Adjustment request submitted. An admin will review it.",
      );
      setAdjustmentEntryId(null);
      setAdjustmentReason("");
      await history.fetchPage();
      setTimeout(() => setAdjustmentSuccess(null), 4000);
    } catch {
      // error surfaced by hook
    }
  };

  const entries = history.entries;
  const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedEntries = entries.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );
  const isLastClientPage = safePage >= totalPages;
  const hasMoreServer = !!history.nextCursor;

  if (history.loading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Time Entry History</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading history...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Time Entry History</CardTitle>
          {entries.length > 0 && (
            <span className="text-sm text-muted-foreground">
              {entries.length} entries{hasMoreServer ? "+" : ""}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {adjustmentSuccess && (
          <div className="mb-4 rounded-lg bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 p-3">
            <p className="text-sm text-green-700 dark:text-green-300">
              {adjustmentSuccess}
            </p>
          </div>
        )}

        {entries.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: 500 }}>
                <thead className="bg-muted border-b border-border">
                  <tr>
                    <th className="text-left py-2 px-3 font-semibold text-muted-foreground">
                      Date
                    </th>
                    <th className="text-left py-2 px-3 font-semibold text-muted-foreground">
                      Project
                    </th>
                    <th className="text-left py-2 px-3 font-semibold text-muted-foreground">
                      Category
                    </th>
                    <th className="text-left py-2 px-3 font-semibold text-muted-foreground">
                      Duration
                    </th>
                    <th className="text-left py-2 px-3 font-semibold text-muted-foreground">
                      Status
                    </th>
                    <th className="text-left py-2 px-3 font-semibold text-muted-foreground">
                      Notes
                    </th>
                    <th className="text-left py-2 px-3 font-semibold text-muted-foreground">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-card">
                  {pagedEntries.map((entry) => (
                    <tr
                      key={entry.id}
                      className={entry.status === "voided" ? "opacity-50" : ""}
                    >
                      <td className="py-2 px-3 whitespace-nowrap text-muted-foreground">
                        {entry.clockIn ? formatDate(entry.clockIn) : "—"}
                      </td>
                      <td className="py-2 px-3">{entry.projectName || "—"}</td>
                      <td className="py-2 px-3">
                        <Badge variant="secondary">{entry.category}</Badge>
                      </td>
                      <td className="py-2 px-3 font-mono whitespace-nowrap">
                        {formatDuration(entry.durationSeconds)}
                      </td>
                      <td className="py-2 px-3">
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
                          <Badge variant="warning" className="ml-1">
                            adjustment pending
                          </Badge>
                        )}
                      </td>
                      <td className="py-2 px-3">
                        <NotesButton
                          notes={entry.userNotes}
                          editable={entry.status !== "voided"}
                          onSave={(v) => handleSaveNotes(entry.id, v)}
                          size="xs"
                        />
                      </td>
                      <td className="py-2 px-3">
                        {entry.status === "completed" &&
                          !entry.notes?.startsWith(
                            "[ADJUSTMENT REQUESTED]",
                          ) && (
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

            <div className="flex items-center justify-between mt-3 text-sm text-muted-foreground">
              <span>
                Showing {(safePage - 1) * PAGE_SIZE + 1}–
                {Math.min(safePage * PAGE_SIZE, entries.length)}
                {hasMoreServer ? "+" : ` of ${entries.length}`}
              </span>
              <div className="flex gap-2 items-center">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={safePage === 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <span className="px-2">
                  Page {safePage} of {totalPages}
                  {hasMoreServer ? "+" : ""}
                </span>
                {isLastClientPage && hasMoreServer ? (
                  <Button
                    variant="outline"
                    size="sm"
                    isLoading={history.loadingMore}
                    onClick={async () => {
                      await history.loadMore();
                      setPage((p) => p + 1);
                    }}
                  >
                    Next
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                )}
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground py-2">
            No time entries yet. Clock in to start tracking your work.
          </p>
        )}

        {adjustmentEntryId && (
          <div className="mt-4 rounded-lg border border-border p-4">
            <h4 className="text-sm font-medium mb-2">
              Request Adjustment for Entry #{adjustmentEntryId}
            </h4>
            <p className="text-xs text-muted-foreground mb-3">
              Describe what needs to be corrected. An admin will review and edit
              the entry.
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
      </CardContent>
    </Card>
  );
}
