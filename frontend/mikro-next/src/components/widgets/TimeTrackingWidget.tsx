"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select, SelectOption } from "@/components/ui/Select";
import {
  useClockIn,
  useClockOut,
  useActiveTimeSession,
  useApiCall,
  useCustomTopics,
  useFetchMyTimeHistory,
  useUpdateMyNotes,
  useDiscardActiveSession,
  useUserProjects,
} from "@/hooks";
import { NotesButton } from "./NotesButton";
import {
  sortProjectsRecentPinned,
  projectDisplayName,
} from "@/lib/sortProjects";
import { ConfirmDialog } from "@/components/ui/Modal";
import { useToastActions } from "@/components/ui";
import { useErrorReporter } from "@/contexts/ErrorReporterContext";

const DISCARD_WINDOW_SECONDS = 300;

import {
  TOPIC_OPTIONS as _TOPIC_OPTIONS,
  requiresProjectFor,
  localDayStartIsoUtc,
  localDayEndIsoUtc,
  localWeekStartIsoUtc,
  formatDuration,
} from "@/lib/timeTracking";
import { useFetchSubcategories } from "@/hooks";
import type { Subcategory } from "@/types";

const TOPIC_OPTIONS: SelectOption[] = _TOPIC_OPTIONS.map((t) => ({
  value: t.value,
  label: t.label,
}));

type UserProject = {
  id: number;
  name: string;
  short_name?: string;
  last_worked_on?: string | null;
  total_mapped?: number;
  total_tasks?: number;
  in_user_country?: boolean;
};

// Duration helpers consolidated into @/lib/timeTracking:
export function TimeTrackingWidget() {
  const { data: unFormattedProjects } = useUserProjects();

  const projects =
    unFormattedProjects?.user_projects?.map((p: UserProject) => ({
      id: p.id,
      name: p.name,
      short_name: p.short_name,
      last_worked_on: p.last_worked_on ?? null,
      total_mapped: p.total_mapped ?? 0,
      total_tasks: p.total_tasks ?? 0,
      in_user_country: p.in_user_country ?? false,
    })) ?? [];

  const [isClockedIn, setIsClockedIn] = useState(false);
  const [timerStartedAt, setTimerStartedAt] = useState<number | null>(null); // Date.now() when timer was initialized
  const [initialElapsed, setInitialElapsed] = useState(0); // Server-provided elapsed seconds at start
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [selectedTopic, setSelectedTopic] = useState<string>("");
  const [selectedSub, setSelectedSub] = useState<Subcategory | null>(null);
  const [subOptions, setSubOptions] = useState<Subcategory[]>([]);
  const { mutate: fetchSubcategories } = useFetchSubcategories();
  const [taskName, setTaskName] = useState<string>("");
  const [taskRefType, setTaskRefType] = useState<string | null>(null);
  const [taskRefId, setTaskRefId] = useState<number | null>(null);
  const [customTopicInput, setCustomTopicInput] = useState<string>("");
  const [isAddingCustomTopic, setIsAddingCustomTopic] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [activeSessionProjectName, setActiveSessionProjectName] =
    useState<string>("");
  const [activeSessionTopic, setActiveSessionTopic] = useState<string>("");
  const [activeSessionTaskName, setActiveSessionTaskName] =
    useState<string>("");
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [activeSessionUserNotes, setActiveSessionUserNotes] = useState<
    string | null
  >(null);
  const [pendingUserNotes, setPendingUserNotes] = useState<string | null>(null);
  const [todaySeconds, setTodaySeconds] = useState(0);
  const [weekSeconds, setWeekSeconds] = useState(0);
  const [switchMode, setSwitchMode] = useState(false);

  const {
    data: activeSession,
    loading: sessionLoading,
    refetch: refetchSession,
  } = useActiveTimeSession();
  const { mutate: clockIn, loading: clockingIn } = useClockIn();
  const { mutate: clockOut, loading: clockingOut } = useClockOut();
  const { mutate: updateMyNotes } = useUpdateMyNotes();
  const { mutate: discardActive, loading: discarding } =
    useDiscardActiveSession();
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [discardError, setDiscardError] = useState<string | null>(null);
  const toast = useToastActions();
  const { openReport } = useErrorReporter();

  // Lazy-loaded data for training topics
  const { data: trainingData, refetch: fetchTrainings } = useApiCall<{
    status: number;
    mapping_trainings: Array<{ id: number; title: string }>;
    validation_trainings: Array<{ id: number; title: string }>;
    project_trainings: Array<{ id: number; title: string }>;
  }>("/training/fetch_user_trainings", { immediate: false });

  const { data: customTopicsData } = useCustomTopics();
  const { mutate: fetchHistory } = useFetchMyTimeHistory();

  // Listen for sync events from sidebar clock or other instances
  useEffect(() => {
    const handler = () => {
      refetchSession().catch(() => {});
    };
    window.addEventListener("clock-state-changed", handler);
    return () => window.removeEventListener("clock-state-changed", handler);
  }, [refetchSession]);

  // Restore active session on mount / sync with refetch results
  useEffect(() => {
    if (activeSession?.session) {
      const session = activeSession.session;
      const serverElapsed = session.elapsedSeconds ?? 0;
      setIsClockedIn(true);
      setInitialElapsed(serverElapsed);
      setTimerStartedAt(Date.now());
      setElapsedSeconds(serverElapsed);
      setActiveSessionProjectName(session.projectName || "");
      setActiveSessionTopic(session.category || "");
      setActiveSessionTaskName(session.taskName || "");
      setActiveSessionId(session.id);
      setActiveSessionUserNotes(session.userNotes ?? null);
      if (session.projectId) {
        setSelectedProject(session.projectId.toString());
      }
    } else if (activeSession && !activeSession.session) {
      // Session ended externally (e.g. sidebar clock-out)
      setIsClockedIn(false);
      setTimerStartedAt(null);
      setInitialElapsed(0);
      setElapsedSeconds(0);
      setActiveSessionProjectName("");
      setActiveSessionTopic("");
      setActiveSessionTaskName("");
      setActiveSessionId(null);
      setActiveSessionUserNotes(null);
    }
  }, [activeSession]);

  // Timer effect — uses only client-side clock deltas, never compares against server time
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

  // Lazy-load training data when topic changes
  useEffect(() => {
    if (selectedTopic === "training") {
      fetchTrainings().catch(() => {});
    }
  }, [selectedTopic, fetchTrainings]);

  // Reset task / project / sub fields when topic changes, then fetch
  // the tier-2 subcategories visible to this user for the new activity.
  useEffect(() => {
    setTaskName("");
    setTaskRefType(null);
    setTaskRefId(null);
    setCustomTopicInput("");
    setIsAddingCustomTopic(false);
    setSelectedSub(null);
    if (!selectedTopic) {
      setSubOptions([]);
      setSelectedProject("");
      return;
    }
    // Use the activity-level fallback to clear project; selectedSub is
    // null here so this falls back to PROJECT_REQUIRED_FALLBACK_ACTIVITIES.
    if (!requiresProjectFor(selectedTopic, null)) {
      setSelectedProject("");
    }
    let cancelled = false;
    fetchSubcategories({ activity: selectedTopic })
      .then((res) => {
        if (cancelled) return;
        setSubOptions(res?.subcategories ?? []);
      })
      .catch(() => {
        if (!cancelled) setSubOptions([]);
      });
    return () => {
      cancelled = true;
    };
    // mutation hooks are non-stable; intentionally excluded from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTopic]);

  // Fetch daily/weekly totals when clocked in. Windows are aligned to
  // the user's browser-local calendar (via ISO UTC instants), so "today"
  // is literally today on their wall clock regardless of their TZ.
  const fetchTotals = useCallback(async () => {
    try {
      const dayEnd = localDayEndIsoUtc();
      const [todayResult, weekResult] = await Promise.all([
        fetchHistory({
          startDate: localDayStartIsoUtc(),
          endDate: dayEnd,
        }),
        fetchHistory({
          startDate: localWeekStartIsoUtc(),
          endDate: dayEnd,
        }),
      ]);

      const todayTotal = (todayResult?.entries || [])
        .filter((e) => e.status === "completed")
        .reduce((sum, e) => sum + (e.durationSeconds || 0), 0);
      const weekTotal = (weekResult?.entries || [])
        .filter((e) => e.status === "completed")
        .reduce((sum, e) => sum + (e.durationSeconds || 0), 0);

      setTodaySeconds(todayTotal);
      setWeekSeconds(weekTotal);
    } catch {
      // Silently fail — totals are nice-to-have
    }
  }, [fetchHistory]);

  useEffect(() => {
    if (isClockedIn) {
      fetchTotals();
    }
  }, [isClockedIn, fetchTotals]);

  const handleClockIn = useCallback(async () => {
    if (!selectedTopic) return;
    const needsProject = requiresProjectFor(selectedTopic, selectedSub);
    if (needsProject && !selectedProject) return;
    setApiError(null);

    try {
      await clockIn({
        project_id: selectedProject ? parseInt(selectedProject) : null,
        category: selectedTopic,
        task_name: taskName || null,
        task_ref_type: taskRefType || null,
        task_ref_id: taskRefId || null,
        subcategoryId: selectedSub?.id ?? null,
        userNotes: pendingUserNotes,
      });

      setIsClockedIn(true);
      setInitialElapsed(0);
      setTimerStartedAt(Date.now());
      setElapsedSeconds(0);
      setActiveSessionProjectName(
        projects.find((p) => p.id.toString() === selectedProject)?.name || "",
      );
      setActiveSessionTopic(
        TOPIC_OPTIONS.find((t) => t.value === selectedTopic)?.label || "",
      );
      setActiveSessionTaskName(taskName || "");
      setActiveSessionUserNotes(pendingUserNotes);
      setPendingUserNotes(null);
      window.dispatchEvent(new Event("clock-state-changed"));
      setSwitchMode(false);
      fetchTotals();
      // Pull the new server-side session so we get the entry id for later note edits
      refetchSession().catch(() => {});
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Failed to clock in");
    }
  }, [
    selectedProject,
    selectedTopic,
    selectedSub,
    taskName,
    taskRefType,
    taskRefId,
    clockIn,
    projects,
    fetchTotals,
    pendingUserNotes,
    refetchSession,
  ]);

  const handleSaveActiveNotes = useCallback(
    async (value: string | null) => {
      if (!activeSessionId) return;
      await updateMyNotes({ entry_id: activeSessionId, userNotes: value });
      setActiveSessionUserNotes(value);
    },
    [activeSessionId, updateMyNotes],
  );

  const handleDiscardConfirmed = useCallback(async () => {
    setDiscardError(null);
    if (activeSessionId == null) {
      setDiscardError("No active session to discard");
      return;
    }
    try {
      await discardActive({ session_id: activeSessionId });
      setShowDiscardConfirm(false);
      setIsClockedIn(false);
      setTimerStartedAt(null);
      setInitialElapsed(0);
      setElapsedSeconds(0);
      setActiveSessionProjectName("");
      setActiveSessionTopic("");
      setActiveSessionTaskName("");
      setActiveSessionId(null);
      setActiveSessionUserNotes(null);
      window.dispatchEvent(new Event("clock-state-changed"));
      refetchSession().catch(() => {});
    } catch (err) {
      setDiscardError(err instanceof Error ? err.message : "Failed to discard");
      toast.error("Couldn't discard the session.", {
        action: { label: "Report", onClick: () => openReport() },
      });
    }
  }, [discardActive, refetchSession, activeSessionId, toast, openReport]);

  const handleClockOut = useCallback(async () => {
    setApiError(null);

    try {
      await clockOut({});

      setIsClockedIn(false);
      setShowConfirmation(true);
      window.dispatchEvent(new Event("clock-state-changed"));

      // Hide confirmation after 3 seconds
      setTimeout(() => {
        setShowConfirmation(false);
        setTimerStartedAt(null);
        setInitialElapsed(0);
        setElapsedSeconds(0);
      }, 3000);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Failed to clock out");
    }
  }, [clockOut]);

  const handleSwitchTasks = useCallback(async () => {
    setApiError(null);
    try {
      await clockOut({});
      // Don't show confirmation — go straight to clock-in form
      // Clear all selections so user must pick a new topic
      setIsClockedIn(false);
      setSwitchMode(true);
      setSelectedTopic("");
      setSelectedProject("");
      setTaskName("");
      setTaskRefType(null);
      setTaskRefId(null);
      window.dispatchEvent(new Event("clock-state-changed"));
      // Refresh totals for the new form
      fetchTotals();
    } catch (err) {
      setApiError(
        err instanceof Error ? err.message : "Failed to switch tasks",
      );
    }
  }, [clockOut, fetchTotals]);

  // Auto-clock-in when switching tasks: once topic is set and project is
  // selected (or topic doesn't need a project), clock in automatically
  const switchAutoClockRef = useRef(false);
  useEffect(() => {
    if (!switchMode || !selectedTopic || isClockedIn || clockingIn) return;
    const needsProject = requiresProjectFor(selectedTopic, selectedSub);
    if (needsProject && !selectedProject) return;
    // Prevent double-fire
    if (switchAutoClockRef.current) return;
    switchAutoClockRef.current = true;
    handleClockIn().finally(() => {
      switchAutoClockRef.current = false;
    });
  }, [
    switchMode,
    selectedTopic,
    selectedProject,
    isClockedIn,
    clockingIn,
    handleClockIn,
  ]);

  // Handle task selection for training
  const handleTrainingSelect = useCallback(
    (trainingId: string) => {
      const allTrainings = [
        ...(trainingData?.mapping_trainings || []),
        ...(trainingData?.validation_trainings || []),
        ...(trainingData?.project_trainings || []),
      ];
      const training = allTrainings.find((t) => t.id.toString() === trainingId);
      setTaskRefType("training");
      setTaskRefId(training ? training.id : null);
      setTaskName(training ? training.title : "");
    },
    [trainingData],
  );

  // Handle custom topic selection
  const handleCustomTopicSelect = useCallback(
    (value: string) => {
      if (value === "__add_new__") {
        setIsAddingCustomTopic(true);
        setTaskName("");
        setTaskRefType(null);
        setTaskRefId(null);
      } else {
        setIsAddingCustomTopic(false);
        const topic = customTopicsData?.topics?.find(
          (t) => t.id.toString() === value,
        );
        setTaskName(topic ? topic.name : "");
        setTaskRefType(null);
        setTaskRefId(topic ? topic.id : null);
      }
    },
    [customTopicsData],
  );

  const projectOptions: SelectOption[] = sortProjectsRecentPinned(projects).map(
    (p) => {
      // Fully-mapped = every task mapped. Prefix a ✓ so editors can see
      // which projects are already complete (custom Select renders the
      // label string, so the marker is the signal here).
      const isComplete = p.total_tasks > 0 && p.total_mapped >= p.total_tasks;
      const displayName = projectDisplayName(p);
      return {
        value: p.id.toString(),
        label: isComplete ? `✓ ${displayName}` : displayName,
        className: isComplete
          ? "text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/40"
          : undefined,
      };
    },
  );

  const trainingOptions: SelectOption[] = [
    ...(trainingData?.mapping_trainings || []),
    ...(trainingData?.validation_trainings || []),
    ...(trainingData?.project_trainings || []),
  ].map((t) => ({
    value: t.id.toString(),
    label: t.title,
  }));

  const customTopicOptions: SelectOption[] = [
    ...(customTopicsData?.topics || []).map((t) => ({
      value: t.id.toString(),
      label: t.name,
    })),
    { value: "__add_new__", label: "Add new..." },
  ];

  // Render the task selector based on the selected topic
  const renderTaskSelector = () => {
    if (!selectedTopic) return null;

    // Project-based topics — no task selector needed, project already selected above
    if (requiresProjectFor(selectedTopic, selectedSub)) {
      return null;
    }

    // Training
    if (selectedTopic === "training") {
      return (
        <Select
          label="Training Module"
          options={trainingOptions}
          value={taskRefId ? taskRefId.toString() : ""}
          onChange={handleTrainingSelect}
          placeholder="Select training (optional)"
        />
      );
    }

    // Project creation — optional description
    if (selectedTopic === "project_creation") {
      return (
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            Project Description
          </label>
          <input
            type="text"
            value={taskName}
            onChange={(e) => {
              setTaskName(e.target.value);
              setTaskRefType(null);
              setTaskRefId(null);
            }}
            placeholder="Describe the project being created (optional)"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      );
    }

    // Free-text topics
    if (
      ["meeting", "documentation", "imagery_capture"].includes(selectedTopic)
    ) {
      return (
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            Task Name
          </label>
          <input
            type="text"
            value={taskName}
            onChange={(e) => {
              setTaskName(e.target.value);
              setTaskRefType(null);
              setTaskRefId(null);
            }}
            placeholder="Describe the task (optional)"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      );
    }

    // Other - custom topics
    if (selectedTopic === "other") {
      return (
        <div>
          {!isAddingCustomTopic ? (
            <Select
              label="Custom Task"
              options={customTopicOptions}
              value={taskRefId ? taskRefId.toString() : ""}
              onChange={handleCustomTopicSelect}
              placeholder="Select task or add new (optional)"
            />
          ) : (
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                New Task
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={customTopicInput}
                  onChange={(e) => {
                    setCustomTopicInput(e.target.value);
                    setTaskName(e.target.value);
                    setTaskRefType(null);
                    setTaskRefId(null);
                  }}
                  placeholder="Enter task name"
                  className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  type="button"
                  onClick={() => {
                    setIsAddingCustomTopic(false);
                    setCustomTopicInput("");
                    setTaskName("");
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      );
    }

    return null;
  };

  // Loading state while checking for active session
  if (sessionLoading) {
    return (
      <Card className="h-[300px]">
        <CardHeader className="pb-2">
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
            Time Tracking
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading...</p>
        </CardContent>
      </Card>
    );
  }

  // Clocked in state - show timer
  if (isClockedIn) {
    return (
      <Card className="border-green-500 border-2 h-[300px]">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
            </span>
            Time Tracking
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center">
            <div className="text-4xl font-mono font-bold text-green-600 dark:text-green-400 mb-2">
              {formatDuration(elapsedSeconds)}
            </div>
            <p className="text-sm font-medium mb-1">
              {activeSessionProjectName}
            </p>
            <p className="text-xs text-muted-foreground mb-1">
              {activeSessionTopic}
            </p>
            {activeSessionTaskName && (
              <p className="text-xs text-muted-foreground mb-2">
                {activeSessionTaskName}
              </p>
            )}
            <div className="flex justify-center gap-3 text-xs text-muted-foreground mb-3">
              <span>
                Today: {formatDuration(todaySeconds + elapsedSeconds)}
              </span>
              <span>·</span>
              <span>Week: {formatDuration(weekSeconds + elapsedSeconds)}</span>
            </div>
            <div className="flex justify-center mb-3">
              <NotesButton
                notes={activeSessionUserNotes}
                editable={true}
                onSave={handleSaveActiveNotes}
              />
            </div>
            {apiError && (
              <p className="text-xs text-red-600 mb-2">{apiError}</p>
            )}
            {discardError && (
              <p className="text-xs text-red-600 mb-2">{discardError}</p>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleSwitchTasks}
                disabled={clockingOut}
                className="flex-1"
              >
                Switch Tasks
              </Button>
              <Button
                variant="destructive"
                onClick={handleClockOut}
                disabled={clockingOut}
                className="flex-1"
              >
                <svg
                  className="w-4 h-4 mr-1"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 10h6v4H9z"
                  />
                </svg>
                {clockingOut ? "..." : "Clock Out"}
              </Button>
            </div>
            {elapsedSeconds <= DISCARD_WINDOW_SECONDS && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDiscardError(null);
                  setShowDiscardConfirm(true);
                }}
                disabled={discarding}
                className="w-full mt-2 text-muted-foreground"
                title="Throw away this entry without saving (within 5 min of clock-in)"
              >
                {discarding ? "..." : "Discard"}
              </Button>
            )}
          </div>
        </CardContent>
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
      </Card>
    );
  }

  // Confirmation state
  if (showConfirmation) {
    return (
      <Card className="border-blue-500 bg-blue-50 dark:bg-blue-900 h-[300px]">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg text-blue-900 dark:text-blue-100">
            Time Tracking
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4">
            <svg
              className="w-12 h-12 mx-auto text-blue-600 dark:text-blue-400 mb-2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
            <p className="font-medium text-blue-800 dark:text-blue-100">
              Time logged successfully!
            </p>
            <p className="text-sm text-blue-600 dark:text-blue-300 mt-1">
              Total: {formatDuration(elapsedSeconds)}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Default state - clock in form
  return (
    <Card className="h-[450px]">
      <CardHeader className="pb-2">
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
          Time Tracking
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {apiError && <p className="text-xs text-red-600">{apiError}</p>}
          {switchMode && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-2 text-center">
              <p className="text-xs text-blue-700 dark:text-blue-300">
                Previous task saved — select your new task below
              </p>
            </div>
          )}
          <Select
            label="Task"
            options={TOPIC_OPTIONS}
            value={selectedTopic}
            onChange={setSelectedTopic}
            placeholder="Select task"
          />
          {subOptions.length > 0 ? (
            <Select
              label="Subcategory"
              options={subOptions.map((s) => ({
                value: String(s.id),
                label: s.name,
              }))}
              value={selectedSub ? String(selectedSub.id) : ""}
              onChange={(v) => {
                const id = v ? parseInt(v, 10) : null;
                setSelectedSub(
                  id == null
                    ? null
                    : (subOptions.find((s) => s.id === id) ?? null),
                );
              }}
              placeholder="Select subcategory"
            />
          ) : null}
          {selectedTopic && requiresProjectFor(selectedTopic, selectedSub) && (
            <Select
              label="Project"
              options={projectOptions}
              value={selectedProject}
              onChange={setSelectedProject}
              placeholder="Select a project"
              searchable
            />
          )}
          {renderTaskSelector()}
          {selectedTopic && (
            <div>
              <NotesButton
                notes={pendingUserNotes}
                editable={true}
                onSave={(v) => {
                  setPendingUserNotes(v);
                  return Promise.resolve();
                }}
              />
            </div>
          )}
          <Button
            variant="primary"
            onClick={handleClockIn}
            disabled={
              !selectedTopic ||
              (requiresProjectFor(selectedTopic, selectedSub) &&
                !selectedProject) ||
              clockingIn
            }
            className="w-full mt-2"
          >
            <svg
              className="w-4 h-4 mr-2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            {clockingIn ? "Clocking In..." : "Clock In"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
