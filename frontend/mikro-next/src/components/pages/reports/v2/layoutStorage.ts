import type { Data } from "@measured/puck";

/**
 * Phase 2 layout persistence — localStorage only.
 *
 * Deliberately a thin, swappable seam: Phase 3 replaces these two functions
 * with the server-backed per-team `report_layouts` store, keyed by team. The
 * key is versioned so a future config-schema change can migrate cleanly.
 */
const STORAGE_KEY = "reports-v2-layout:v1";

export function loadLayout(): Data | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Data) : null;
  } catch {
    return null;
  }
}

export function saveLayout(data: Data): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Non-fatal (quota/private mode) — the in-memory layout still works.
  }
}
