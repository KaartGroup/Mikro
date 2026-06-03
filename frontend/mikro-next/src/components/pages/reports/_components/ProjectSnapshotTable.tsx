"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";

interface ProjectRow {
  id: number;
  name: string;
  url: string;
  total_tasks: number;
  tasks_mapped: number;
  tasks_validated: number;
  percent_mapped: number;
  status: boolean;
}

interface ProjectSnapshotTableProps {
  projects: ProjectRow[];
}

function statusBadge(pct: number) {
  if (pct === 0) return "bg-red-100 text-red-700";
  if (pct >= 100) return "bg-green-100 text-green-700";
  return "bg-yellow-100 text-yellow-700";
}

function statusLabel(pct: number) {
  if (pct === 0) return "Not started";
  if (pct >= 100) return "Complete";
  return "In progress";
}

type SortKey = "name" | "total_tasks" | "tasks_mapped" | "pct";

export function ProjectSnapshotTable({ projects }: ProjectSnapshotTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("pct");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(() => {
    const rows = projects.map((p) => ({
      ...p,
      pct: p.total_tasks > 0 ? Math.round((p.tasks_mapped / p.total_tasks) * 100) : 0,
      remaining: Math.max(0, p.total_tasks - p.tasks_mapped),
    }));
    rows.sort((a, b) => {
      const av = a[sortKey as keyof typeof a] as number | string;
      const bv = b[sortKey as keyof typeof b] as number | string;
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return rows;
  }, [projects, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function sortIndicator(key: SortKey) {
    if (key !== sortKey) return null;
    return <span className="ml-1 opacity-60">{sortDir === "asc" ? "↑" : "↓"}</span>;
  }

  if (projects.length === 0) {
    return (
      <Card>
        <CardHeader className="px-4 pt-4 pb-0">
          <CardTitle className="text-base">Project Snapshot</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground text-center py-8">
            No project data for this period.
          </p>
        </CardContent>
      </Card>
    );
  }

  const thClass =
    "px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide cursor-pointer select-none hover:text-foreground transition-colors whitespace-nowrap";
  const tdClass = "px-3 py-2 text-sm";

  return (
    <Card>
      <CardHeader className="px-4 pt-4 pb-0">
        <CardTitle className="text-base">Project Snapshot</CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-2 pt-2">
        <div className="overflow-auto max-h-72">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-card z-10">
              <tr className="border-b border-border">
                <th className={thClass} onClick={() => handleSort("name")}>
                  Project{sortIndicator("name")}
                </th>
                <th className={`${thClass} text-right`} onClick={() => handleSort("total_tasks")}>
                  Total Tasks{sortIndicator("total_tasks")}
                </th>
                <th className={`${thClass} text-right`} onClick={() => handleSort("tasks_mapped")}>
                  Completed{sortIndicator("tasks_mapped")}
                </th>
                <th className={`${thClass} text-right`}>Remaining</th>
                <th className={`${thClass} text-right`} onClick={() => handleSort("pct")}>
                  % Complete{sortIndicator("pct")}
                </th>
                <th className={thClass}>Status</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p, i) => (
                <tr
                  key={p.id}
                  className={`border-b border-border last:border-0 ${i % 2 === 0 ? "" : "bg-muted/30"}`}
                >
                  <td className={tdClass}>
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-foreground hover:underline font-medium"
                    >
                      {p.name}
                    </a>
                  </td>
                  <td className={`${tdClass} text-right tabular-nums`}>
                    {p.total_tasks.toLocaleString()}
                  </td>
                  <td className={`${tdClass} text-right tabular-nums`}>
                    {p.tasks_mapped.toLocaleString()}
                  </td>
                  <td className={`${tdClass} text-right tabular-nums text-muted-foreground`}>
                    {p.remaining.toLocaleString()}
                  </td>
                  <td className={`${tdClass} text-right tabular-nums`}>
                    <span className="font-medium">{p.pct}%</span>
                  </td>
                  <td className={tdClass}>
                    <span
                      className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge(p.pct)}`}
                    >
                      {statusLabel(p.pct)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
