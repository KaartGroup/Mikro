"use client";

import { useState, useEffect, useCallback } from "react";
import { useActiveTimeSession, useClockIn, useClockOut, useUserProjects, useFetchMyTimeHistory, useUpdateMyNotes, useDiscardActiveSession, useFetchSubcategories } from "@/hooks";
import {
  TOPIC_OPTIONS,
  requiresProjectFor,
  localDayStartIsoUtc,
  localDayEndIsoUtc,
  localWeekStartIsoUtc,
  formatDurationHM,
  formatLiveDuration,
} from "@/lib/timeTracking";
import type { Subcategory } from "@/types";
import { NotesButton } from "@/components/widgets/NotesButton";
import { sortProjectsRecentPinned } from "@/lib/sortProjects";
import { ConfirmDialog } from "@/components/ui/Modal";

const DISCARD_WINDOW_SECONDS = 300;

// Local helpers replaced by SSOT in @/lib/timeTracking:
// formatHoursMinutes → formatDurationHM (HH:MM)
// formatElapsedTime → formatLiveDuration (HH:MM:SS, live ticker only)

const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "4px 6px",
  fontSize: 11,
  borderRadius: 4,
  border: "1px solid var(--border)",
  backgroundColor: "var(--background)",
  color: "var(--foreground)",
  outline: "none",
};

export function SidebarClock() {
  const { data: activeSession, loading: sessionLoading, refetch } = useActiveTimeSession();
  const { mutate: clockIn, loading: clockingIn } = useClockIn();
  const { mutate: clockOut, loading: clockingOut } = useClockOut();
  const { mutate: updateMyNotes } = useUpdateMyNotes();
  const { mutate: discardActive, loading: discarding } = useDiscardActiveSession();
  const { data: projects } = useUserProjects();
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [discardError, setDiscardError] = useState<string | null>(null);

  const [isClockedIn, setIsClockedIn] = useState(false);
  const [timerStartedAt, setTimerStartedAt] = useState<number | null>(null);
  const [initialElapsed, setInitialElapsed] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [selectedTopic, setSelectedTopic] = useState("");
  const [selectedProject, setSelectedProject] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  // Tier-2 subcategory state. `subOptions` is the list visible to this
  // user for the chosen activity; `selectedSub` is the picked row.
  // Event-attendance inputs only appear when the picked sub has
  // allow_event_fields=true (per spec, Community -> Events). The
  // sidebar omits the event inputs by design (space-constrained UI);
  // they're available on TimeTrackingWidget and the admin add-entry
  // modal where there's room.
  const [selectedSub, setSelectedSub] = useState<Subcategory | null>(null);
  const [subOptions, setSubOptions] = useState<Subcategory[]>([]);
  const { mutate: fetchSubcategories } = useFetchSubcategories();
  const [pendingUserNotes, setPendingUserNotes] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [activeSessionUserNotes, setActiveSessionUserNotes] = useState<string | null>(null);
  const [todaySeconds, setTodaySeconds] = useState(0);
  const [weekSeconds, setWeekSeconds] = useState(0);
  const { mutate: fetchHistory } = useFetchMyTimeHistory();

  // Project ordering: most-recently-worked-on project pinned at the
  // top, the rest alphabetical underneath. Falls back to pure alpha
  // when no project has a last_worked_on yet. SSOT in @/lib/sortProjects.
  const projectList: { id: number; name: string; last_worked_on: string | null }[] =
    sortProjectsRecentPinned(
      projects?.user_projects?.map(
        (p: { id: number; name: string; last_worked_on?: string | null }) => ({
          id: p.id,
          name: p.name,
          last_worked_on: p.last_worked_on ?? null,
        }),
      ) ?? []
    );

  // Filter list by search query. If the current selection no longer
  // matches the filter, keep it visible so the dropdown still shows
  // what's selected — avoids confusing "where did my choice go?" state.
  const filteredProjectList = projectSearch.trim()
    ? projectList.filter((p) => {
        const q = projectSearch.toLowerCase();
        if (p.name.toLowerCase().includes(q)) return true;
        if (selectedProject && p.id.toString() === selectedProject) return true;
        return false;
      })
    : projectList;

  const needsProject = requiresProjectFor(selectedTopic, selectedSub);

  // Restore active session on mount / refetch
  useEffect(() => {
    if (activeSession?.session) {
      const serverElapsed = activeSession.session.elapsedSeconds ?? 0;
      setIsClockedIn(true);
      setInitialElapsed(serverElapsed);
      setTimerStartedAt(Date.now());
      setElapsedSeconds(serverElapsed);
      setShowConfirmation(false);
      setActiveSessionId(activeSession.session.id);
      setActiveSessionUserNotes(activeSession.session.userNotes ?? null);
    } else if (activeSession && !activeSession.session) {
      setIsClockedIn(false);
      setTimerStartedAt(null);
      setInitialElapsed(0);
      setElapsedSeconds(0);
      setActiveSessionId(null);
      setActiveSessionUserNotes(null);
    }
  }, [activeSession]);

  // Listen for sync events from other clock components
  useEffect(() => {
    const handler = () => {
      refetch().catch(() => {});
    };
    window.addEventListener("clock-state-changed", handler);
    return () => window.removeEventListener("clock-state-changed", handler);
  }, [refetch]);

  // Fetch today's + this week's completed hours (parallel)
  useEffect(() => {
    if (!isClockedIn) return;
    const fetchTotals = async () => {
      try {
        const dayEnd = localDayEndIsoUtc();
        const [todayResult, weekResult] = await Promise.all([
          fetchHistory({ startDate: localDayStartIsoUtc(), endDate: dayEnd, limit: 1000 }),
          fetchHistory({ startDate: localWeekStartIsoUtc(), endDate: dayEnd, limit: 1000 }),
        ]);
        const sumCompleted = (entries: { status: string; durationSeconds: number | null }[] | undefined) =>
          (entries || [])
            .filter((e) => e.status === "completed")
            .reduce((sum: number, e) => sum + (e.durationSeconds || 0), 0);
        setTodaySeconds(sumCompleted(todayResult?.entries));
        setWeekSeconds(sumCompleted(weekResult?.entries));
      } catch { /* ignore */ }
    };
    fetchTotals();
  }, [isClockedIn, fetchHistory]);

  // Timer — uses only client-side clock deltas, never compares against server time
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isClockedIn && timerStartedAt !== null) {
      interval = setInterval(() => {
        const clientDelta = Math.floor((Date.now() - timerStartedAt) / 1000);
        setElapsedSeconds(initialElapsed + clientDelta);
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isClockedIn, timerStartedAt, initialElapsed]);

  const handleClockIn = useCallback(async () => {
    if (!selectedTopic) return;
    if (needsProject && !selectedProject) return;
    try {
      await clockIn({
        project_id: selectedProject ? parseInt(selectedProject) : null,
        category: selectedTopic,
        task_name: selectedTopic === "project_creation" && projectDescription ? projectDescription : null,
        subcategoryId: selectedSub?.id ?? null,
        userNotes: pendingUserNotes,
      });
      setIsClockedIn(true);
      setInitialElapsed(0);
      setTimerStartedAt(Date.now());
      setElapsedSeconds(0);
      setSelectedTopic("");
      setSelectedProject("");
      setProjectSearch("");
      setProjectDescription("");
      setSelectedSub(null);
      setSubOptions([]);
      setActiveSessionUserNotes(pendingUserNotes);
      setPendingUserNotes(null);
      window.dispatchEvent(new Event("clock-state-changed"));
      refetch().catch(() => {});
    } catch {
      // Silently handle — dashboard/time page will show full errors
    }
  }, [selectedTopic, selectedSub, selectedProject, needsProject, projectDescription, clockIn, pendingUserNotes, refetch]);

  const handleSaveActiveNotes = useCallback(
    async (value: string | null) => {
      if (!activeSessionId) return;
      await updateMyNotes({ entry_id: activeSessionId, userNotes: value });
      setActiveSessionUserNotes(value);
    },
    [activeSessionId, updateMyNotes]
  );

  const handleDiscardConfirmed = useCallback(async () => {
    setDiscardError(null);
    try {
      await discardActive({});
      setShowDiscardConfirm(false);
      // Reset local state — same effect as clock_out without saving anything
      setIsClockedIn(false);
      setTimerStartedAt(null);
      setInitialElapsed(0);
      setElapsedSeconds(0);
      setActiveSessionId(null);
      setActiveSessionUserNotes(null);
      window.dispatchEvent(new Event("clock-state-changed"));
      refetch().catch(() => {});
    } catch (err) {
      setDiscardError(err instanceof Error ? err.message : "Failed to discard");
    }
  }, [discardActive, refetch]);

  const handleClockOut = useCallback(async () => {
    try {
      await clockOut({});
      setIsClockedIn(false);
      setShowConfirmation(true);
      window.dispatchEvent(new Event("clock-state-changed"));
      setTimeout(() => {
        setShowConfirmation(false);
        setTimerStartedAt(null);
        setInitialElapsed(0);
        setElapsedSeconds(0);
      }, 3000);
    } catch {
      // Silently handle
    }
  }, [clockOut]);

  // Topic-change effect: reset sub picker + fetch the subs visible to
  // this user for the new activity. Also clear project/description as
  // before (uses the activity-level fallback since selectedSub starts
  // null on topic change).
  useEffect(() => {
    setSelectedSub(null);
    if (!selectedTopic) {
      setSubOptions([]);
      setSelectedProject("");
      setProjectSearch("");
      setProjectDescription("");
      return;
    }
    if (!requiresProjectFor(selectedTopic, null)) {
      setSelectedProject("");
      setProjectSearch("");
    }
    if (selectedTopic !== "project_creation") {
      setProjectDescription("");
    }
    let cancelled = false;
    fetchSubcategories({ activity: selectedTopic })
      .then((res) => {
        if (cancelled) return;
        const list = res?.subcategories ?? [];
        setSubOptions(list);
        // Auto-pick when there's exactly one option, so the user
        // doesn't have to click a single-item dropdown.
        if (list.length === 1) setSelectedSub(list[0]);
      })
      .catch(() => {
        if (!cancelled) setSubOptions([]);
      });
    return () => {
      cancelled = true;
    };
    // fetchSubcategories is non-stable (mutation hook returns a new
    // function each render); intentionally excluded to avoid refire
    // on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTopic]);

  if (sessionLoading) {
    return (
      <div style={{ padding: "10px 12px", borderTop: "1px solid var(--border)" }}>
        <div style={{ fontSize: 11, color: "var(--muted-foreground)", textAlign: "center" }}>
          Loading...
        </div>
      </div>
    );
  }

  // Confirmation flash
  if (showConfirmation) {
    return (
      <div style={{ padding: "10px 12px", borderTop: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <svg
            style={{ width: 16, height: 16, color: "#2563eb", flexShrink: 0 }}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span style={{ fontSize: 11, color: "#2563eb", fontWeight: 500 }}>
            {formatDurationHM(elapsedSeconds)}
          </span>
        </div>
      </div>
    );
  }

  // Clocked in — show timer + clock out
  if (isClockedIn) {
    return (
      <div
        style={{
          padding: "10px 12px",
          borderTop: "2px solid #22c55e",
          backgroundColor: "rgba(34, 197, 94, 0.05)",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 2 }}>
          <span style={{ fontSize: 10, color: "var(--muted-foreground)" }}>
            Today: {formatDurationHM(todaySeconds + elapsedSeconds)} · Week: {formatDurationHM(weekSeconds + elapsedSeconds)}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, justifyContent: "center" }}>
          <span style={{ position: "relative", display: "inline-flex", width: 7, height: 7 }}>
            <span
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: "50%",
                backgroundColor: "#22c55e",
                opacity: 0.75,
                animation: "ping 1s cubic-bezier(0, 0, 0.2, 1) infinite",
              }}
            />
            <span
              style={{
                position: "relative",
                display: "inline-flex",
                width: 7,
                height: 7,
                borderRadius: "50%",
                backgroundColor: "#22c55e",
              }}
            />
          </span>
          <span
            style={{
              fontFamily: "monospace",
              fontSize: 16,
              fontWeight: 700,
              color: "#16a34a",
            }}
          >
            {formatLiveDuration(elapsedSeconds)}
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 6 }}>
          <NotesButton
            notes={activeSessionUserNotes}
            editable={true}
            onSave={handleSaveActiveNotes}
            size="xs"
          />
        </div>
        {discardError && (
          <div style={{ fontSize: 10, color: "#dc2626", marginBottom: 4, textAlign: "center" }}>
            {discardError}
          </div>
        )}
        <button
          onClick={handleClockOut}
          disabled={clockingOut}
          style={{
            width: "100%",
            padding: "5px 0",
            fontSize: 11,
            fontWeight: 600,
            color: "#fff",
            backgroundColor: "#dc2626",
            border: "none",
            borderRadius: 5,
            cursor: clockingOut ? "not-allowed" : "pointer",
            opacity: clockingOut ? 0.6 : 1,
            transition: "opacity 0.15s",
          }}
        >
          {clockingOut ? "..." : "Clock Out"}
        </button>
        {elapsedSeconds <= DISCARD_WINDOW_SECONDS && (
          <button
            onClick={() => { setDiscardError(null); setShowDiscardConfirm(true); }}
            disabled={discarding}
            style={{
              width: "100%",
              marginTop: 4,
              padding: "4px 0",
              fontSize: 10,
              fontWeight: 500,
              color: "var(--muted-foreground)",
              backgroundColor: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 5,
              cursor: discarding ? "not-allowed" : "pointer",
              opacity: discarding ? 0.6 : 1,
              transition: "opacity 0.15s",
            }}
            title="Throw away this entry without saving (within 5 min of clock-in)"
          >
            {discarding ? "..." : "Discard"}
          </button>
        )}
        <ConfirmDialog
          isOpen={showDiscardConfirm}
          onClose={() => setShowDiscardConfirm(false)}
          onConfirm={handleDiscardConfirmed}
          title="Discard active time entry?"
          message="This entry will not be saved or counted in any totals. You can clock in fresh after."
          confirmText="Discard"
          cancelText="Cancel"
          variant="destructive"
          isLoading={discarding}
        />
      </div>
    );
  }

  // Not clocked in — topic first, then sub (if any available), then conditional project.
  // If subOptions has entries we require one to be picked before clock-in is allowed.
  const needsSub = subOptions.length > 0;
  const canClockIn = !!selectedTopic
    && (!needsSub || !!selectedSub)
    && (!needsProject || !!selectedProject)
    && !clockingIn;

  return (
    <div style={{ padding: "10px 12px", borderTop: "1px solid var(--border)" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <select
          style={selectStyle}
          value={selectedTopic}
          onChange={(e) => setSelectedTopic(e.target.value)}
        >
          <option value="">Task...</option>
          {TOPIC_OPTIONS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        {subOptions.length > 0 && (
          <select
            style={selectStyle}
            value={selectedSub?.id ?? ""}
            onChange={(e) => {
              const id = e.target.value ? parseInt(e.target.value, 10) : null;
              setSelectedSub(id == null ? null : subOptions.find((s) => s.id === id) ?? null);
            }}
            aria-label="Subcategory"
          >
            <option value="">Subcategory...</option>
            {subOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        {needsProject && (
          <>
            <input
              type="text"
              style={{
                ...selectStyle,
                fontStyle: projectSearch ? "normal" : "italic",
              }}
              value={projectSearch}
              onChange={(e) => setProjectSearch(e.target.value)}
              placeholder={
                projectList.length > 5
                  ? `Search ${projectList.length} projects...`
                  : "Search projects..."
              }
              aria-label="Search projects"
            />
            <select
              style={selectStyle}
              value={selectedProject}
              onChange={(e) => setSelectedProject(e.target.value)}
            >
              <option value="">
                {filteredProjectList.length === 0
                  ? "No matching projects"
                  : projectSearch.trim()
                  ? `Project (${filteredProjectList.length} match${filteredProjectList.length === 1 ? "" : "es"})...`
                  : "Project..."}
              </option>
              {filteredProjectList.map((p) => (
                <option key={p.id} value={p.id.toString()}>
                  {p.name}
                </option>
              ))}
            </select>
          </>
        )}
        {selectedTopic === "project_creation" && (
          <input
            type="text"
            style={{
              ...selectStyle,
              fontStyle: projectDescription ? "normal" : "italic",
            }}
            value={projectDescription}
            onChange={(e) => setProjectDescription(e.target.value)}
            placeholder="Project description (optional)"
          />
        )}
        {selectedTopic && (
          <div style={{ display: "flex", justifyContent: "flex-start" }}>
            <NotesButton
              notes={pendingUserNotes}
              editable={true}
              onSave={(v) => {
                setPendingUserNotes(v);
                return Promise.resolve();
              }}
              size="xs"
            />
          </div>
        )}
        <button
          onClick={handleClockIn}
          disabled={!canClockIn}
          style={{
            width: "100%",
            padding: "5px 0",
            fontSize: 11,
            fontWeight: 600,
            color: "#fff",
            backgroundColor: "#ff6b35",
            border: "none",
            borderRadius: 5,
            cursor: !canClockIn ? "not-allowed" : "pointer",
            opacity: !canClockIn ? 0.6 : 1,
            transition: "opacity 0.15s",
          }}
        >
          {clockingIn ? "..." : "Clock In"}
        </button>
      </div>
    </div>
  );
}
