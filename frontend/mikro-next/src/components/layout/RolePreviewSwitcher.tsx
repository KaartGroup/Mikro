"use client";

import { useState } from "react";
import { useRole } from "@/contexts/RoleContext";
import type { UserRole } from "@/types";
import { roleLabel, isAnyAdmin } from "@/types";

const ROLE_ORDER: Record<UserRole, number> = {
  super_admin: 4,
  admin: 3,
  team_admin: 2,
  validator: 1,
  user: 0,
};

const ALL_ROLES: UserRole[] = [
  "super_admin",
  "admin",
  "team_admin",
  "validator",
  "user",
];

export function RolePreviewSwitcher() {
  const { actualRole, role, isPreviewMode, setPreviewRole } = useRole();
  const [open, setOpen] = useState(false);

  if (!isAnyAdmin(actualRole)) return null;

  const previewOptions = ALL_ROLES.filter(
    (r) => ROLE_ORDER[r] < ROLE_ORDER[actualRole]
  );

  const close = () => setOpen(false);

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        title={isPreviewMode ? `Previewing as ${roleLabel(role)}` : "Preview the app as a lower role"}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          fontSize: 13,
          fontWeight: 500,
          color: isPreviewMode ? "#f59e0b" : "var(--muted-foreground)",
          backgroundColor: "transparent",
          border: `1px solid ${isPreviewMode ? "#f59e0b" : "var(--border)"}`,
          borderRadius: 6,
          padding: "6px 10px",
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {isPreviewMode ? (
          <>
            <svg
              width="13"
              height="13"
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
            {roleLabel(role)}
          </>
        ) : (
          "Preview as"
        )}
        <svg
          width="10"
          height="10"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden
          style={{
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 150ms",
          }}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2.5}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {open && (
        <>
          {/* Backdrop — closes dropdown on outside click */}
          <div
            style={{ position: "fixed", inset: 0, zIndex: 99 }}
            onClick={close}
            aria-hidden
          />
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              right: 0,
              backgroundColor: "var(--background)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
              minWidth: 176,
              zIndex: 100,
              overflow: "hidden",
            }}
          >
            {isPreviewMode && (
              <>
                <button
                  onClick={() => { setPreviewRole(null); close(); }}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "9px 14px",
                    fontSize: 13,
                    cursor: "pointer",
                    background: "none",
                    border: "none",
                    color: "#f59e0b",
                    fontWeight: 600,
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                  }}
                >
                  <svg
                    width="12"
                    height="12"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2.5}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                  Return to {roleLabel(actualRole)}
                </button>
                <div
                  style={{
                    height: 1,
                    backgroundColor: "var(--border)",
                    margin: "2px 0",
                  }}
                />
              </>
            )}

            <div
              style={{
                padding: "4px 0",
                fontSize: 11,
                fontWeight: 600,
                color: "var(--muted-foreground)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                paddingLeft: 14,
                paddingTop: 8,
                paddingBottom: 4,
              }}
            >
              Preview as
            </div>

            {previewOptions.map((r) => {
              const isActive = isPreviewMode && role === r;
              return (
                <button
                  key={r}
                  onClick={() => { setPreviewRole(r); close(); }}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 14px",
                    fontSize: 13,
                    cursor: "pointer",
                    backgroundColor: isActive ? "var(--secondary)" : "transparent",
                    border: "none",
                    color: "var(--foreground)",
                    fontWeight: isActive ? 600 : 400,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  {roleLabel(r)}
                  {isActive && (
                    <svg
                      width="13"
                      height="13"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2.5}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
