"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Badge,
} from "@/components/ui";
import { type TranscriptionSegment, formatTimestamp } from "@/lib/transcribe";
import AiActions from "@/components/transcribe/AiActions";
import ExportButtons from "@/components/transcribe/ExportButtons";

interface JobDetail {
  jobId: string;
  jobStatus: string;
  title: string | null;
  fileName: string | null;
  tags: string[];
  segments: TranscriptionSegment[];
  text: string;
  duration: number;
  progress: number;
  createdAt: string | null;
  completedAt: string | null;
}

function formatDuration(seconds: number): string {
  if (!seconds) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}m ${String(secs).padStart(2, "0")}s`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString();
}

export default function TranscribeDetailPage() {
  const params = useParams<{ jobId: string }>();
  const router = useRouter();
  const jobId = params.jobId;

  const [job, setJob] = useState<JobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [editingTags, setEditingTags] = useState(false);
  const [tagsDraft, setTagsDraft] = useState("");
  const [savingMeta, setSavingMeta] = useState(false);

  const loadJob = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/backend/transcribe/result?jobId=${jobId}`, {
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok || (data.status && data.status !== 200)) {
        throw new Error(data.message || data.error || "Failed to load");
      }
      setJob({
        jobId: data.jobId,
        jobStatus: data.jobStatus,
        title: data.title ?? null,
        fileName: data.fileName ?? null,
        tags: data.tags || [],
        segments: data.segments || [],
        text: data.text || "",
        duration: data.duration || 0,
        progress: data.progress || 0,
        createdAt: data.createdAt || null,
        completedAt: data.completedAt || null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    loadJob();
  }, [loadJob]);

  const saveTitle = async () => {
    if (!job) return;
    setSavingMeta(true);
    try {
      const res = await fetch("/backend/transcribe/update", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: job.jobId,
          title: titleDraft.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.status !== 200) {
        throw new Error(data.message || "Rename failed");
      }
      setEditingTitle(false);
      await loadJob();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingMeta(false);
    }
  };

  const saveTags = async () => {
    if (!job) return;
    setSavingMeta(true);
    try {
      const tags = tagsDraft
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const res = await fetch("/backend/transcribe/update", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.jobId, tags }),
      });
      const data = await res.json();
      if (!res.ok || data.status !== 200) {
        throw new Error(data.message || "Retag failed");
      }
      setEditingTags(false);
      await loadJob();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingMeta(false);
    }
  };

  const deleteJob = async () => {
    if (!job) return;
    if (!confirm("Delete this transcription? This cannot be undone.")) return;
    try {
      const res = await fetch("/backend/transcribe/delete", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobIds: [job.jobId] }),
      });
      const data = await res.json();
      if (!res.ok || data.status !== 200) {
        throw new Error(data.message || "Delete failed");
      }
      router.push("/admin/transcribe/library");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
        <p style={{ color: "#999" }}>Loading…</p>
      </div>
    );
  }

  if (error && !job) {
    return (
      <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
        <div style={{ marginBottom: 16 }}>
          <Link
            href="/admin/transcribe/library"
            style={{ fontSize: 13, color: "#666" }}
          >
            ← Back to Library
          </Link>
        </div>
        <Card>
          <CardContent>
            <p style={{ color: "#dc2626", padding: "20px 0" }}>{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!job) return null;

  const displayName = job.title || job.fileName || `(unnamed, ${job.jobId})`;

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <Link
          href="/admin/transcribe/library"
          style={{ fontSize: 13, color: "#666", textDecoration: "none" }}
        >
          ← Back to Library
        </Link>
      </div>

      <Card style={{ marginBottom: 20 }}>
        <CardHeader>
          <CardTitle style={{ fontSize: 18 }}>
            {editingTitle ? (
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  type="text"
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveTitle();
                    if (e.key === "Escape") setEditingTitle(false);
                  }}
                  autoFocus
                  style={{
                    flex: 1,
                    padding: "8px 10px",
                    fontSize: 18,
                    fontWeight: 600,
                    border: "1px solid #d1d5db",
                    borderRadius: 6,
                  }}
                />
                <Button
                  onClick={saveTitle}
                  disabled={savingMeta}
                  style={{
                    fontSize: 12,
                    padding: "6px 12px",
                    backgroundColor: "#004e89",
                    color: "#fff",
                  }}
                >
                  Save
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setEditingTitle(false)}
                  style={{ fontSize: 12, padding: "6px 12px" }}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <span
                  onClick={() => {
                    setTitleDraft(job.title || job.fileName || "");
                    setEditingTitle(true);
                  }}
                  title="Click to rename"
                  style={{ cursor: "pointer" }}
                >
                  {displayName}
                </span>
                <div style={{ display: "flex", gap: 6 }}>
                  {job.segments.length > 0 && (
                    <Badge variant="outline" style={{ fontSize: 11 }}>
                      {job.segments.length} segment
                      {job.segments.length === 1 ? "" : "s"}
                    </Badge>
                  )}
                  <Badge variant="outline" style={{ fontSize: 11 }}>
                    {formatDuration(job.duration)}
                  </Badge>
                </div>
              </div>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Meta */}
          <div
            style={{
              fontSize: 12,
              color: "#888",
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              marginBottom: 12,
            }}
          >
            <span>Created {formatDate(job.createdAt)}</span>
            {job.completedAt && (
              <>
                <span>·</span>
                <span>Completed {formatDate(job.completedAt)}</span>
              </>
            )}
            {job.fileName && (
              <>
                <span>·</span>
                <span>File: {job.fileName}</span>
              </>
            )}
          </div>

          {/* Tags */}
          <div style={{ marginBottom: 16 }}>
            {editingTags ? (
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  type="text"
                  value={tagsDraft}
                  onChange={(e) => setTagsDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveTags();
                    if (e.key === "Escape") setEditingTags(false);
                  }}
                  placeholder="comma,separated,tags"
                  autoFocus
                  style={{
                    flex: 1,
                    padding: "6px 10px",
                    fontSize: 13,
                    border: "1px solid #d1d5db",
                    borderRadius: 6,
                  }}
                />
                <Button
                  onClick={saveTags}
                  disabled={savingMeta}
                  style={{
                    fontSize: 12,
                    padding: "6px 12px",
                    backgroundColor: "#004e89",
                    color: "#fff",
                  }}
                >
                  Save
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setEditingTags(false)}
                  style={{ fontSize: 12, padding: "6px 12px" }}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <div
                onClick={() => {
                  setTagsDraft(job.tags.join(", "));
                  setEditingTags(true);
                }}
                title="Click to edit tags"
                style={{
                  cursor: "pointer",
                  display: "flex",
                  gap: 6,
                  flexWrap: "wrap",
                  minHeight: 24,
                  alignItems: "center",
                }}
              >
                {job.tags.length === 0 ? (
                  <span
                    style={{ fontSize: 12, color: "#bbb", fontStyle: "italic" }}
                  >
                    + add tags
                  </span>
                ) : (
                  job.tags.map((t) => (
                    <span
                      key={t}
                      style={{
                        padding: "3px 10px",
                        fontSize: 12,
                        borderRadius: 999,
                        backgroundColor: "#e0f2fe",
                        color: "#0369a1",
                      }}
                    >
                      {t}
                    </span>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Segments */}
          {job.segments.length > 0 && (
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
              {job.segments.map((seg, i) => (
                <div key={i} style={{ marginBottom: 4 }}>
                  <span style={{ color: "#004e89", fontWeight: 600 }}>
                    [{formatTimestamp(seg.timeStart)} &rarr;{" "}
                    {formatTimestamp(seg.timeEnd)}]
                  </span>{" "}
                  {seg.text}
                </div>
              ))}
            </div>
          )}

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
            value={job.text}
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
              segments={job.segments}
              fullText={job.text}
              displayName={displayName}
            />
          </div>

          <AiActions
            key={job.jobId}
            jobId={job.jobId}
            displayName={displayName}
          />

          {/* Delete at bottom */}
          <div
            style={{
              marginTop: 24,
              paddingTop: 16,
              borderTop: "1px solid #f3f4f6",
              display: "flex",
              justifyContent: "flex-end",
            }}
          >
            <Button
              onClick={deleteJob}
              style={{
                fontSize: 12,
                padding: "6px 14px",
                backgroundColor: "#dc2626",
                color: "#fff",
              }}
            >
              Delete this transcription
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
