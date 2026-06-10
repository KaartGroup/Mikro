"use client";

import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Modal,
  useToastActions,
  Val,
} from "@/components/ui";
import { Task } from "@/types";
import {
  formatNumber,
  formatCurrency,
  getProjectExternalUrl,
} from "@/lib/utils";

export default function AdminTasksPage() {
  const [externalValidations, setExternalValidations] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const ROWS_PER_PAGE = 20;
  const toast = useToastActions();

  useEffect(() => {
    fetchExternalValidations();
  }, []);

  const fetchExternalValidations = async () => {
    try {
      const response = await fetch("/backend/tasks/fetch_external_validations");
      if (response.ok) {
        const data = await response.json();
        setExternalValidations(data.validations || []);
      }
    } catch (error) {
      console.error("Failed to fetch external validations:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleValidateTask = async () => {
    if (!selectedTask) return;
    try {
      await fetch("/backend/tasks/update_task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_id: selectedTask, action: "Validate" }),
      });
      fetchExternalValidations();
    } catch (error) {
      console.error("Failed to validate task:", error);
    }
  };

  const handleInvalidateTask = async () => {
    if (!selectedTask) return;
    try {
      await fetch("/backend/tasks/update_task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_id: selectedTask, action: "Invalidate" }),
      });
      fetchExternalValidations();
    } catch (error) {
      console.error("Failed to invalidate task:", error);
    }
  };

  const handleSelectTask = (taskId: number) => {
    setSelectedTask(selectedTask === taskId ? null : taskId);
  };

  const goToSource = (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-kaart-orange" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">External Validations</h1>
        <div className="flex gap-2">
          <Button
            onClick={handleValidateTask}
            disabled={!selectedTask}
            className="bg-green-600 hover:bg-green-700"
          >
            Validate
          </Button>
          <Button
            onClick={handleInvalidateTask}
            disabled={!selectedTask}
            className="bg-blue-600 hover:bg-blue-700"
          >
            Invalidate
          </Button>
        </div>
      </div>

      {/* Tasks Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium">
                    Task ID
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-medium">
                    Project Name
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-medium">
                    Project ID
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-medium">
                    Mapped By
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-medium">
                    Validated By
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(() => {
                  const filtered = externalValidations;
                  const totalPages = Math.ceil(filtered.length / ROWS_PER_PAGE);
                  const paginated = filtered.slice(
                    (currentPage - 1) * ROWS_PER_PAGE,
                    currentPage * ROWS_PER_PAGE,
                  );
                  const showingStart =
                    filtered.length === 0
                      ? 0
                      : (currentPage - 1) * ROWS_PER_PAGE + 1;
                  const showingEnd = Math.min(
                    currentPage * ROWS_PER_PAGE,
                    filtered.length,
                  );
                  return (
                    <>
                      {paginated.map((task) => (
                        <tr
                          key={task.id}
                          onClick={() => handleSelectTask(task.id)}
                          onDoubleClick={() =>
                            task.project_id &&
                            goToSource(getProjectExternalUrl(task.project_id))
                          }
                          className={`cursor-pointer hover:bg-muted/50 transition-colors ${
                            selectedTask === task.id ? "bg-kaart-orange/10" : ""
                          }`}
                        >
                          <td className="px-4 py-3">{task.id}</td>
                          <td className="px-4 py-3 font-medium">
                            {task.project_name}
                          </td>
                          <td className="px-4 py-3">{task.project_id}</td>
                          <td className="px-4 py-3">
                            <Val fallback="-">{task.mapped_by}</Val>
                          </td>
                          <td className="px-4 py-3">
                            <Val fallback="-">{task.validated_by}</Val>
                          </td>
                        </tr>
                      ))}
                      {filtered.length === 0 && (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-4 py-8 text-center text-muted-foreground"
                          >
                            No external validations pending
                          </td>
                        </tr>
                      )}
                      {filtered.length > ROWS_PER_PAGE && (
                        <tr>
                          <td colSpan={5}>
                            <div className="flex items-center justify-between mt-4 px-2 py-3">
                              <span className="text-sm text-muted-foreground">
                                Showing {showingStart}–{showingEnd} of{" "}
                                {filtered.length}
                              </span>
                              <div className="flex items-center gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={currentPage === 1}
                                  onClick={() => setCurrentPage((p) => p - 1)}
                                >
                                  Previous
                                </Button>
                                <span className="text-sm text-muted-foreground">
                                  Page {currentPage} of {totalPages}
                                </span>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={currentPage >= totalPages}
                                  onClick={() => setCurrentPage((p) => p + 1)}
                                >
                                  Next
                                </Button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })()}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        Double-click a row to open the task in the Tasking Manager.
      </p>

    </div>
  );
}
