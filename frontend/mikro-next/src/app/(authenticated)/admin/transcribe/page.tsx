"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Badge,
} from "@/components/ui";
import Link from "next/link";
import {
  type TranscriptionSegment,
  formatTimestamp,
  ACCEPTED_MIME_TYPES,
} from "@/lib/transcribe";
import { chunkedUpload } from "@/lib/chunkedUpload";
import AiActions from "@/components/transcribe/AiActions";
import ExportButtons from "@/components/transcribe/ExportButtons";

const MAX_FILE_BYTES = 1024 * 1024 * 1024; // 1 GB
const formatBytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

type TranscriptionStatus = "idle" | "uploading" | "transcribing" | "done";
type Mode = "record" | "upload";

interface RecentJob {
  jobId: string;
  jobStatus: string;
  fileName: string;
  segments: TranscriptionSegment[];
  text: string;
  duration: number;
  progress: number;
  error: string | null;
  createdAt: string | null;
  completedAt: string | null;
}

export default function TranscribePage() {
  // Recording state
  const [mode, setMode] = useState<Mode>("upload");
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Upload state
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Transcription state
  const [transcriptionStatus, setTranscriptionStatus] =
    useState<TranscriptionStatus>("idle");
  const [jobId, setJobId] = useState<string | null>(null);
  const [segments, setSegments] = useState<TranscriptionSegment[]>([]);
  const [fullText, setFullText] = useState("");
  const [transcribeDurationMs, setTranscribeDurationMs] = useState(0);
  const [segmentCount, setSegmentCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  // jobId of the currently displayed transcript — kept even after completion
  // so AI actions can reference it. null only when the page is truly idle.
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  // Server-reported moment the worker picked up the job. Drives elapsed-time
  // display and stall detection. Null during upload and before first poll.
  const [serverStartedAt, setServerStartedAt] = useState<number | null>(null);
  // Client clock timestamp of the last observed progress change. Used to
  // detect stalls mid-transcription (segments stopped arriving).
  const [lastProgressAt, setLastProgressAt] = useState<number | null>(null);
  // Re-render tick so the elapsed-time / stall warnings update live.
  const [nowTick, setNowTick] = useState(Date.now());

  // Upload progress (chunked upload)
  const [uploadBytes, setUploadBytes] = useState(0);
  const [uploadTotal, setUploadTotal] = useState(0);
  const [uploadParts, setUploadParts] = useState(0);
  const [uploadTotalParts, setUploadTotalParts] = useState(0);
  const uploadAbortRef = useRef<AbortController | null>(null);

  // Recent jobs
  const [recentJobs, setRecentJobs] = useState<RecentJob[]>([]);

  // Load recent jobs on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/backend/transcribe/recent", {
          credentials: "include",
        });
        const data = await res.json();
        if (data.jobs) {
          setRecentJobs(data.jobs);

          // If there's an active job (queued or transcribing), resume polling it
          const active = data.jobs.find(
            (j: RecentJob) =>
              j.jobStatus === "queued" || j.jobStatus === "transcribing",
          );
          if (active) {
            setJobId(active.jobId);
            setCurrentJobId(active.jobId);
            setFileName(active.fileName);
            setTranscriptionStatus("transcribing");
            setSegmentCount(active.progress || 0);
            if (active.segments?.length) {
              setSegments(active.segments);
            }
          }
        }
      } catch {
        // Ignore — recent jobs are optional
      }
    })();
  }, []);

  // Poll for transcription status
  useEffect(() => {
    if (!jobId || transcriptionStatus !== "transcribing") return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/backend/transcribe/result?jobId=${jobId}`, {
          credentials: "include",
        });
        const data = await res.json();

        if (data.jobStatus === "done") {
          setTranscriptionStatus("done");
          setSegments(data.segments || []);
          setFullText(data.text || "");
          setTranscribeDurationMs(Math.round((data.duration || 0) * 1000));
          // Keep currentJobId populated so AI actions can reference it.
          setJobId(null);
          setServerStartedAt(null);
          setLastProgressAt(null);
        } else if (data.jobStatus === "error") {
          const failedJobId = data.jobId || jobId;
          setError(data.error || "Transcription failed");
          setTranscriptionStatus("idle");
          setJobId(null);
          setCurrentJobId(null);
          setServerStartedAt(null);
          setLastProgressAt(null);
          // Auto-drop the errored row from the DB. The user has already
          // been notified via setError above; keeping the row around just
          // clutters the library. Best-effort — failure here is silent.
          if (failedJobId) {
            setRecentJobs((prev) =>
              prev.filter((j) => j.jobId !== failedJobId),
            );
            fetch("/backend/transcribe/delete", {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ jobIds: [failedJobId] }),
            }).catch(() => {
              /* user has been notified — no need to surface a delete failure */
            });
          }
        } else {
          // Prefer startedAt (moment worker picked up the job) but fall
          // back to createdAt (moment upload completed) so the UI never
          // shows "elapsed 0s" just because one field is missing in the
          // response. Only set once — we want the earliest known value.
          const timeIso = data.startedAt ?? data.createdAt;
          if (timeIso && !serverStartedAt) {
            const ms = Date.parse(timeIso);
            if (Number.isFinite(ms)) setServerStartedAt(ms);
          }
          const newProgress = data.progress || 0;
          if (newProgress !== segmentCount) {
            setSegmentCount(newProgress);
            setLastProgressAt(Date.now());
          }
          if (data.segments?.length > segments.length) {
            setSegments(data.segments);
          }
        }
      } catch {
        // Ignore polling errors, will retry
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [jobId, transcriptionStatus, segments.length, segmentCount]);

  // Live-updating elapsed-time tick while a transcription is running.
  useEffect(() => {
    if (transcriptionStatus !== "transcribing") return;
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [transcriptionStatus]);

  // Upload file via chunked multipart direct to Spaces
  const uploadFile = useCallback(async (file: File | Blob, name: string) => {
    if (file.size > MAX_FILE_BYTES) {
      setError(
        `File is ${formatBytes(file.size)} — max is ${formatBytes(MAX_FILE_BYTES)}`,
      );
      return;
    }

    setError(null);
    setFileName(name);
    setTranscriptionStatus("uploading");
    setSegments([]);
    setFullText("");
    setSegmentCount(0);
    setServerStartedAt(null);
    setLastProgressAt(null);
    setUploadBytes(0);
    setUploadTotal(file.size);
    setUploadParts(0);
    setUploadTotalParts(0);

    const controller = new AbortController();
    uploadAbortRef.current = controller;

    try {
      const { jobId: newJobId } = await chunkedUpload({
        file,
        fileName: name,
        contentType: file.type || undefined,
        signal: controller.signal,
        onProgress: ({
          bytesUploaded,
          totalBytes,
          partsUploaded,
          totalParts,
        }) => {
          setUploadBytes(bytesUploaded);
          setUploadTotal(totalBytes);
          setUploadParts(partsUploaded);
          setUploadTotalParts(totalParts);
        },
      });
      setJobId(newJobId);
      setCurrentJobId(newJobId);
      setTranscriptionStatus("transcribing");
    } catch (err) {
      if (err instanceof Error && err.name === "AbortedError") {
        setError("Upload cancelled.");
      } else {
        setError(
          `Upload failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      setTranscriptionStatus("idle");
    } finally {
      uploadAbortRef.current = null;
    }
  }, []);

  const cancelUpload = useCallback(() => {
    uploadAbortRef.current?.abort();
  }, []);

  const cancelTranscription = useCallback(async () => {
    if (!jobId) {
      // No active server job — just reset local state
      setTranscriptionStatus("idle");
      setSegments([]);
      setFullText("");
      setSegmentCount(0);
      return;
    }
    try {
      await fetch("/backend/transcribe/cancel", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
    } catch {
      // best-effort — the polling loop will pick up the new status either way
    }
    setTranscriptionStatus("idle");
    setJobId(null);
    setSegments([]);
    setFullText("");
    setSegmentCount(0);
  }, [jobId]);

  // Recording
  const startRecording = async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        uploadFile(blob, "recording.webm");
      };

      recorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } catch {
      setError("Microphone access denied.");
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  // File handling
  const handleFile = (file: File) => {
    uploadFile(file, file.name);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  };

  const loadPreviousJob = (job: RecentJob) => {
    setSegments(job.segments || []);
    setFullText(job.text || "");
    setTranscribeDurationMs(Math.round((job.duration || 0) * 1000));
    setFileName(job.fileName);
    setCurrentJobId(job.jobId);
    setTranscriptionStatus("done");
    setError(null);
  };

  const isBusy =
    transcriptionStatus === "uploading" ||
    transcriptionStatus === "transcribing";

  // ─── Phase-aware status text + stall detection ────────────────────────
  // Nothing here ever lies: each branch either reports what the worker is
  // actually doing (based on progress + startedAt + last-change time) or
  // flags an honest warning when the server's gone quiet.
  const elapsedMs = serverStartedAt ? nowTick - serverStartedAt : 0;
  const sinceLastProgressMs = lastProgressAt ? nowTick - lastProgressAt : 0;
  const formatElapsed = (ms: number) => {
    if (ms < 0) ms = 0;
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const rem = s % 60;
    if (m === 0) return `${s}s`;
    return `${m}m ${String(rem).padStart(2, "0")}s`;
  };
  const rateText = () => {
    if (segmentCount === 0 || elapsedMs < 10000) return "";
    const perMin = segmentCount / (elapsedMs / 60000);
    if (!Number.isFinite(perMin) || perMin <= 0) return "";
    return ` · ~${perMin.toFixed(1)} segments/min`;
  };

  type Phase = {
    kind: "info" | "warn" | "error";
    label: string;
    subtitle?: string;
  };
  const computePhase = (): Phase | null => {
    if (transcriptionStatus !== "transcribing") return null;

    // Not started on server yet (haven't seen first poll response).
    if (!serverStartedAt) {
      return {
        kind: "info",
        label: "Queued — waiting for worker to pick up the job…",
        subtitle: "Usually starts within a few seconds.",
      };
    }

    // Progress = 0: still in pre-segment phase (download, model load, or
    // transcribe() hasn't emitted its first segment yet).
    if (segmentCount === 0) {
      if (elapsedMs < 60_000) {
        return {
          kind: "info",
          label: `Warming up — loading Whisper model and downloading audio…`,
          subtitle: `Elapsed ${formatElapsed(elapsedMs)}`,
        };
      }
      if (elapsedMs < 5 * 60_000) {
        return {
          kind: "info",
          label: `Still warming up (${formatElapsed(elapsedMs)})`,
          subtitle:
            "First job after a redeploy downloads the model (~74MB). Subsequent jobs skip this step.",
        };
      }
      if (elapsedMs < 15 * 60_000) {
        return {
          kind: "warn",
          label: `No segments yet after ${formatElapsed(elapsedMs)}`,
          subtitle:
            "Model load or audio download might be slow. You can keep waiting, or Kill Job and retry.",
        };
      }
      return {
        kind: "error",
        label: `Likely stuck — no progress after ${formatElapsed(elapsedMs)}`,
        subtitle:
          "The stale-job watchdog will kill this at the 30-minute mark. Safe to Kill Job now and retry.",
      };
    }

    // Making progress. Report throughput. Flag if segments have stalled.
    // Chunked architecture emits segments streaming within a 5-min chunk,
    // then pauses ~30-90s at the boundary while the next chunk's first
    // whisper forward-pass runs. Thresholds below tolerate that gap;
    // anything beyond it is actually suspicious.
    const stalled = sinceLastProgressMs > 4 * 60_000;
    const verySlow = sinceLastProgressMs > 10 * 60_000;
    if (verySlow) {
      return {
        kind: "error",
        label: `No new segments in ${formatElapsed(sinceLastProgressMs)}`,
        subtitle: `${segmentCount} segments captured so far. Worker may be stalled — consider Kill Job.`,
      };
    }
    if (stalled) {
      return {
        kind: "warn",
        label: `Possible stall — last segment ${formatElapsed(sinceLastProgressMs)} ago`,
        subtitle: `${segmentCount} segments · elapsed ${formatElapsed(elapsedMs)}${rateText()} · inter-chunk pauses up to ~2 min are normal`,
      };
    }
    return {
      kind: "info",
      label: `Transcribing — ${segmentCount} segment${segmentCount === 1 ? "" : "s"} · ${formatElapsed(elapsedMs)}${rateText()}`,
      subtitle:
        "Safe to navigate away — results will be here when you come back.",
    };
  };

  const phase = computePhase();
  const phaseColors: Record<
    "info" | "warn" | "error",
    { bg: string; border: string; text: string; accent: string }
  > = {
    info: {
      bg: "#eff6ff",
      border: "#bfdbfe",
      text: "#1e40af",
      accent: "#004e89",
    },
    warn: {
      bg: "#fff7ed",
      border: "#fed7aa",
      text: "#9a3412",
      accent: "#ea580c",
    },
    error: {
      bg: "#fef2f2",
      border: "#fca5a5",
      text: "#991b1b",
      accent: "#dc2626",
    },
  };

  return (
    <div
      style={{ padding: "24px", maxWidth: 900, margin: "0 auto" }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => e.preventDefault()}
    >
      {/* Page title */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 24,
        }}
      >
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#004e89"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" x2="12" y1="19" y2="22" />
        </svg>
        <h1
          style={{ fontSize: 28, fontWeight: 700, margin: 0, color: "#1a1a1a" }}
        >
          Transcribe
        </h1>
        <Badge variant="outline" style={{ fontSize: 11 }}>
          Experimental
        </Badge>
        <div style={{ marginLeft: "auto" }}>
          <Link
            href="/admin/transcribe/library"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 14px",
              fontSize: 13,
              fontWeight: 500,
              color: "#004e89",
              border: "1px solid #004e89",
              borderRadius: 8,
              textDecoration: "none",
              backgroundColor: "#fff",
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
            Browse Library
          </Link>
        </div>
      </div>

      <p style={{ fontSize: 13, color: "#888", marginBottom: 20 }}>
        Upload an audio file or record directly. Transcription runs on the
        server using Whisper — you can navigate away and come back for results.
      </p>

      {/* Mode tabs + input */}
      <Card style={{ marginBottom: 20 }}>
        <CardHeader>
          <CardTitle style={{ fontSize: 18 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span>Audio Input</span>
              <div style={{ display: "flex", gap: 8 }}>
                <Button
                  onClick={() => setMode("record")}
                  variant={mode === "record" ? "primary" : "outline"}
                  style={
                    mode === "record"
                      ? { backgroundColor: "#004e89", color: "#fff" }
                      : {}
                  }
                >
                  Record
                </Button>
                <Button
                  onClick={() => setMode("upload")}
                  variant={mode === "upload" ? "primary" : "outline"}
                  style={
                    mode === "upload"
                      ? { backgroundColor: "#004e89", color: "#fff" }
                      : {}
                  }
                >
                  Upload
                </Button>
              </div>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {mode === "record" ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                padding: "32px 0",
              }}
            >
              <button
                onClick={isRecording ? stopRecording : startRecording}
                disabled={isBusy}
                style={{
                  width: 96,
                  height: 96,
                  borderRadius: "50%",
                  border: "none",
                  backgroundColor: isRecording ? "#dc2626" : "#004e89",
                  color: "#fff",
                  cursor: isBusy ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: isBusy ? 0.4 : 1,
                  transition: "background-color 0.2s",
                  animation: isRecording
                    ? "pulse-recording 1.5s ease-in-out infinite"
                    : "none",
                  boxShadow: isRecording
                    ? "0 0 0 8px rgba(220, 38, 38, 0.2)"
                    : "0 2px 8px rgba(0,0,0,0.15)",
                }}
              >
                {isRecording ? (
                  <svg
                    width="36"
                    height="36"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                ) : (
                  <svg
                    width="36"
                    height="36"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" x2="12" y1="19" y2="22" />
                  </svg>
                )}
              </button>
              {isRecording && (
                <p
                  style={{
                    marginTop: 16,
                    fontSize: 20,
                    fontWeight: 600,
                    fontVariantNumeric: "tabular-nums",
                    color: "#dc2626",
                  }}
                >
                  {formatTimestamp(recordingTime)}
                </p>
              )}
              <p style={{ marginTop: 12, fontSize: 13, color: "#888" }}>
                {isBusy
                  ? "Processing..."
                  : isRecording
                    ? "Click to stop recording"
                    : "Click to start recording"}
              </p>
              <style>{`@keyframes pulse-recording { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.04); } }`}</style>
            </div>
          ) : (
            <div>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => !isBusy && fileInputRef.current?.click()}
                style={{
                  border: `2px dashed ${dragOver ? "#004e89" : "#d1d5db"}`,
                  borderRadius: 12,
                  padding: "48px 24px",
                  textAlign: "center",
                  cursor: isBusy ? "not-allowed" : "pointer",
                  backgroundColor: dragOver ? "#f0f7ff" : "#fafafa",
                  transition: "all 0.2s",
                  opacity: isBusy ? 0.4 : 1,
                }}
              >
                <svg
                  width="40"
                  height="40"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#999"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ margin: "0 auto 12px" }}
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" x2="12" y1="3" y2="15" />
                </svg>
                <p
                  style={{
                    fontSize: 15,
                    fontWeight: 500,
                    color: "#333",
                    margin: "0 0 6px",
                  }}
                >
                  {fileName && isBusy
                    ? `Processing: ${fileName}`
                    : "Drop an audio file here, or click to browse"}
                </p>
                <p style={{ fontSize: 12, color: "#999", margin: 0 }}>
                  Supports MP3, M4A, WAV, MP4, WebM, OGG — any length
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_MIME_TYPES}
                onChange={handleFileInput}
                style={{ display: "none" }}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Error */}
      {error && (
        <Card style={{ marginBottom: 20, borderColor: "#fca5a5" }}>
          <CardContent>
            <p style={{ color: "#dc2626", margin: "12px 0 0", fontSize: 14 }}>
              {error}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Progress */}
      {(transcriptionStatus === "uploading" ||
        transcriptionStatus === "transcribing") && (
        <Card
          style={{
            marginBottom: 20,
            borderColor: phase ? phaseColors[phase.kind].border : undefined,
          }}
        >
          <CardContent>
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                padding: "16px 0 8px",
                flexWrap: "wrap",
                backgroundColor: phase ? phaseColors[phase.kind].bg : undefined,
                borderRadius: 8,
                paddingLeft: phase ? 14 : 0,
                paddingRight: phase ? 14 : 0,
              }}
            >
              {/* Spinner only while things are healthy — for warn/error show
                  a warning glyph instead so the UI doesn't *look* fine. */}
              {transcriptionStatus === "uploading" || phase?.kind === "info" ? (
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={phase ? phaseColors[phase.kind].accent : "#004e89"}
                  strokeWidth="2"
                  style={{
                    animation: "spin 1s linear infinite",
                    flexShrink: 0,
                    marginTop: 2,
                  }}
                >
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
              ) : (
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={phaseColors[phase!.kind].accent}
                  strokeWidth="2"
                  style={{ flexShrink: 0, marginTop: 2 }}
                >
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              )}
              <div style={{ flex: 1, minWidth: 220 }}>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 500,
                    color: phase ? phaseColors[phase.kind].text : "#333",
                  }}
                >
                  {transcriptionStatus === "uploading"
                    ? uploadTotalParts > 0
                      ? `Uploading ${uploadParts}/${uploadTotalParts} chunks — ${formatBytes(uploadBytes)} / ${formatBytes(uploadTotal)} (${Math.round((uploadBytes / Math.max(uploadTotal, 1)) * 100)}%)`
                      : "Preparing upload..."
                    : (phase?.label ?? "Transcribing…")}
                </div>
                {transcriptionStatus === "transcribing" && phase?.subtitle && (
                  <div
                    style={{
                      fontSize: 12,
                      color: phase ? phaseColors[phase.kind].text : "#888",
                      marginTop: 4,
                      opacity: 0.85,
                    }}
                  >
                    {phase.subtitle}
                  </div>
                )}
              </div>
              {transcriptionStatus === "uploading" && (
                <Button
                  variant="outline"
                  onClick={cancelUpload}
                  style={{ fontSize: 12, padding: "4px 12px", flexShrink: 0 }}
                >
                  Cancel
                </Button>
              )}
              {transcriptionStatus === "transcribing" && (
                <Button
                  variant="outline"
                  onClick={cancelTranscription}
                  style={{
                    fontSize: 12,
                    padding: "4px 12px",
                    color: "#dc2626",
                    borderColor: "#fca5a5",
                    flexShrink: 0,
                  }}
                >
                  Kill job
                </Button>
              )}
              <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
            </div>
            {transcriptionStatus === "uploading" && uploadTotal > 0 && (
              <div
                style={{
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: "#e5e7eb",
                  overflow: "hidden",
                  marginTop: 4,
                }}
              >
                <div
                  style={{
                    width: `${(uploadBytes / uploadTotal) * 100}%`,
                    height: "100%",
                    backgroundColor: "#004e89",
                    transition: "width 0.2s ease-out",
                  }}
                />
              </div>
            )}

            {/* Live segments as they arrive */}
            {segments.length > 0 && (
              <div
                style={{
                  marginTop: 8,
                  maxHeight: 200,
                  overflowY: "auto",
                  fontSize: 13,
                  color: "#666",
                  fontFamily: "monospace",
                  lineHeight: 1.8,
                }}
              >
                {segments.map((seg, i) => (
                  <div key={i}>
                    <span style={{ color: "#004e89", fontWeight: 600 }}>
                      [{formatTimestamp(seg.timeStart)} &rarr;{" "}
                      {formatTimestamp(seg.timeEnd)}]
                    </span>{" "}
                    {seg.text}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {transcriptionStatus === "done" && segments.length > 0 && (
        <Card style={{ marginBottom: 20 }}>
          <CardHeader>
            <CardTitle style={{ fontSize: 18 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span>Results{fileName ? ` — ${fileName}` : ""}</span>
                <div style={{ display: "flex", gap: 8 }}>
                  <Badge variant="outline" style={{ fontSize: 11 }}>
                    {segments.length} segment{segments.length !== 1 ? "s" : ""}
                  </Badge>
                  {transcribeDurationMs > 0 && (
                    <Badge variant="outline" style={{ fontSize: 11 }}>
                      {(transcribeDurationMs / 1000 / 60).toFixed(1)} min audio
                    </Badge>
                  )}
                </div>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              style={{
                maxHeight: 400,
                overflowY: "auto",
                marginBottom: 20,
                fontFamily: "monospace",
                fontSize: 13,
                lineHeight: 1.9,
                backgroundColor: "#f9fafb",
                borderRadius: 8,
                padding: 16,
                border: "1px solid #e5e7eb",
              }}
            >
              {segments.map((seg, i) => (
                <div key={i} style={{ marginBottom: 4 }}>
                  <span style={{ color: "#004e89", fontWeight: 600 }}>
                    [{formatTimestamp(seg.timeStart)} &rarr;{" "}
                    {formatTimestamp(seg.timeEnd)}]
                  </span>{" "}
                  {seg.text}
                </div>
              ))}
            </div>

            <label
              style={{
                display: "block",
                fontSize: 13,
                fontWeight: 500,
                marginBottom: 6,
                color: "#555",
              }}
            >
              Full Text
            </label>
            <textarea
              readOnly
              value={fullText}
              style={{
                width: "100%",
                minHeight: 120,
                padding: 12,
                borderRadius: 8,
                border: "1px solid #d1d5db",
                fontSize: 14,
                lineHeight: 1.6,
                resize: "vertical",
                fontFamily: "inherit",
                backgroundColor: "#fff",
              }}
            />
            <div style={{ marginTop: 12 }}>
              <ExportButtons
                segments={segments}
                fullText={fullText}
                displayName={fileName || "transcript"}
              />
            </div>

            {currentJobId && (
              <AiActions
                key={currentJobId}
                jobId={currentJobId}
                displayName={fileName || "transcript"}
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* Recent Transcriptions */}
      {recentJobs.length > 0 && transcriptionStatus !== "done" && (
        <Card>
          <CardHeader>
            <CardTitle style={{ fontSize: 16 }}>
              Recent Transcriptions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {recentJobs
                .filter((j) => j.jobStatus === "done")
                .slice(0, 5)
                .map((job) => (
                  <div
                    key={job.jobId}
                    onClick={() => loadPreviousJob(job)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "10px 14px",
                      borderRadius: 8,
                      border: "1px solid #e5e7eb",
                      cursor: "pointer",
                      transition: "background-color 0.15s",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.backgroundColor = "#f9fafb")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.backgroundColor = "")
                    }
                  >
                    <div>
                      <span
                        style={{ fontSize: 14, fontWeight: 500, color: "#333" }}
                      >
                        {job.fileName || "Untitled"}
                      </span>
                      <span
                        style={{ fontSize: 12, color: "#999", marginLeft: 12 }}
                      >
                        {job.createdAt
                          ? new Date(job.createdAt).toLocaleDateString()
                          : ""}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <Badge variant="outline" style={{ fontSize: 10 }}>
                        {job.segments?.length || 0} segments
                      </Badge>
                      {job.duration > 0 && (
                        <Badge variant="outline" style={{ fontSize: 10 }}>
                          {(job.duration / 60).toFixed(1)} min
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
