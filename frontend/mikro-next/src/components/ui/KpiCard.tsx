"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
  Val,
} from "@/components/ui";
import type { FormattedValue } from "@/lib/utils";
import type { CSSProperties } from "react";

interface KpiCardProps {
  label: string;
  value: FormattedValue | string | null;
  subtitle: string;
  tooltip?: string;
  trend?: {
    dir: "up" | "down" | "flat";
    text: string;
  };
  /** Pre-computed % delta vs compare period (positive = up, negative = down). */
  delta?: number | null;
  /** When true, the value exceeds ±1σ from the compare period distribution. */
  anomalyFlag?: boolean;
  /** Transparency text shown in a click-triggered pop-up (ⓘ). */
  info?: string;
  /** Optional class passed to the outer Card (e.g. `w-44`). */
  className?: string;
  /** Optional inline style for the outer Card. */
  style?: CSSProperties;
}

export function KpiCard({
  label,
  value,
  subtitle,
  tooltip,
  trend,
  delta,
  anomalyFlag,
  info,
  className,
  style,
}: KpiCardProps) {
  const [infoOpen, setInfoOpen] = useState(false);

  const trendColor =
    trend?.dir === "up"
      ? "text-green-600 dark:text-green-400 bg-green-100/60 dark:bg-green-900/30"
      : trend?.dir === "down"
        ? "text-red-600 dark:text-red-400 bg-red-100/60 dark:bg-red-900/30"
        : "text-muted-foreground bg-muted/50";
  const trendArrow =
    trend?.dir === "up" ? "↑" : trend?.dir === "down" ? "↓" : "→";
  const valueText =
    value == null ? undefined : typeof value === "string" ? value : value.text;

  const deltaColor =
    delta == null
      ? ""
      : delta > 0
        ? "text-green-600"
        : delta < 0
          ? "text-red-500"
          : "text-muted-foreground";
  const deltaArrow = delta == null ? "" : delta > 0 ? "▲" : delta < 0 ? "▼" : "→";

  return (
    <>
      <Card className={className} style={style} title={tooltip}>
        <CardHeader className="pb-1">
          <CardTitle className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
            <span className="wrap">{label}</span>
            {info && (
              <button
                onClick={() => setInfoOpen(true)}
                className="text-muted-foreground hover:text-foreground transition-colors leading-none"
                aria-label={`Info: ${label}`}
              >
                ⓘ
              </button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <div
            className="text-lg font-bold tabular-nums truncate flex items-center gap-1"
            title={valueText}
          >
            {value !== null ? (
              <Val>{value}</Val>
            ) : (
              <Skeleton className="h-6 w-20" />
            )}
            {anomalyFlag && (
              <span
                className="text-orange-500 text-sm leading-none"
                title="Value exceeds ±1σ from comparison period"
              >
                ⚠
              </span>
            )}
          </div>
          {delta != null && (
            <span className={`text-[10px] font-medium ${deltaColor}`}>
              {deltaArrow} {Math.abs(delta).toFixed(1)}% vs prior
            </span>
          )}
          {trend && (
            <span
              className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${trendColor}`}
            >
              {trendArrow} {trend.text}
            </span>
          )}
          <div
            className="text-[10px] text-muted-foreground truncate"
            title={subtitle}
          >
            {subtitle}
          </div>
        </CardContent>
      </Card>

      {infoOpen && info && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
          onClick={() => setInfoOpen(false)}
        >
          <div
            className="bg-card border border-border rounded-xl shadow-xl max-w-sm mx-4 p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-2">
              <h3 className="text-sm font-semibold text-foreground">{label}</h3>
              <button
                onClick={() => setInfoOpen(false)}
                className="text-muted-foreground hover:text-foreground ml-4 leading-none"
              >
                ✕
              </button>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">{info}</p>
          </div>
        </div>
      )}
    </>
  );
}
