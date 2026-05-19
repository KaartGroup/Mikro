"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";

// ─── date helpers (self-contained; mirror page.tsx) ─────────────────
function firstOfMonthIso(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function lastOfMonthIso(d = new Date()): string {
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-${String(
    last.getDate(),
  ).padStart(2, "0")}`;
}
function firstOfLastMonthIso(d = new Date()): string {
  return firstOfMonthIso(new Date(d.getFullYear(), d.getMonth() - 1, 1));
}
function lastOfLastMonthIso(d = new Date()): string {
  return lastOfMonthIso(new Date(d.getFullYear(), d.getMonth() - 1, 1));
}

interface CyclePickerProps {
  cycleStart: string;
  cycleEnd: string;
  onChange: (start: string, end: string) => void;
}

export function CyclePicker({ cycleStart, cycleEnd, onChange }: CyclePickerProps) {
  const [open, setOpen] = useState(false);
  const [customStart, setCustomStart] = useState(cycleStart);
  const [customEnd, setCustomEnd] = useState(cycleEnd);
  const ref = useRef<HTMLDivElement>(null);

  // Keep custom inputs synced when the cycle changes from elsewhere.
  useEffect(() => {
    setCustomStart(cycleStart);
    setCustomEnd(cycleEnd);
  }, [cycleStart, cycleEnd]);

  // Close on click-outside.
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

  const thisMonth = { s: firstOfMonthIso(), e: lastOfMonthIso() };
  const lastMonth = { s: firstOfLastMonthIso(), e: lastOfLastMonthIso() };
  const isThisMonth = cycleStart === thisMonth.s && cycleEnd === thisMonth.e;
  const isLastMonth = cycleStart === lastMonth.s && cycleEnd === lastMonth.e;
  const isCustom = !isThisMonth && !isLastMonth;

  const cycleLabel = (() => {
    const d = new Date(cycleStart + "T00:00:00");
    return `${d.toLocaleString("en-US", { month: "long", year: "numeric" })} Payroll Cycle`;
  })();

  const apply = (s: string, e: string) => {
    onChange(s, e);
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="px-3 py-1.5 rounded-md border border-border bg-muted/30 text-sm flex items-center gap-2 hover:bg-muted/50 transition-colors text-left"
      >
        <span className="flex flex-col leading-tight">
          <span className="text-xs text-muted-foreground">{cycleLabel}</span>
          <span className="font-medium">
            {cycleStart} → {cycleEnd}
          </span>
        </span>
        <span className="text-xs text-muted-foreground">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-1 w-72 rounded-md border border-border bg-background shadow-lg p-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground px-2 pt-1 pb-1.5">
            Quick select
          </div>
          <button
            type="button"
            onClick={() => apply(thisMonth.s, thisMonth.e)}
            className={`w-full text-left px-2 py-1.5 rounded text-sm transition-colors ${
              isThisMonth
                ? "bg-primary text-primary-foreground"
                : "hover:bg-muted/60"
            }`}
          >
            This Month
            <span className="ml-2 text-xs opacity-70">
              {thisMonth.s} → {thisMonth.e}
            </span>
          </button>
          <button
            type="button"
            onClick={() => apply(lastMonth.s, lastMonth.e)}
            className={`w-full text-left px-2 py-1.5 rounded text-sm transition-colors ${
              isLastMonth
                ? "bg-primary text-primary-foreground"
                : "hover:bg-muted/60"
            }`}
          >
            Last Month
            <span className="ml-2 text-xs opacity-70">
              {lastMonth.s} → {lastMonth.e}
            </span>
          </button>

          <div className="border-t border-border my-2" />

          <div className="text-[10px] uppercase tracking-wide text-muted-foreground px-2 pb-1.5 flex items-center gap-2">
            Custom range
            {isCustom && (
              <span className="inline-flex items-center px-1 py-0.5 rounded text-[9px] font-semibold bg-primary/15 text-primary">
                active
              </span>
            )}
          </div>
          <div className="px-2 space-y-2">
            <label className="block text-xs text-muted-foreground">
              Start
              <input
                type="date"
                value={customStart}
                max={customEnd || undefined}
                onChange={(e) => setCustomStart(e.target.value)}
                className="mt-0.5 w-full px-2 py-1 text-sm rounded border border-input bg-background"
              />
            </label>
            <label className="block text-xs text-muted-foreground">
              End
              <input
                type="date"
                value={customEnd}
                min={customStart || undefined}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="mt-0.5 w-full px-2 py-1 text-sm rounded border border-input bg-background"
              />
            </label>
            <div className="flex justify-end pb-1">
              <Button
                size="sm"
                variant="primary"
                disabled={
                  !customStart ||
                  !customEnd ||
                  customStart > customEnd ||
                  (customStart === cycleStart && customEnd === cycleEnd)
                }
                onClick={() => apply(customStart, customEnd)}
              >
                Apply range
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
