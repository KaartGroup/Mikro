"use client";

import { useEffect, useRef, useState } from "react";

interface ColumnsMenuProps {
  columns: { key: string; label: string }[];
  /** Currently hidden column keys. */
  hidden: Set<string>;
  onToggle: (key: string) => void;
  onShowAll: () => void;
}

/**
 * Show/hide table columns. Existing columns only; resets each visit
 * (parent holds the state with no persistence — can be persisted later
 * if needed). Contributor is intentionally not in `columns` — it's the
 * row identity and always shown.
 */
export function ColumnsMenu({
  columns,
  hidden,
  onToggle,
  onShowAll,
}: ColumnsMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const hiddenCount = hidden.size;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="px-3 py-1.5 rounded-md border border-border bg-muted/30 text-sm flex items-center gap-1.5 hover:bg-muted/50 transition-colors"
      >
        Columns
        {hiddenCount > 0 && (
          <span className="inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px]">
            {hiddenCount}
          </span>
        )}
        <span className="text-xs text-muted-foreground">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-1 w-56 rounded-md border border-border bg-background shadow-lg p-2">
          <div className="flex items-center justify-between px-2 pb-1.5">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Show columns
            </span>
            <button
              type="button"
              onClick={onShowAll}
              disabled={hiddenCount === 0}
              className="text-xs text-primary hover:underline disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
            >
              Show all
            </button>
          </div>
          {columns.map((c) => {
            const visible = !hidden.has(c.key);
            return (
              <label
                key={c.key}
                className="flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-muted/60 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={visible}
                  onChange={() => onToggle(c.key)}
                />
                {c.label}
              </label>
            );
          })}
          <div className="px-2 pt-1.5 text-[10px] text-muted-foreground">
            Contributor is always shown. Resets when you leave the page.
          </div>
        </div>
      )}
    </div>
  );
}
