"use client";

import { useRole } from "@/contexts/RoleContext";
import { roleLabel } from "@/types";

const BANNER_HEIGHT = 40;

export function RolePreviewBanner() {
  const { isPreviewMode, role, setPreviewRole } = useRole();
  if (!isPreviewMode) return null;

  return (
    <>
      <div
        role="status"
        aria-label={`Preview mode active: viewing as ${roleLabel(role)}`}
        style={{
          position: "fixed",
          top: 64,
          left: 0,
          right: 0,
          zIndex: 40,
          height: BANNER_HEIGHT,
          backgroundColor: "#f59e0b",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          fontSize: 13,
          fontWeight: 500,
        }}
      >
        <svg
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
          />
        </svg>
        Previewing as <strong>{roleLabel(role)}</strong>
        <button
          onClick={() => setPreviewRole(null)}
          style={{
            backgroundColor: "rgba(0,0,0,0.18)",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            padding: "3px 10px",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            letterSpacing: "0.02em",
          }}
        >
          Exit Preview
        </button>
      </div>
      {/* Flow spacer — pushes page content below the fixed bar */}
      <div style={{ height: BANNER_HEIGHT }} aria-hidden />
    </>
  );
}
