"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Button, Input, Select } from "@/components/ui";
import type { AssignedProject } from "@/types";

type SortKey =
  | "name"
  | "status"
  | "task_count"
  | "hours_logged"
  | "last_worked_on";
type SortDir = "asc" | "desc";

const ROWS_PER_PAGE = 10;

function formatHours(h: number): string {
  if (h <= 0) return "—";
  return h.toFixed(1);
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((now - then) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  const diffMo = Math.floor(diffDay / 30);
  if (diffMo < 12) return `${diffMo}mo ago`;
  const diffYr = Math.floor(diffDay / 365);
  return `${diffYr}y ago`;
}

function formatAbsolute(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Never";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Last-worked sort: rows that have never been worked on (null) always sort
 * to the bottom regardless of direction — null is "less interesting" than
 * any real timestamp, asc or desc.
 */
function compareLastWorked(
  a: AssignedProject,
  b: AssignedProject,
  dir: SortDir,
): number {
  const aVal = a.last_worked_on ? new Date(a.last_worked_on).getTime() : null;
  const bVal = b.last_worked_on ? new Date(b.last_worked_on).getTime() : null;
  if (aVal === null && bVal === null) return 0;
  if (aVal === null) return 1;
  if (bVal === null) return -1;
  return dir === "asc" ? aVal - bVal : bVal - aVal;
}

interface Props {
  projects: AssignedProject[];
}

export function AssignedProjectsTable({ projects }: Props) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "active" | "inactive"
  >("all");
  const [activityFilter, setActivityFilter] = useState<
    "any" | "worked" | "never"
  >("any");
  const [sortKey, setSortKey] = useState<SortKey>("last_worked_on");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects.filter((p) => {
      if (q) {
        const label = (p.short_name || p.name || "").toLowerCase();
        if (!label.includes(q)) return false;
      }
      if (statusFilter === "active" && p.status === false) return false;
      if (statusFilter === "inactive" && p.status !== false) return false;
      if (activityFilter === "worked" && p.hours_logged <= 0) return false;
      if (activityFilter === "never" && p.hours_logged > 0) return false;
      return true;
    });
  }, [projects, search, statusFilter, activityFilter]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name": {
          const an = (a.short_name || a.name || "").toLowerCase();
          const bn = (b.short_name || b.name || "").toLowerCase();
          cmp = an.localeCompare(bn);
          break;
        }
        case "status": {
          // active (true or null) before inactive (false)
          const av = a.status === false ? 1 : 0;
          const bv = b.status === false ? 1 : 0;
          cmp = av - bv;
          break;
        }
        case "task_count":
          cmp = (a.task_count || 0) - (b.task_count || 0);
          break;
        case "hours_logged":
          cmp = (a.hours_logged || 0) - (b.hours_logged || 0);
          break;
        case "last_worked_on":
          return compareLastWorked(a, b, sortDir);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / ROWS_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const pageRows = sorted.slice(
    (safePage - 1) * ROWS_PER_PAGE,
    safePage * ROWS_PER_PAGE,
  );

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" || key === "status" ? "asc" : "desc");
    }
    setPage(1);
  }

  function sortIndicator(key: SortKey): string {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " ↑" : " ↓";
  }

  if (projects.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No projects assigned to this user.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="text"
          placeholder="Search projects..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="max-w-xs"
          aria-label="Search assigned projects"
        />
        <Select
          value={statusFilter}
          onChange={(v) => {
            setStatusFilter(v as typeof statusFilter);
            setPage(1);
          }}
          options={[
            { value: "all", label: "All statuses" },
            { value: "active", label: "Active only" },
            { value: "inactive", label: "Inactive only" },
          ]}
        />
        <Select
          value={activityFilter}
          onChange={(v) => {
            setActivityFilter(v as typeof activityFilter);
            setPage(1);
          }}
          options={[
            { value: "any", label: "Any activity" },
            { value: "worked", label: "Worked on" },
            { value: "never", label: "Never worked on" },
          ]}
        />
        <span className="text-sm text-muted-foreground ml-auto">
          {sorted.length} of {projects.length}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth: 680 }}>
          <thead className="bg-muted border-b border-border">
            <tr>
              <th
                className="px-4 py-2 text-left font-semibold text-muted-foreground cursor-pointer select-none hover:text-foreground"
                onClick={() => handleSort("name")}
              >
                Project{sortIndicator("name")}
              </th>
              <th
                className="px-4 py-2 text-left font-semibold text-muted-foreground cursor-pointer select-none hover:text-foreground"
                onClick={() => handleSort("status")}
              >
                Status{sortIndicator("status")}
              </th>
              <th
                className="px-4 py-2 text-right font-semibold text-muted-foreground cursor-pointer select-none hover:text-foreground"
                onClick={() => handleSort("task_count")}
              >
                Tasks{sortIndicator("task_count")}
              </th>
              <th
                className="px-4 py-2 text-right font-semibold text-muted-foreground cursor-pointer select-none hover:text-foreground"
                onClick={() => handleSort("hours_logged")}
              >
                Hours{sortIndicator("hours_logged")}
              </th>
              <th
                className="px-4 py-2 text-left font-semibold text-muted-foreground cursor-pointer select-none hover:text-foreground"
                onClick={() => handleSort("last_worked_on")}
              >
                Last worked{sortIndicator("last_worked_on")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {pageRows.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-6 text-center text-sm text-muted-foreground"
                >
                  No projects match the current filters.
                </td>
              </tr>
            ) : (
              pageRows.map((p) => (
                <tr
                  key={p.id}
                  className={p.status === false ? "opacity-60" : ""}
                >
                  <td className="px-4 py-2">
                    <Link
                      href={`/admin/projects/${p.id}`}
                      className="inline-flex items-center gap-1.5 hover:text-kaart-orange hover:underline"
                    >
                      {p.short_name || p.name}
                      {p.source === "mr" && (
                        <span className="text-[10px] font-medium px-1 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                          MR
                        </span>
                      )}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    {p.status === false ? (
                      <span className="text-muted-foreground">Inactive</span>
                    ) : (
                      <span className="text-green-600">Active</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right font-mono">
                    {p.task_count || 0}
                  </td>
                  <td className="px-4 py-2 text-right font-mono">
                    {formatHours(p.hours_logged)}
                  </td>
                  <td
                    className="px-4 py-2 text-muted-foreground"
                    title={formatAbsolute(p.last_worked_on)}
                  >
                    {formatRelative(p.last_worked_on)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {sorted.length > ROWS_PER_PAGE && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Showing {(safePage - 1) * ROWS_PER_PAGE + 1}-
            {Math.min(safePage * ROWS_PER_PAGE, sorted.length)} of{" "}
            {sorted.length}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={safePage === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <span className="flex items-center px-2">
              Page {safePage} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
