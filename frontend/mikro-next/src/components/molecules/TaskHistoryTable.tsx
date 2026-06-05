import { TaskActionBadge } from "@/components/atoms/TaskActionBadge";
import { TablePaginator } from "@/components/molecules/TablePaginator";
import { Val } from "@/components/ui";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import type { TaskHistoryEntry } from "@/types";

const ROWS_PER_PAGE = 20;

interface TaskHistoryTableProps {
  taskHistory: TaskHistoryEntry[];
  loading: boolean;
  dateLabel: string;
  page: number;
  setPage: (updater: (p: number) => number) => void;
}

export function TaskHistoryTable({
  taskHistory,
  loading,
  dateLabel,
  page,
  setPage,
}: TaskHistoryTableProps) {
  const paged = taskHistory.slice(
    (page - 1) * ROWS_PER_PAGE,
    page * ROWS_PER_PAGE,
  );

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-kaart-orange" />
        Loading task history...
      </div>
    );
  }

  if (taskHistory.length === 0) {
    return dateLabel ? (
      <p className="text-sm text-muted-foreground text-center py-4">
        No task history for this period.
      </p>
    ) : null;
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth: 500 }}>
          <thead className="bg-muted border-b border-border">
            <tr>
              <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                Task
              </th>
              <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                Project
              </th>
              <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                Action
              </th>
              <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                Date
              </th>
              <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                Status
              </th>
              <th className="px-4 py-2 text-right font-semibold text-muted-foreground">
                Rate
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {paged.map((t, i) => (
              <tr key={`${t.taskId}-${t.action}-${i}`}>
                <td className="px-4 py-2 font-mono">#{t.taskId}</td>
                <td className="px-4 py-2">{t.projectName}</td>
                <td className="px-4 py-2">
                  <TaskActionBadge action={t.action} />
                </td>
                <td className="px-4 py-2 whitespace-nowrap">
                  {formatDateTime(t.date)}
                </td>
                <td className="px-4 py-2">{t.status}</td>
                <td className="px-4 py-2 text-right font-mono">
                  <Val>
                    {formatCurrency(t.mappingRate || t.validationRate)}
                  </Val>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {taskHistory.length > ROWS_PER_PAGE && (
        <TablePaginator
          page={page}
          totalItems={taskHistory.length}
          pageSize={ROWS_PER_PAGE}
          onPrev={() => setPage((p) => p - 1)}
          onNext={() => setPage((p) => p + 1)}
        />
      )}
    </div>
  );
}
