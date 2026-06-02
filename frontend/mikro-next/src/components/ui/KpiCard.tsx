"use client";

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
  className,
  style,
}: KpiCardProps) {
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
  return (
    <Card className={className} style={style} title={tooltip}>
      <CardHeader className="pb-1">
        <CardTitle className="text-[10px] uppercase tracking-wide text-muted-foreground">
          <span className="wrap">{label}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <div
          className="text-lg font-bold tabular-nums truncate"
          title={valueText}
        >
          {value !== null ? (
            <Val>{value}</Val>
          ) : (
            <Skeleton className="h-6 w-20" />
          )}
        </div>
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
  );
}
