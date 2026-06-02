"use client";

import { cn } from "@/lib/utils";

interface FilterChipProps {
  dimensionLabel: string;
  selectedLabels: string[];
  onRemove: () => void;
  onClick: () => void;
}

export function FilterChip({
  dimensionLabel,
  selectedLabels,
  onRemove,
  onClick,
}: FilterChipProps) {
  const displayText =
    selectedLabels.length <= 2
      ? selectedLabels.join(", ")
      : `${selectedLabels.slice(0, 2).join(", ")} +${selectedLabels.length - 2}`;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-sm text-foreground",
        "cursor-pointer transition-colors hover:bg-muted/80",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1"
      >
        <span className="font-medium">{dimensionLabel}:</span>
        <span className="text-muted-foreground">{displayText}</span>
      </button>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
        aria-label={`Remove ${dimensionLabel} filter`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </span>
  );
}
