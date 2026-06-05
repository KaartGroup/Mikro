import { TimeEntryStatusBadge } from "@/components/atoms/TimeEntryStatusBadge";
import { TablePaginator } from "@/components/molecules/TablePaginator";
import { NotesButton } from "@/components/widgets/NotesButton";
import { formatDate, formatDateTime } from "@/lib/utils";
import { formatDuration } from "@/lib/timeTracking";
import type { TimeEntry } from "@/types";

const ROWS_PER_PAGE = 20;

interface TimeEntryTableProps {
  entries: TimeEntry[];
  loading: boolean;
  dateLabel: string;
  page: number;
  setPage: (updater: (p: number) => number) => void;
  onEdit: (entry: TimeEntry) => void;
  onVoid: (entry: TimeEntry) => void;
}

export function TimeEntryTable({
  entries,
  loading,
  dateLabel,
  page,
  setPage,
  onEdit,
  onVoid,
}: TimeEntryTableProps) {
  const paged = entries.slice(
    (page - 1) * ROWS_PER_PAGE,
    page * ROWS_PER_PAGE,
  );

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-kaart-orange" />
        Loading...
      </div>
    );
  }

  if (entries.length === 0) {
    return dateLabel ? (
      <p className="text-sm text-muted-foreground text-center py-4">
        No time entries found for this period.
      </p>
    ) : null;
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth: 500 }}>
          <thead className="bg-muted border-b border-border">
            <tr>
              <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                Date
              </th>
              <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                Project
              </th>
              <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                Category
              </th>
              <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                Clock In
              </th>
              <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                Clock Out
              </th>
              <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                Duration
              </th>
              <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                Status
              </th>
              <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                Notes
              </th>
              <th className="px-4 py-2 text-right font-semibold text-muted-foreground">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {paged.map((entry) => (
              <tr
                key={entry.id}
                className={entry.status === "voided" ? "opacity-50" : ""}
              >
                <td className="px-4 py-2">{formatDate(entry.clockIn)}</td>
                <td className="px-4 py-2">{entry.projectName || "-"}</td>
                <td className="px-4 py-2">{entry.category || "-"}</td>
                <td className="px-4 py-2">{formatDateTime(entry.clockIn)}</td>
                <td className="px-4 py-2">{formatDateTime(entry.clockOut)}</td>
                <td className="px-4 py-2 font-mono">
                  {formatDuration(entry.durationSeconds)}
                </td>
                <td className="px-4 py-2">
                  <TimeEntryStatusBadge
                    status={entry.status as "completed" | "active" | "voided"}
                  />
                </td>
                <td className="px-4 py-2">
                  <NotesButton
                    notes={entry.userNotes}
                    editable={false}
                    size="xs"
                    title="Note from this entry"
                  />
                </td>
                <td className="px-4 py-2 text-right">
                  {entry.status !== "voided" && (
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => onEdit(entry)}
                        className="px-2 py-1 text-xs font-medium rounded border border-border text-foreground hover:bg-muted transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => onVoid(entry)}
                        className="px-2 py-1 text-xs font-medium rounded border border-red-300 dark:border-red-800 text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                      >
                        Void
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {entries.length > ROWS_PER_PAGE && (
        <TablePaginator
          page={page}
          totalItems={entries.length}
          pageSize={ROWS_PER_PAGE}
          onPrev={() => setPage((p) => p - 1)}
          onNext={() => setPage((p) => p + 1)}
        />
      )}
    </>
  );
}
