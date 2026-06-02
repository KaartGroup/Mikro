"use client";

import { useCallback } from "react";
import { exportChartAsPng, todayIso } from "@/lib/chartExport";

/**
 * Small PNG-export button for Recharts chart containers. Caller wraps
 * their chart in a div + ref and passes the ref here.
 *
 * Filename convention: `mikro-<name>-<YYYY-MM-DD>.png` so repeat
 * exports on the same chart don't collide for the user.
 */
interface Props {
  containerRef: React.RefObject<HTMLElement | null>;
  /** Human-readable filename stem, e.g. "editing-tasks-over-time". */
  filename: string;
  className?: string;
}

export function ChartExportButton({
  containerRef,
  filename,
  className,
}: Props) {
  const onClick = useCallback(() => {
    exportChartAsPng(
      containerRef.current,
      `mikro-${filename}-${todayIso()}.png`,
    );
  }, [containerRef, filename]);

  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-kaart-orange transition-colors px-2 py-1 rounded border border-border hover:border-kaart-orange bg-background/80" +
        (className ? ` ${className}` : "")
      }
      title="Download chart as PNG"
      aria-label="Download chart as PNG"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-3.5 h-3.5"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      PNG
    </button>
  );
}
