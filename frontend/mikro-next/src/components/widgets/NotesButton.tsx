"use client";

import { useState } from "react";
import { NotesDialog } from "@/components/modals/NotesDialog";

export interface NotesButtonProps {
  notes: string | null | undefined;
  editable: boolean;
  onSave?: (value: string | null) => Promise<void> | void;
  /** Called after a successful save, e.g. to trigger a separate list refresh. */
  onSaved?: () => void;
  size?: "xs" | "sm";
  /** Override the dialog title (e.g. "Note from <user>"). */
  title?: string;
}

/**
 * Single SSOT entry point for surfacing a user_notes field on any
 * time-entry render. Renders a compact icon/text button; opens
 * NotesDialog (editable or read-only depending on `editable`).
 *
 * In read-only mode, if there are no notes the button does not render
 * — there's nothing for the admin to view.
 */
export function NotesButton({
  notes,
  editable,
  onSave,
  onSaved,
  size = "sm",
  title,
}: NotesButtonProps) {
  const [open, setOpen] = useState(false);

  const hasNotes = !!notes && notes.trim().length > 0;

  if (!editable && !hasNotes) {
    return null;
  }

  const sizeClasses =
    size === "xs" ? "h-6 px-2 text-xs gap-1" : "h-7 px-2.5 text-xs gap-1.5";

  const stateClasses = hasNotes
    ? "bg-kaart-orange/10 text-kaart-orange hover:bg-kaart-orange/20 border-kaart-orange/30"
    : "bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted border-border";

  const label = hasNotes ? "Note" : "+ Note";

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={`inline-flex items-center justify-center rounded-md border font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring ${sizeClasses} ${stateClasses}`}
        title={hasNotes ? "View note" : "Add note"}
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
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="9" y1="13" x2="15" y2="13" />
          <line x1="9" y1="17" x2="13" y2="17" />
        </svg>
        <span>{label}</span>
      </button>
      <NotesDialog
        isOpen={open}
        onClose={() => setOpen(false)}
        initialValue={notes ?? null}
        editable={editable}
        onSave={editable ? onSave : undefined}
        onSaved={onSaved}
        title={title}
      />
    </>
  );
}
