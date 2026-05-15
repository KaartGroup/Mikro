"use client";

import { useState, useRef, useEffect } from "react";
import { exportChartsAsDocx } from "@/lib/reportExport";

interface ExportDropdownProps {
  contentRef: React.RefObject<HTMLDivElement | null>;
  dateRange: string;
}

export function ExportDropdown({ contentRef, dateRange }: ExportDropdownProps) {
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  async function handleExport(fn: (el: HTMLElement) => Promise<void>) {
    setOpen(false);
    if (!contentRef.current) return;
    setExporting(true);
    try {
      await fn(contentRef.current);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={exporting}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted text-foreground text-sm font-medium hover:bg-muted/80 transition-colors disabled:opacity-50"
      >
        {exporting ? (
          <>
            <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-kaart-orange" />
            Exporting...
          </>
        ) : (
          <>
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-44 rounded-lg border border-border bg-card shadow-lg z-50 overflow-hidden">
          <button
            onClick={() => handleExport((el) => exportChartsAsDocx(el, dateRange))}
            className="w-full text-left px-4 py-2.5 text-sm hover:bg-muted transition-colors flex items-center gap-2"
          >
            <svg className="h-4 w-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Download Word Doc
          </button>
        </div>
      )}
    </div>
  );
}
