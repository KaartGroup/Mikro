"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { NotesButton } from "./NotesButton";
import { sortProjectsAlphabetical } from "@/lib/sortProjects";
import { formatDurationHM, resolveCategoryKey } from "@/lib/timeTracking";
import {
  useAdminActiveSessions,
  useApiMutation,
  useForceClockOut,
  useVoidTimeEntry,
  useEditTimeEntry,
  useAdminAddTimeEntry,
  usePurgeTimeEntries,
  useUsersList,
  useOrgProjects,
} from "@/hooks";
import type { TimeEntry, TimeTrackingHistoryResponse } from "@/types";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatLiveDuration(clockIn: string): string {
  const now = new Date();
  const start = new Date(clockIn);
  const seconds = Math.floor((now.getTime() - start.getTime()) / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

/** Convert ISO string to datetime-local input value (local timezone) */
function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

/** Convert datetime-local input value back to ISO string */
function fromDatetimeLocal(value: string): string {
  return new Date(value).toISOString();
}

const CATEGORY_OPTIONS = ["mapping", "validation", "review", "training", "other"];

export interface AdminTimeManagementProps {
  /** Restrict every query in this widget to members of this team. */
  teamId?: number | null;
}

export function AdminTimeManagement({ teamId = null }: AdminTimeManagementProps = {}) {
  const [activeTab, setActiveTab] = useState<"active" | "history">("active");
  const [liveDurations, setLiveDurations] = useState<Record<number, string>>({});
  const [search, setSearch] = useState("");
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
  const [editClockIn, setEditClockIn] = useState("");
  const [editClockOut, setEditClockOut] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  // Add Entry modal state
  const [showAddEntry, setShowAddEntry] = useState(false);
  const [addUserId, setAddUserId] = useState("");
  const [addProjectId, setAddProjectId] = useState("");
  const [addCategory, setAddCategory] = useState("mapping");
  const [addClockIn, setAddClockIn] = useState("");
  const [addClockOut, setAddClockOut] = useState("");
  const [addNotes, setAddNotes] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const { data: activeSessions, loading: sessionsLoading, refetch: refetchSessions } = useAdminActiveSessions();
  const { mutate: fetchHistoryPage } = useApiMutation<TimeTrackingHistoryResponse>("/timetracking/history");
  const [allHistoryEntries, setAllHistoryEntries] = useState<TimeEntry[]>([]);
  const [historyNextCursor, setHistoryNextCursor] = useState<{ clockIn: string; id: number } | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const { mutate: forceClockOut, loading: forcingClockOut } = useForceClockOut();
  const { mutate: voidEntry, loading: voiding } = useVoidTimeEntry();
  const { mutate: editEntry, loading: editing } = useEditTimeEntry();
  const [showPurgeConfirm, setShowPurgeConfirm] = useState(false);

  const { mutate: addTimeEntry, loading: addingEntry } = useAdminAddTimeEntry();
  const { mutate: purgeEntries, loading: purging } = usePurgeTimeEntries();
  const { data: usersData } = useUsersList();
  const { data: projectsData } = useOrgProjects();

  const users = usersData?.users || [];
  const projects = projectsData?.org_active_projects || [];

  const sessions = activeSessions?.sessions || [];

  const refreshHistory = useCallback(async (params: Record<string, unknown> = {}) => {
    setHistoryLoading(true);
    try {
      const result = await fetchHistoryPage(params);
      setAllHistoryEntries(result?.entries ?? []);
      setHistoryNextCursor(result?.nextCursor ?? null);
    } catch { /* errors surfaced by mutation */ }
    finally { setHistoryLoading(false); }
  }, [fetchHistoryPage]);

  const loadMoreHistory = useCallback(async () => {
    if (!historyNextCursor) return;
    setLoadingMore(true);
    try {
      const params: Record<string, unknown> = teamId ? { teamId } : {};
      params.cursor = historyNextCursor;
      const result = await fetchHistoryPage(params);
      setAllHistoryEntries((prev) => [...prev, ...(result?.entries ?? [])]);
      setHistoryNextCursor(result?.nextCursor ?? null);
    } catch { /* errors surfaced by mutation */ }
    finally { setLoadingMore(false); }
  }, [fetchHistoryPage, historyNextCursor, teamId]);

  // Search matches userName / projectName / category. One-field design so
  // the widget stays visually compact on the dashboard; the /admin/time
  // page has the full FilterBar for finer-grained filtering.
  const filteredSessions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) =>
      (s.userName || "").toLowerCase().includes(q) ||
      (s.projectName || "").toLowerCase().includes(q) ||
      (s.category || "").toLowerCase().includes(q)
    );
  }, [sessions, search]);

  const filteredHistory = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allHistoryEntries;
    return allHistoryEntries.filter((e) =>
      (e.userName || "").toLowerCase().includes(q) ||
      (e.projectName || "").toLowerCase().includes(q) ||
      (e.category || "").toLowerCase().includes(q)
    );
  }, [allHistoryEntries, search]);

  // Refetch when sidebar clock or time widget triggers a state change.
  // The teamId param is passed through so the widget stays in lock-step
  // with the dashboard's Team scope selector.
  useEffect(() => {
    const handler = () => {
      setTimeout(() => {
        refetchSessions(teamId ? { teamId } : undefined);
        refreshHistory(teamId ? { teamId } : {});
      }, 500);
    };
    window.addEventListener("clock-state-changed", handler);
    return () => window.removeEventListener("clock-state-changed", handler);
  }, [refetchSessions, refreshHistory, teamId]);

  // Re-fetch (and reset cursor) whenever the team scope changes.
  useEffect(() => {
    refetchSessions(teamId ? { teamId } : undefined);
    refreshHistory(teamId ? { teamId } : {});
  }, [teamId, refetchSessions, refreshHistory]);

  // Live duration ticker for active sessions
  useEffect(() => {
    if (activeTab !== "active" || sessions.length === 0) return;

    const interval = setInterval(() => {
      const durations: Record<number, string> = {};
      for (const session of sessions) {
        if (session.clockIn) {
          durations[session.id] = formatLiveDuration(session.clockIn);
        }
      }
      setLiveDurations(durations);
    }, 1000);

    return () => clearInterval(interval);
  }, [activeTab, sessions]);

  const handleForceClockOut = async (id: number) => {
    try {
      await forceClockOut({ session_id: id });
      await refetchSessions();
      await refreshHistory(teamId ? { teamId } : {});
    } catch (err) {
      console.error("Force clock out failed:", err);
    }
  };

  const handleVoidEntry = async (id: number) => {
    try {
      await voidEntry({ entry_id: id });
      await refreshHistory(teamId ? { teamId } : {});
    } catch (err) {
      console.error("Void entry failed:", err);
    }
  };

  const handleOpenEdit = (entry: TimeEntry) => {
    setEditingEntry(entry);
    setEditClockIn(entry.clockIn ? toDatetimeLocal(entry.clockIn) : "");
    setEditClockOut(entry.clockOut ? toDatetimeLocal(entry.clockOut) : "");
    setEditCategory(resolveCategoryKey(entry.category) ?? "editing");
    setEditError(null);
  };

  const handleSaveEdit = async () => {
    if (!editingEntry) return;
    setEditError(null);

    if (!editClockIn) {
      setEditError("Clock in time is required");
      return;
    }

    try {
      await editEntry({
        entry_id: editingEntry.id,
        clockIn: fromDatetimeLocal(editClockIn),
        clockOut: editClockOut ? fromDatetimeLocal(editClockOut) : undefined,
        category: editCategory,
      });
      setEditingEntry(null);
      await refreshHistory(teamId ? { teamId } : {});
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to update entry");
    }
  };

  const handleOpenAddEntry = () => {
    setAddUserId("");
    setAddProjectId("");
    setAddCategory("mapping");
    setAddClockIn("");
    setAddClockOut("");
    setAddNotes("");
    setAddError(null);
    setShowAddEntry(true);
  };

  const handleSaveAddEntry = async () => {
    setAddError(null);
    if (!addUserId) { setAddError("User is required"); return; }
    if (!addClockIn) { setAddError("Clock in time is required"); return; }
    if (!addClockOut) { setAddError("Clock out time is required"); return; }

    try {
      await addTimeEntry({
        userId: addUserId,
        projectId: addProjectId ? Number(addProjectId) : undefined,
        category: addCategory,
        clockIn: fromDatetimeLocal(addClockIn),
        clockOut: fromDatetimeLocal(addClockOut),
        notes: addNotes,
      });
      setShowAddEntry(false);
      await refreshHistory(teamId ? { teamId } : {});
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to create entry");
    }
  };

  const handlePurgeEntries = async () => {
    try {
      await purgeEntries({});
      setShowPurgeConfirm(false);
      await refetchSessions();
      await refreshHistory(teamId ? { teamId } : {});
    } catch (err) {
      console.error("Purge failed:", err);
    }
  };

  const handleFillTestEntry = () => {
    const now = new Date();
    const eightHoursAgo = new Date(now.getTime() - 8 * 60 * 60 * 1000);
    setAddClockIn(toDatetimeLocal(eightHoursAgo.toISOString()));
    setAddClockOut(toDatetimeLocal(now.toISOString()));
    setAddNotes("[DEV TEST ENTRY]");
  };

  return (
    <div className="h-full">
      <Card className="h-full">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <svg
                className="w-5 h-5 text-muted-foreground"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              Time Management
            </CardTitle>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowPurgeConfirm(true)}
                className="px-2 py-1 text-xs text-red-600 dark:text-red-400 border border-dashed border-red-400 rounded-md hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
              >
                Purge All
              </button>
              <div className="flex gap-1 rounded-lg bg-secondary p-1">
                <button
                  onClick={() => setActiveTab("active")}
                  className={`px-3 py-1 text-sm rounded-md transition-colors ${
                    activeTab === "active"
                      ? "bg-background text-foreground shadow font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Active Sessions ({search.trim() ? `${filteredSessions.length}/${sessions.length}` : sessions.length})
                </button>
                <button
                  onClick={() => setActiveTab("history")}
                  className={`px-3 py-1 text-sm rounded-md transition-colors ${
                    activeTab === "history"
                      ? "bg-background text-foreground shadow font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  History
                </button>
              </div>
              <Button variant="outline" size="sm" onClick={handleOpenAddEntry}>
                + Add Entry
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Single-field search matching user / project / category —
              applies to both the Active and History tabs. */}
          <div className="mb-3 flex items-center gap-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search user, project, or category..."
              className="w-full sm:max-w-sm rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              aria-label="Search active sessions and history"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
              >
                Clear
              </button>
            )}
          </div>
          {activeTab === "active" ? (
            sessionsLoading ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Loading active sessions...
              </p>
            ) : sessions.length > 0 ? (
              <div className="overflow-auto max-h-[70vh]">
                <table className="w-full text-sm" style={{ minWidth: 500 }}>
                  <thead className="sticky top-0 bg-background z-10">
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-3 font-medium text-muted-foreground">User</th>
                      <th className="text-left py-2 px-3 font-medium text-muted-foreground">Project</th>
                      <th className="text-left py-2 px-3 font-medium text-muted-foreground">Category</th>
                      <th className="text-left py-2 px-3 font-medium text-muted-foreground">Clocked In</th>
                      <th className="text-left py-2 px-3 font-medium text-muted-foreground">Duration</th>
                      <th className="text-left py-2 px-3 font-medium text-muted-foreground">Notes</th>
                      <th className="text-left py-2 px-3 font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSessions.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-4 px-3 text-center text-sm text-muted-foreground">
                          No active sessions match &ldquo;{search}&rdquo;.
                        </td>
                      </tr>
                    ) : filteredSessions.map((entry) => (
                      <tr key={entry.id} className="border-b border-border last:border-0">
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-2">
                            <span className="relative flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                            </span>
                            <span className="font-medium">{entry.userName}</span>
                          </div>
                        </td>
                        <td className="py-3 px-3">{entry.projectName}</td>
                        <td className="py-3 px-3">
                          <Badge variant="secondary">{entry.category}</Badge>
                        </td>
                        <td className="py-3 px-3 text-muted-foreground">
                          {entry.clockIn ? formatDateTime(entry.clockIn) : "—"}
                        </td>
                        <td className="py-3 px-3">
                          <span className="font-mono text-green-600 font-medium">
                            {liveDurations[entry.id] || entry.duration || "—"}
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          <NotesButton
                            notes={entry.userNotes}
                            editable={false}
                            size="xs"
                            title={`Note from ${entry.userName}`}
                          />
                        </td>
                        <td className="py-3 px-3">
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleForceClockOut(entry.id)}
                            disabled={forcingClockOut}
                            className="whitespace-nowrap"
                          >
                            Clock Out
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No users are currently clocked in.
              </p>
            )
          ) : (
            historyLoading ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Loading history...
              </p>
            ) : allHistoryEntries.length > 0 ? (
              <div className="overflow-auto max-h-[70vh]">
                <table className="w-full text-sm" style={{ minWidth: 500 }}>
                  <thead className="sticky top-0 bg-background z-10">
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-3 font-medium text-muted-foreground">User</th>
                      <th className="text-left py-2 px-3 font-medium text-muted-foreground">Project</th>
                      <th className="text-left py-2 px-3 font-medium text-muted-foreground">Category</th>
                      <th className="text-left py-2 px-3 font-medium text-muted-foreground">Clock In</th>
                      <th className="text-left py-2 px-3 font-medium text-muted-foreground">Clock Out</th>
                      <th className="text-left py-2 px-3 font-medium text-muted-foreground">Duration</th>
                      <th className="text-left py-2 px-3 font-medium text-muted-foreground">Status</th>
                      <th className="text-left py-2 px-3 font-medium text-muted-foreground">Notes</th>
                      <th className="text-left py-2 px-3 font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredHistory.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-4 px-3 text-center text-sm text-muted-foreground">
                          No history entries match &ldquo;{search}&rdquo;.
                        </td>
                      </tr>
                    ) : filteredHistory.map((entry) => (
                      <tr
                        key={entry.id}
                        className={`border-b border-border last:border-0 ${
                          entry.status === "voided" ? "opacity-50" : ""
                        }`}
                      >
                        <td className="py-3 px-3 font-medium">{entry.userName}</td>
                        <td className="py-3 px-3">{entry.projectName}</td>
                        <td className="py-3 px-3">
                          <Badge variant="secondary">{entry.category}</Badge>
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
                            <Badge variant="destructive" className="ml-1 text-xs uppercase">Adjust</Badge>
                          )}
                          {entry.notes?.startsWith("[ADJUSTED]") && (
                            <Badge className="ml-1 text-xs uppercase bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">Adjusted</Badge>
                          )}
                        </td>
                        <td className="py-3 px-3">
                          <NotesButton
                            notes={entry.userNotes}
                            editable={false}
                            size="xs"
                            title={`Note from ${entry.userName}`}
                          />
                        </td>
                        <td className="py-3 px-3">
                          {entry.status !== "voided" && (
                            <div className="flex gap-1">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleOpenEdit(entry)}
                                disabled={editing}
                              >
                                Edit
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleVoidEntry(entry.id)}
                                disabled={voiding}
                                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                              >
                                Void
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {historyNextCursor && (
                  <div className="flex justify-center py-3 border-t border-border">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={loadMoreHistory}
                      isLoading={loadingMore}
                    >
                      Load more
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No time entries yet.
              </p>
            )
          )}
        </CardContent>
      </Card>

      {/* Edit Entry Modal */}
      <Modal
        isOpen={!!editingEntry}
        onClose={() => setEditingEntry(null)}
        title="Edit Time Entry"
        description={editingEntry ? `${editingEntry.userName} — ${editingEntry.projectName}` : ""}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditingEntry(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleSaveEdit}
              isLoading={editing}
            >
              Save Changes
            </Button>
          </>
        }
      >
        {editingEntry && (
          <div className="space-y-4">
            {editError && (
              <p className="text-sm text-red-600">{editError}</p>
            )}

            {editingEntry.notes?.startsWith("[ADJUSTMENT REQUESTED]") && (
              <div className="rounded-lg bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 p-3">
                <p className="text-xs font-medium text-yellow-800 dark:text-yellow-200 mb-1">
                  User Requested Adjustment
                </p>
                <p className="text-xs text-yellow-700 dark:text-yellow-300">
                  {editingEntry.notes.replace("[ADJUSTMENT REQUESTED] ", "")}
                </p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium mb-1">Clock In</label>
              <input
                type="datetime-local"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={editClockIn}
                onChange={(e) => setEditClockIn(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Clock Out</label>
              <input
                type="datetime-local"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={editClockOut}
                onChange={(e) => setEditClockOut(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Category</label>
              <select
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={editCategory}
                onChange={(e) => setEditCategory(e.target.value)}
              >
                {CATEGORY_OPTIONS.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat.charAt(0).toUpperCase() + cat.slice(1)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </Modal>

      {/* Add Entry Modal */}
      <Modal
        isOpen={showAddEntry}
        onClose={() => setShowAddEntry(false)}
        title="Add Time Entry"
        description="Manually create a time entry for a user"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowAddEntry(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleSaveAddEntry}
              isLoading={addingEntry}
            >
              Create Entry
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {addError && (
            <p className="text-sm text-red-600">{addError}</p>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">User</label>
            <select
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={addUserId}
              onChange={(e) => setAddUserId(e.target.value)}
            >
              <option value="">Select a user...</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Project (optional)</label>
            <select
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={addProjectId}
              onChange={(e) => setAddProjectId(e.target.value)}
            >
              <option value="">No project</option>
              {sortProjectsAlphabetical(projects).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Category</label>
            <select
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={addCategory}
              onChange={(e) => setAddCategory(e.target.value)}
            >
              {CATEGORY_OPTIONS.map((cat) => (
                <option key={cat} value={cat}>
                  {cat.charAt(0).toUpperCase() + cat.slice(1)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Clock In</label>
            <input
              type="datetime-local"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={addClockIn}
              onChange={(e) => setAddClockIn(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Clock Out</label>
            <input
              type="datetime-local"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={addClockOut}
              onChange={(e) => setAddClockOut(e.target.value)}
            />
          </div>

          <button
            type="button"
            onClick={handleFillTestEntry}
            className="w-full text-xs text-yellow-700 dark:text-yellow-400 border-2 border-dashed border-yellow-400 rounded-md py-1.5 hover:bg-yellow-50 dark:hover:bg-yellow-950/30 transition-colors bg-yellow-50 dark:bg-yellow-950/20"
          >
            <span className="font-bold uppercase tracking-wider">Test Data</span> — Fill 8-Hour Test Entry (now - 8h → now)
          </button>

          <div>
            <label className="block text-sm font-medium mb-1">Notes (optional)</label>
            <textarea
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              rows={2}
              value={addNotes}
              onChange={(e) => setAddNotes(e.target.value)}
              placeholder="Reason for manual entry..."
            />
          </div>
        </div>
      </Modal>

      {/* Purge Confirmation Modal */}
      <Modal
        isOpen={showPurgeConfirm}
        onClose={() => setShowPurgeConfirm(false)}
        title="Purge All Time Entries"
        description="This action cannot be undone"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowPurgeConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handlePurgeEntries}
              isLoading={purging}
            >
              Yes, Purge Everything
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="rounded-lg bg-secondary border border-border p-3">
            <p className="text-sm font-medium text-foreground">
              This will permanently delete ALL time tracking entries for your organization:
            </p>
            <ul className="mt-2 text-sm text-foreground list-disc list-inside space-y-1">
              <li>All active sessions will be removed</li>
              <li>All completed entries will be deleted</li>
              <li>All voided entries will be deleted</li>
            </ul>
          </div>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to proceed?
          </p>
        </div>
      </Modal>
    </div>
  );
}
