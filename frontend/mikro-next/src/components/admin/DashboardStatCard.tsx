"use client";

import Link from "next/link";
import { Card, Skeleton, Tooltip, Val } from "@/components/ui";
import { formatNumber } from "@/lib/utils";
import type { FormattedValue } from "@/lib/utils";

/**
 * Compact stat tile for the admin dashboard density rework (UI5/UI6/UI10).
 *
 * Single row of label + corner link on top, value + optional delta on the
 * bottom. Target height ~80 px — four of these fit comfortably in the
 * horizontal space the old 120 px cards used.
 *
 * Each strip on the dashboard (KPI, Health, Tasks, Payments) reuses this
 * component so the visual rhythm stays consistent.
 */

type DeltaFormat = "number" | "hours" | "currency";

type Severity = "neutral" | "info" | "success" | "warning" | "critical";

interface DashboardStatCardProps {
  label: string;
  value: string | number | FormattedValue;
  /** Optional period-over-period delta. Pass null for stats where a delta is not meaningful. */
  delta?: {
    value: number;
    period: string;
    format?: DeltaFormat;
    /** Direction that counts as "good" for coloring. Defaults to "up". */
    goodDirection?: "up" | "down";
  } | null;
  /** Shown when no delta. e.g. "Awaiting review" / "In organization". */
  subtitle?: string;
  /** Optional detail-page link for the corner icon. */
  href?: string;
  linkLabel?: string;
  /** Drives the value color. Defaults to neutral. */
  severity?: Severity;
  /** Optional hover tooltip on the label. */
  tooltip?: string;
  /** Renders inline skeleton in place of the value. */
  loading?: boolean;
  className?: string;
}

const SEVERITY_TEXT: Record<Severity, string> = {
  neutral: "text-foreground",
  info: "text-kaart-orange",
  success: "text-green-600",
  warning: "text-yellow-600",
  critical: "text-red-600",
};

function formatDeltaValue(n: number, format: DeltaFormat): string {
  const abs = Math.abs(n);
  switch (format) {
    case "hours":
      return `${abs.toFixed(1)}h`;
    case "currency":
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(abs);
    case "number":
    default:
      // formatNumber returns a FormattedValue — pull the .text field.
      return formatNumber(abs).text;
  }
}

function DeltaBadge({
  delta,
}: {
  delta: NonNullable<DashboardStatCardProps["delta"]>;
}) {
  const good = delta.goodDirection ?? "up";
  const dir = delta.value === 0 ? "flat" : delta.value > 0 ? "up" : "down";
  const isGood = dir === "flat" ? null : dir === good;
  const arrow = dir === "up" ? "↑" : dir === "down" ? "↓" : "→";
  const colorClass =
    isGood === null
      ? "text-muted-foreground"
      : isGood
        ? "text-green-600"
        : "text-red-600";
  return (
    <span className={`text-xs font-medium ${colorClass}`}>
      {arrow} {formatDeltaValue(delta.value, delta.format ?? "number")}
      <span className="text-muted-foreground font-normal"> {delta.period}</span>
    </span>
  );
}

export function DashboardStatCard({
  label,
  value,
  delta,
  subtitle,
  href,
  linkLabel,
  severity = "neutral",
  tooltip,
  loading = false,
  className,
}: DashboardStatCardProps) {
  const labelNode = tooltip ? (
    <Tooltip content={tooltip} position="bottom">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </span>
    </Tooltip>
  ) : (
    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
      {label}
    </span>
  );

  const inner = (
    <Card className={`p-0${className ? ` ${className}` : ""}${href ? " hover:bg-accent transition-colors cursor-pointer" : ""}`}>
      <div className="px-4 py-3 flex flex-col gap-1">
        <div className="flex items-start">
          {labelNode}
        </div>
        <div className="flex items-baseline gap-2">
          {loading ? (
            <Skeleton className="h-6 w-16" />
          ) : (
            <span
              className={`text-xl font-bold leading-tight ${SEVERITY_TEXT[severity]}`}
            >
              {typeof value === "object" &&
              value !== null &&
              "isPlaceholder" in value ? (
                <Val>{value}</Val>
              ) : (
                value
              )}
            </span>
          )}
        </div>
        <div className="min-h-[1rem]">
          {!loading && delta && <DeltaBadge delta={delta} />}
          {!loading && !delta && subtitle && (
            <span className="text-xs text-muted-foreground truncate block">{subtitle}</span>
          )}
        </div>
      </div>
    </Card>
  );

  return href ? (
    <Link href={href} aria-label={linkLabel ?? `View ${label} details`} className="block">
      {inner}
    </Link>
  ) : (
    inner
  );
}
