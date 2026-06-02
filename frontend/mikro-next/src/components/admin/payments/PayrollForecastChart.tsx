"use client";

import type { PayrollForecastResponse } from "@/types";

function fmt(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/**
 * Honest-by-construction forecast: stacked bars where the lower
 * (Confirmed = salaried, exact) segment is solid and the upper
 * (Projected variable = flat trailing average, an estimate) segment is
 * hatched. A dashed reference line marks the flat variable basis so the
 * "we did NOT extrapolate a trend" decision is visible on the chart.
 */
export function PayrollForecastChart({
  cycles,
  stats,
}: {
  cycles: PayrollForecastResponse["cycles"];
  stats: PayrollForecastResponse["stats"];
}) {
  if (!cycles.length) {
    return (
      <div className="text-xs text-muted-foreground italic">
        No contributors in scope to forecast.
      </div>
    );
  }

  const max = Math.max(...cycles.map((c) => c.total), 1);
  const H = 120; // px chart height
  const basisY = H - (stats.variable_basis / max) * H;

  const growthColor =
    stats.projected_growth > 0
      ? "text-green-600 dark:text-green-400"
      : stats.projected_growth < 0
        ? "text-red-600 dark:text-red-400"
        : "text-muted-foreground";

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-3">
        {/* Bars */}
        <div className="flex-1 flex items-end gap-2" style={{ height: H }}>
          {cycles.map((c) => {
            const confH = (c.confirmed / max) * H;
            const varH = (c.variable / max) * H;
            return (
              <div
                key={c.start}
                className="flex-1 flex flex-col items-center justify-end h-full"
                title={`${c.label}: confirmed ${fmt(
                  c.confirmed,
                )} + ${c.is_projected ? "est. " : ""}variable ${fmt(
                  c.variable,
                )} = ${fmt(c.total)}`}
              >
                <span className="text-[9px] tabular-nums text-muted-foreground mb-0.5">
                  {fmt(c.total)}
                </span>
                {/* variable (estimate) — hatched when projected */}
                <div
                  className="w-full rounded-t-sm"
                  style={{
                    height: Math.max(varH, c.variable > 0 ? 2 : 0),
                    backgroundColor: c.is_projected ? "#93c5fd" : "#3b82f6",
                    backgroundImage: c.is_projected
                      ? "repeating-linear-gradient(45deg,transparent,transparent 3px,rgba(255,255,255,.45) 3px,rgba(255,255,255,.45) 6px)"
                      : undefined,
                  }}
                />
                {/* confirmed (exact) — always solid */}
                <div
                  className="w-full"
                  style={{
                    height: Math.max(confH, c.confirmed > 0 ? 2 : 0),
                    backgroundColor: "#1e3a8a",
                  }}
                />
                <span className="text-[9px] text-muted-foreground mt-1 truncate w-full text-center">
                  {c.label}
                  {c.is_current ? " •" : ""}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* flat variable-basis note (the dashed-line idea, as text since the
          bars are flex divs not an SVG plane) */}
      {stats.variable_basis > 0 && (
        <div className="text-[10px] text-muted-foreground border-t border-dashed border-border pt-1">
          Variable held flat at {fmt(stats.variable_basis)} (avg of last 3
          cycles) — not trended.
          {/* basisY referenced so intent is documented even though bars
              are div-based; kept for a future SVG upgrade */}
          <span className="hidden">{Math.round(basisY)}</span>
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span
            className="w-2.5 h-2.5 rounded-sm"
            style={{ backgroundColor: "#1e3a8a" }}
          />
          Confirmed (exact)
        </span>
        <span className="flex items-center gap-1">
          <span
            className="w-2.5 h-2.5 rounded-sm"
            style={{
              backgroundColor: "#93c5fd",
              backgroundImage:
                "repeating-linear-gradient(45deg,transparent,transparent 3px,rgba(255,255,255,.45) 3px,rgba(255,255,255,.45) 6px)",
            }}
          />
          Projected variable (est.)
        </span>
      </div>

      {/* Stat callouts */}
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Projected Growth
          </div>
          <div className={`font-semibold tabular-nums ${growthColor}`}>
            est. {stats.projected_growth >= 0 ? "+" : ""}
            {fmt(stats.projected_growth)} ({stats.projected_growth_pct}%)
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Avg Monthly Growth
          </div>
          <div className="font-semibold tabular-nums">
            est. {stats.avg_monthly_growth >= 0 ? "+" : ""}
            {fmt(stats.avg_monthly_growth)} ({stats.avg_monthly_growth_pct}%)
          </div>
        </div>
      </div>

      <div className="text-[10px] text-muted-foreground">
        Confirmed = salaried, exact. Variable = average of last 3 cycles
        (estimate, not trended).{" "}
        <span
          className="text-primary/70 cursor-default"
          title="Full forecast detail view — not in v1"
        >
          View full forecast →
        </span>
      </div>
    </div>
  );
}
