/**
 * Shared chart color palette.
 *
 * Previously duplicated across `/admin/reports/page.tsx` and
 * `/admin/reports/weekly/page.tsx`. Extracted here so palette tweaks
 * stay in sync between the two pages.
 *
 * Semantic anchors used across both pages:
 *   - kaart-orange (#f97316) = brand primary / mapped / added
 *   - blue        (#3b82f6) = validated / modified / neutral info
 *   - red         (#ef4444) = invalidated / deleted
 *   - green       (#10b981) = hours / paid / positive-neutral
 *   - gray        (#9ca3af) = other / skipped / muted
 *
 * Category and weekly-task palettes are a 9-color qualitative scale
 * used for stacked bars and multi-series charts — kept generic enough
 * that adding categories doesn't immediately collide with existing
 * hues.
 */

/** Workflow colors — mapped / validated / invalidated + element-diff trio. */
export const COLORS = {
  mapped: "#f97316",
  validated: "#3b82f6",
  invalidated: "#ef4444",
  hours: "#10b981",
  review: "#6366f1",
  training: "#f59e0b",
  other: "#9ca3af",
  deleted: "#ffffff",
  added: "#f97316",
  modified: "#93c5fd",
};

/** High Priority Roads chart colors. */
export const HPR_COLORS = {
  upgraded: "#93c5fd",
  downgraded: "#f97316",
  links: "#fde047",
  construction: "#ffffff",
};

/** MapRoulette task-status colors. */
export const MR_COLORS = {
  fixed: "#22c55e",
  already_fixed: "#10b981",
  false_positive: "#f59e0b",
  cant_complete: "#f97316",
  skipped: "#9ca3af",
};

/** Time-tracking activity categories — used on timekeeping tab bar charts. */
export const CATEGORY_COLORS: Record<string, string> = {
  mapping: "#f97316",
  "editing / osm": "#f97316",
  validation: "#3b82f6",
  "kaart qc": "#3b82f6",
  review: "#6366f1",
  management: "#8b5cf6",
  training: "#f59e0b",
  "kaart training / meetings": "#f59e0b",
  "project creation / team planning": "#06b6d4",
  "community outreach - general": "#10b981",
  "community qc": "#14b8a6",
  "community events / trainings / meetings": "#a855f7",
  "wiki / osm documentation": "#ec4899",
  "imagery capture": "#64748b",
  other: "#9ca3af",
};

/**
 * Key-based color map for the weekly/daily task-hours stacked bar chart.
 * Keyed by the snake_case category names returned by the backend
 * `_categorize_activity` function so each category always gets the same
 * color regardless of its alphabetical sort position in the data.
 */
export const TIMEKEEPING_CATEGORY_COLORS: Record<string, string> = {
  editing: "#f97316",
  meeting: "#93c5fd",
  qc: "#d1d5db",
  imagery_capture: "#9ca3af",
  project_creation: "#3b82f6",
  community_qc: "#111827",
  community_documentation: "#ec4899",
  community_meeting: "#a855f7",
  community_outreach: "#10b981",
  community_training: "#7c3aed",
  community_event: "#0ea5e9",
  training: "#f59e0b",
  documentation: "#f472b6",
  other: "#6b7280",
};

/** Fallback qualitative scale for any category not in TIMEKEEPING_CATEGORY_COLORS. */
export const WEEKLY_TASK_COLORS = [
  "#f97316",
  "#93c5fd",
  "#d1d5db",
  "#9ca3af",
  "#3b82f6",
  "#111827",
  "#ec4899",
  "#a855f7",
  "#10b981",
];

/** Community category colors — keyed by backend snake_case category names. */
export const COMMUNITY_OUTREACH_COLORS: Record<string, string> = {
  community_documentation: "#f97316",
  community_qc: "#1f2937",
  community_meeting: "#f59e0b",
  community_training: "#f59e0b",
  community_outreach: "#fdba74",
  community_event: "#0ea5e9",
};
