"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  Input,
  Select,
} from "@/components/ui";

interface LibraryJob {
  jobId: string;
  jobStatus: string;
  title: string | null;
  fileName: string | null;
  tags: string[];
  duration: number;
  progress: number;
  error: string | null;
  createdAt: string | null;
  completedAt: string | null;
}

const PAGE_SIZE = 20;

function formatDuration(seconds: number): string {
  if (!seconds) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}m ${String(secs).padStart(2, "0")}s`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function displayName(job: LibraryJob): string {
  return job.title || job.fileName || `(unnamed, ${job.jobId})`;
}

export default function TranscribeLibraryPage() {
  const [jobs, setJobs] = useState<LibraryJob[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState<string>("");
  const [sort, setSort] = useState<string>("created_at:desc");
  const [allTags, setAllTags] = useState<string[]>([]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingTitleFor, setEditingTitleFor] = useState<string | null>(null);
  const [editingTagsFor, setEditingTagsFor] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [tagsDraft, setTagsDraft] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (tagFilter) params.set("tag", tagFilter);
      params.set("sort", sort);
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(offset));

      const res = await fetch(`/backend/transcribe/list?${params.toString()}`, {
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok || data.status !== 200) {
        throw new Error(data.message || data.error || "Failed to load jobs");
      }
      setJobs(data.jobs || []);
      setTotal(data.total || 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [query, tagFilter, sort, offset]);

  const loadTags = useCallback(async () => {
    try {
      const res = await fetch("/backend/transcribe/tags", {
        credentials: "include",
      });
      const data = await res.json();
      if (res.ok && data.status === 200) {
        setAllTags(data.tags || []);
      }
    } catch {
      // non-fatal
    }
  }, []);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  useEffect(() => {
    loadTags();
  }, [loadTags]);

  // Debounced search reset page
  const onQueryChange = (v: string) => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setOffset(0);
      setQuery(v);
    }, 300);
  };

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === jobs.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(jobs.map((j) => j.jobId)));
    }
  };

  const startEditTitle = (job: LibraryJob) => {
    setEditingTitleFor(job.jobId);
    setTitleDraft(job.title || job.fileName || "");
    setEditingTagsFor(null);
  };

  const startEditTags = (job: LibraryJob) => {
    setEditingTagsFor(job.jobId);
    setTagsDraft(job.tags.join(", "));
    setEditingTitleFor(null);
  };

  const saveTitle = async (jobId: string) => {
    setBusyId(jobId);
    try {
      const res = await fetch("/backend/transcribe/update", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, title: titleDraft.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok || data.status !== 200) {
        throw new Error(data.message || "Rename failed");
      }
      setEditingTitleFor(null);
      await loadJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const saveTags = async (jobId: string) => {
    setBusyId(jobId);
    try {
      const tags = tagsDraft
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const res = await fetch("/backend/transcribe/update", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, tags }),
      });
      const data = await res.json();
      if (!res.ok || data.status !== 200) {
        throw new Error(data.message || "Retag failed");
      }
      setEditingTagsFor(null);
      await Promise.all([loadJobs(), loadTags()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const deleteOne = async (jobId: string) => {
    if (!confirm("Delete this transcription? This cannot be undone.")) return;
    setBusyId(jobId);
    try {
      const res = await fetch("/backend/transcribe/delete", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobIds: [jobId] }),
      });
      const data = await res.json();
      if (!res.ok || data.status !== 200) {
        throw new Error(data.message || "Delete failed");
      }
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(jobId);
        return next;
      });
      await loadJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const deleteBulk = async () => {
    if (selectedIds.size === 0) return;
    if (
      !confirm(
        `Delete ${selectedIds.size} transcription${selectedIds.size === 1 ? "" : "s"}? This cannot be undone.`,
      )
    )
      return;
    setBulkBusy(true);
    try {
      const res = await fetch("/backend/transcribe/delete", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobIds: Array.from(selectedIds) }),
      });
      const data = await res.json();
      if (!res.ok || data.status !== 200) {
        throw new Error(data.message || "Bulk delete failed");
      }
      setSelectedIds(new Set());
      await loadJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBulkBusy(false);
    }
  };

  const allSelected = useMemo(
    () => jobs.length > 0 && selectedIds.size === jobs.length,
    [jobs, selectedIds],
  );

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <Link
          href="/admin/transcribe"
          style={{ fontSize: 13, color: "#666", textDecoration: "none" }}
        >
          ← Back to Transcribe
        </Link>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <h1
          style={{ fontSize: 26, fontWeight: 700, margin: 0, color: "#1a1a1a" }}
        >
          Transcript Library
        </h1>
        <Badge variant="outline" style={{ fontSize: 11 }}>
          {total} total
        </Badge>
      </div>

      {/* Controls */}
      <Card style={{ marginBottom: 16 }}>
        <CardContent>
          <div
            style={{
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
              alignItems: "center",
              padding: "12px 0",
            }}
          >
            <div style={{ flex: "1 1 260px", minWidth: 200 }}>
              <Input
                type="text"
                placeholder="Search by title or filename…"
                defaultValue={query}
                onChange={(e) => onQueryChange(e.target.value)}
              />
            </div>
            <div style={{ minWidth: 160 }}>
              <Select
                value={tagFilter}
                onChange={(v) => {
                  setOffset(0);
                  setTagFilter(v);
                }}
                options={[
                  { value: "", label: "All tags" },
                  ...allTags.map((t) => ({ value: t, label: t })),
                ]}
                placeholder="All tags"
              />
            </div>
            <div style={{ minWidth: 180 }}>
              <Select
                value={sort}
                onChange={(v) => {
                  setOffset(0);
                  setSort(v);
                }}
                options={[
                  { value: "created_at:desc", label: "Newest first" },
                  { value: "created_at:asc", label: "Oldest first" },
                  { value: "duration:desc", label: "Longest audio" },
                  { value: "duration:asc", label: "Shortest audio" },
                  { value: "title:asc", label: "Title A → Z" },
                  { value: "title:desc", label: "Title Z → A" },
                ]}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bulk bar */}
      {selectedIds.size > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "10px 14px",
            marginBottom: 12,
            borderRadius: 8,
            backgroundColor: "#fff7ed",
            border: "1px solid #fed7aa",
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 500, color: "#9a3412" }}>
            {selectedIds.size} selected
          </span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <Button
              variant="outline"
              onClick={() => setSelectedIds(new Set())}
              style={{ fontSize: 12, padding: "6px 12px" }}
            >
              Clear
            </Button>
            <Button
              onClick={deleteBulk}
              disabled={bulkBusy}
              style={{
                fontSize: 12,
                padding: "6px 12px",
                backgroundColor: "#dc2626",
                color: "#fff",
              }}
            >
              {bulkBusy ? "Deleting…" : `Delete ${selectedIds.size}`}
            </Button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          style={{
            padding: "10px 14px",
            marginBottom: 12,
            borderRadius: 8,
            backgroundColor: "#fef2f2",
            border: "1px solid #fca5a5",
            color: "#dc2626",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {/* List */}
      <Card>
        <CardHeader>
          <CardTitle
            style={{
              fontSize: 15,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <input
              type="checkbox"
              checked={allSelected}
              onChange={selectAll}
              disabled={jobs.length === 0}
            />
            <span>
              {loading
                ? "Loading…"
                : jobs.length === 0
                  ? "No transcriptions"
                  : `${jobs.length} shown`}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 && !loading && (
            <div
              style={{
                textAlign: "center",
                padding: "40px 0",
                color: "#999",
                fontSize: 14,
              }}
            >
              No transcriptions match your filters.
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {jobs.map((job) => {
              const selected = selectedIds.has(job.jobId);
              const isEditingTitle = editingTitleFor === job.jobId;
              const isEditingTags = editingTagsFor === job.jobId;
              return (
                <div
                  key={job.jobId}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 12,
                    padding: "12px 10px",
                    borderRadius: 8,
                    backgroundColor: selected ? "#f0f7ff" : "transparent",
                    borderBottom: "1px solid #f3f4f6",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleSelect(job.jobId)}
                    style={{ marginTop: 4 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Title row */}
                    {isEditingTitle ? (
                      <div
                        style={{
                          display: "flex",
                          gap: 6,
                          alignItems: "center",
                        }}
                      >
                        <input
                          type="text"
                          value={titleDraft}
                          onChange={(e) => setTitleDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveTitle(job.jobId);
                            if (e.key === "Escape") setEditingTitleFor(null);
                          }}
                          autoFocus
                          style={{
                            flex: 1,
                            padding: "6px 8px",
                            fontSize: 14,
                            fontWeight: 600,
                            border: "1px solid #d1d5db",
                            borderRadius: 6,
                          }}
                        />
                        <Button
                          onClick={() => saveTitle(job.jobId)}
                          disabled={busyId === job.jobId}
                          style={{
                            fontSize: 11,
                            padding: "4px 10px",
                            backgroundColor: "#004e89",
                            color: "#fff",
                          }}
                        >
                          Save
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => setEditingTitleFor(null)}
                          style={{ fontSize: 11, padding: "4px 10px" }}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <div
                        onClick={() => startEditTitle(job)}
                        title="Click to rename"
                        style={{
                          fontSize: 15,
                          fontWeight: 600,
                          color: "#1a1a1a",
                          cursor: "pointer",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {displayName(job)}
                      </div>
                    )}

                    {/* Meta row */}
                    <div
                      style={{
                        display: "flex",
                        gap: 10,
                        fontSize: 12,
                        color: "#888",
                        marginTop: 4,
                        flexWrap: "wrap",
                      }}
                    >
                      <span>{formatDate(job.createdAt)}</span>
                      <span>·</span>
                      <span>{formatDuration(job.duration)} audio</span>
                      {job.jobStatus !== "done" && (
                        <>
                          <span>·</span>
                          <Badge variant="outline" style={{ fontSize: 10 }}>
                            {job.jobStatus}
                          </Badge>
                        </>
                      )}
                    </div>

                    {/* Tags row */}
                    {isEditingTags ? (
                      <div
                        style={{
                          display: "flex",
                          gap: 6,
                          alignItems: "center",
                          marginTop: 6,
                        }}
                      >
                        <input
                          type="text"
                          value={tagsDraft}
                          onChange={(e) => setTagsDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveTags(job.jobId);
                            if (e.key === "Escape") setEditingTagsFor(null);
                          }}
                          placeholder="comma,separated,tags"
                          autoFocus
                          style={{
                            flex: 1,
                            padding: "4px 8px",
                            fontSize: 12,
                            border: "1px solid #d1d5db",
                            borderRadius: 6,
                          }}
                        />
                        <Button
                          onClick={() => saveTags(job.jobId)}
                          disabled={busyId === job.jobId}
                          style={{
                            fontSize: 11,
                            padding: "3px 10px",
                            backgroundColor: "#004e89",
                            color: "#fff",
                          }}
                        >
                          Save
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => setEditingTagsFor(null)}
                          style={{ fontSize: 11, padding: "3px 10px" }}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <div
                        onClick={() => startEditTags(job)}
                        title="Click to edit tags"
                        style={{
                          marginTop: 6,
                          display: "flex",
                          gap: 6,
                          flexWrap: "wrap",
                          cursor: "pointer",
                          minHeight: 20,
                        }}
                      >
                        {job.tags.length === 0 ? (
                          <span
                            style={{
                              fontSize: 11,
                              color: "#bbb",
                              fontStyle: "italic",
                            }}
                          >
                            + add tags
                          </span>
                        ) : (
                          job.tags.map((t) => (
                            <span
                              key={t}
                              style={{
                                padding: "2px 8px",
                                fontSize: 11,
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

                  {/* Actions */}
                  <div
                    style={{ display: "flex", gap: 6, alignItems: "center" }}
                  >
                    <Link
                      href={`/admin/transcribe/library/${job.jobId}`}
                      style={{
                        fontSize: 12,
                        padding: "6px 12px",
                        textDecoration: "none",
                        color: "#004e89",
                        border: "1px solid #004e89",
                        borderRadius: 6,
                      }}
                    >
                      View
                    </Link>
                    <button
                      onClick={() => deleteOne(job.jobId)}
                      disabled={busyId === job.jobId}
                      title="Delete"
                      style={{
                        padding: "6px 10px",
                        fontSize: 12,
                        border: "1px solid #fca5a5",
                        color: "#dc2626",
                        borderRadius: 6,
                        backgroundColor: "#fff",
                        cursor: "pointer",
                      }}
                    >
                      {busyId === job.jobId ? "…" : "Delete"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {total > PAGE_SIZE && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: 16,
                padding: "12px 4px",
                borderTop: "1px solid #f3f4f6",
              }}
            >
              <span style={{ fontSize: 12, color: "#666" }}>
                Page {currentPage} of {pageCount} · {total} total
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <Button
                  variant="outline"
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  disabled={offset === 0}
                  style={{ fontSize: 12, padding: "6px 12px" }}
                >
                  ← Prev
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                  disabled={offset + PAGE_SIZE >= total}
                  style={{ fontSize: 12, padding: "6px 12px" }}
                >
                  Next →
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
