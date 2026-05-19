"use client";

import type { ProjectDispensationResponse } from "@/types";

function fmt(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/**
 * Per-project Budget / Distributed / Remaining with a progress bar.
 * Budget = Project.max_payment (Mikro's payment cap — a proxy for
 * "budget", pending Logan's confirmation). Distributed =
 * Project.total_payout. Real data; will read $0 distributed until
 * payouts are recorded.
 */
export function ProjectDispensationCard({
  data,
}: {
  data: ProjectDispensationResponse;
}) {
  if (!data.projects.length) {
    return (
      <div className="text-xs text-muted-foreground italic">
        No budgeted projects in scope.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-2 text-xs items-center">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground" />
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground text-right">
          Budget
        </span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground text-right">
          Distributed
        </span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground text-right">
          Remaining
        </span>

        {data.projects.map((p) => {
          const pct =
            p.budget > 0
              ? Math.min(100, Math.round((p.distributed / p.budget) * 100))
              : 0;
          return (
            <div key={p.id} className="contents">
              <div className="min-w-0">
                <div className="truncate" title={p.name}>
                  {p.name}
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden mt-0.5">
                  <div
                    className="h-full bg-emerald-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
              <span className="tabular-nums text-right">{fmt(p.budget)}</span>
              <span className="tabular-nums text-right">
                {fmt(p.distributed)}
              </span>
              <span className="tabular-nums text-right text-muted-foreground">
                {fmt(p.remaining)}
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex justify-between items-center border-t border-border pt-2 text-xs">
        <span className="text-muted-foreground">
          {data.project_count} project{data.project_count === 1 ? "" : "s"}
        </span>
        <span className="tabular-nums">
          {fmt(data.totals.distributed)} / {fmt(data.totals.budget)}{" "}
          distributed
        </span>
      </div>

      <div className="text-[10px] text-muted-foreground">
        Budget = project payment cap (max_payment). Distributed = recorded
        payouts.{" "}
        <span
          className="text-primary/70 cursor-default"
          title="Full project list — not in v1"
        >
          View all projects →
        </span>
      </div>
    </div>
  );
}
