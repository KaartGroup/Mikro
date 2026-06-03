"use client";

interface DataSource {
  label: string;
  lastSynced: string | null | undefined;
  maxAgeHours: number;
}

interface DataSourceStatusBarProps {
  sources: DataSource[];
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffH = diffMs / (1000 * 60 * 60);
  if (diffH < 1) return `${Math.round(diffH * 60)}m ago`;
  if (diffH < 24) return `${Math.round(diffH)}h ago`;
  return `${Math.round(diffH / 24)}d ago`;
}

function statusColor(iso: string | null | undefined, maxAgeHours: number) {
  if (!iso) return "text-red-600 bg-red-50 border-red-200";
  const diffH = (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60);
  if (diffH <= maxAgeHours * 0.5) return "text-green-700 bg-green-50 border-green-200";
  if (diffH <= maxAgeHours) return "text-yellow-700 bg-yellow-50 border-yellow-200";
  return "text-red-600 bg-red-50 border-red-200";
}

function statusIcon(iso: string | null | undefined, maxAgeHours: number) {
  if (!iso) return "●";
  const diffH = (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60);
  if (diffH <= maxAgeHours * 0.5) return "✓";
  if (diffH <= maxAgeHours) return "⚠";
  return "●";
}

export function DataSourceStatusBar({ sources }: DataSourceStatusBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-muted-foreground font-medium">Data freshness:</span>
      {sources.map((src) => (
        <span
          key={src.label}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border font-medium ${statusColor(src.lastSynced, src.maxAgeHours)}`}
        >
          <span>{statusIcon(src.lastSynced, src.maxAgeHours)}</span>
          <span>{src.label}</span>
          <span className="opacity-70">
            {src.lastSynced ? relativeTime(src.lastSynced) : "never"}
          </span>
        </span>
      ))}
    </div>
  );
}
