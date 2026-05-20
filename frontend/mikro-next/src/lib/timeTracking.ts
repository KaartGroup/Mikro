/**
 * Shared time tracking constants — single source of truth for all clock widgets.
 */

export const TOPIC_OPTIONS = [
  { value: "editing", label: "Editing" },
  { value: "validating", label: "Validating" },
  { value: "training", label: "Training" },
  { value: "checklist", label: "Checklist" },
  { value: "qc_review", label: "QC / Review" },
  { value: "meeting", label: "Meeting" },
  { value: "documentation", label: "Documentation" },
  { value: "imagery_capture", label: "Imagery Capture" },
  { value: "project_creation", label: "Project Creation" },
  // Added 2026-04 per F10 — covers Jorge's community-discussion /
  // outreach work that previously had no trackable category.
  { value: "community", label: "Community" },
  { value: "other", label: "Other" },
] as const;

/**
 * Activities that require a project when NO subcategory is configured
 * for that activity yet. After the two-tier rework, the canonical
 * source of "do I need a project?" is each subcategory's
 * `requiresProject` flag (see `requiresProjectFor` below). This list
 * is the fallback for two cases:
 *
 *   1. Fresh-DB / un-seeded org: the activity has zero subs available
 *      to the user, so clock-in has no sub picker and we fall back to
 *      the activity-level requirement.
 *   2. Subcategory not yet picked: while the user is still mid-form,
 *      the project picker reflects the activity-level default.
 *
 * Keep this short — anything more nuanced lives on subcategory rows.
 */
const PROJECT_REQUIRED_FALLBACK_ACTIVITIES = new Set([
  "editing",
  "validating",
  "qc_review",
]);

/**
 * SSOT for the "do I need a project?" decision.
 *
 * Selected subcategory wins (its `requiresProject` flag is canonical).
 * Otherwise we fall back to the per-activity default above so behavior
 * doesn't regress for orgs whose subs haven't been seeded yet.
 */
export function requiresProjectFor(
  activity: string | null | undefined,
  subcategory?: { requiresProject?: boolean } | null,
): boolean {
  if (subcategory) return !!subcategory.requiresProject;
  if (!activity) return false;
  return PROJECT_REQUIRED_FALLBACK_ACTIVITIES.has(activity);
}

/**
 * Client-side slug derivation. Mirrors the SQL in the d5a0b1c2e3f4
 * seed migration (`REGEXP_REPLACE([^a-zA-Z0-9]+, '_')`) and the
 * Python `_slugify` in TimeTracking.py so a sub created via the
 * admin UI ends up with the same slug shape as a seeded one.
 */
export function slugifyName(name: string): string {
  return (name || "")
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

/** Displayed in tables/filters when a row has no subcategory (legacy). */
export const UNSPECIFIED_SUBCATEGORY_LABEL = "Unspecified";

/** Cell value shown in subcategory columns when a row has no sub. */
export const EMPTY_SUBCATEGORY_CELL = "—";

/**
 * Category SSOT — mirrors `VALID_CATEGORIES` and `CATEGORY_DISPLAY_MAP`
 * on the backend (`backend/api/views/TimeTracking.py`). Every category
 * translation in the frontend should go through `resolveCategoryKey()`
 * or `categoryLabel()` rather than handcrafted reverse lookups, so any
 * locale-quirky `.toLowerCase()` (e.g. Turkish dotless I) or input we
 * don't recognize fails closed instead of being silently misrouted.
 */

/** Canonical category key → display label. */
export const CATEGORY_LABELS: Record<string, string> = {
  editing: "Editing",
  validating: "Validating",
  training: "Training",
  checklist: "Checklist",
  qc_review: "QC / Review",
  meeting: "Meeting",
  documentation: "Documentation",
  imagery_capture: "Imagery Capture",
  project_creation: "Project Creation",
  community: "Community",
  other: "Other",
};

/**
 * Legacy keys the backend still accepts. We don't render them in dropdowns
 * (the canonical equivalents already cover them) but if a stored entry's
 * category is one of these we display it via its canonical label.
 */
const LEGACY_CATEGORY_KEYS: Record<string, string> = {
  mapping: "editing",
  validation: "validating",
  review: "qc_review",
};

// Built once: case-insensitive label → canonical key.
const LABEL_TO_KEY: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const [key, label] of Object.entries(CATEGORY_LABELS)) {
    out[label.toLowerCase()] = key;
  }
  return out;
})();

/**
 * Resolve any category-ish input to a canonical backend key.
 *
 * Accepts:
 * - canonical keys ("editing", "qc_review") — case-insensitive
 * - display labels ("Editing", "QC / Review") — case-insensitive
 * - legacy keys ("mapping", "validation", "review") — pass through
 * - surrounding whitespace
 *
 * Returns `null` for empty / "All" / unrecognized input. Callers should
 * treat null as "no category filter" rather than substituting a guess —
 * that's the failure mode the previous `.toLowerCase()` fallback hid.
 */
export function resolveCategoryKey(input: string | null | undefined): string | null {
  if (input == null) return null;
  const trimmed = String(input).trim().toLowerCase();
  if (!trimmed || trimmed === "all") return null;
  if (trimmed in CATEGORY_LABELS) return trimmed;
  if (trimmed in LEGACY_CATEGORY_KEYS) return trimmed;
  if (trimmed in LABEL_TO_KEY) return LABEL_TO_KEY[trimmed];
  return null;
}

/**
 * Display label for any category-ish input. Legacy keys render via their
 * canonical equivalent; unknown values get a Title-Cased fallback so the
 * UI never shows raw garbage even if a new key arrives from the backend
 * before this map is updated.
 */
export function categoryLabel(input: string | null | undefined): string {
  if (input == null) return "";
  const trimmed = String(input).trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  if (lower in CATEGORY_LABELS) return CATEGORY_LABELS[lower];
  if (lower in LEGACY_CATEGORY_KEYS) {
    return CATEGORY_LABELS[LEGACY_CATEGORY_KEYS[lower]];
  }
  if (lower in LABEL_TO_KEY) {
    return CATEGORY_LABELS[LABEL_TO_KEY[lower]];
  }
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/** Filter-bar dropdown options: "All" plus every canonical label. */
export const CATEGORY_FILTER_LABELS: string[] = [
  "All",
  ...Object.values(CATEGORY_LABELS),
];

/**
 * SSOT duration formatter — `HH:MM:SS` everywhere, app-wide.
 *
 * Both live timers and completed/aggregated durations share this format
 * so the time-tracking UI is visually consistent.
 *
 * Returns "--:--:--" for null/invalid input.
 *
 * Aliases `formatDurationHM` and `formatLiveDuration` are retained for
 * backwards compatibility with existing imports — they all resolve here.
 */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || isNaN(seconds) || seconds < 0) return "--:--:--";
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// Aliases — same function, kept so existing import sites still work.
export const formatDurationHM = formatDuration;
export const formatLiveDuration = formatDuration;

/*
 * Timezone-correct filter-window helpers.
 *
 * Backend filters time entries against UTC-stored `clock_in`. The frontend
 * sends ISO UTC *instants* aligned to the user's browser-local midnights —
 * e.g. in Manila (UTC+8), the local start of 2026-04-23 becomes
 * "2026-04-22T16:00:00.000Z" on the wire. Backend receives the explicit
 * instant and filters without adding a day.
 */

/** Start of the user's local day as an ISO UTC string (inclusive bound). */
export function localDayStartIsoUtc(d: Date = new Date()): string {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
}

/** Start of the user's local NEXT day as an ISO UTC string (exclusive upper bound). */
export function localDayEndIsoUtc(d: Date = new Date()): string {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).toISOString();
}

/** Start of the user's local week (Sunday) as an ISO UTC string. */
export function localWeekStartIsoUtc(d: Date = new Date()): string {
  const day = d.getDay();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day).toISOString();
}

/** Start of the user's local NEXT Sunday — i.e. the exclusive upper
 *  bound for "this week" (Sunday–Saturday). On a Saturday this is
 *  midnight tonight; on a Sunday it's a week from now. */
export function localWeekEndIsoUtc(d: Date = new Date()): string {
  const day = d.getDay();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day + 7).toISOString();
}

/** Start of the user's local Sunday N weeks ago as an ISO UTC string.
 *  weeksAgo=1 returns the Sunday that began the previous week. */
export function localWeekStartAgoIsoUtc(weeksAgo: number, d: Date = new Date()): string {
  const day = d.getDay();
  return new Date(
    d.getFullYear(), d.getMonth(),
    d.getDate() - day - 7 * weeksAgo,
  ).toISOString();
}

/** Start of the user's local month as an ISO UTC string. */
export function localMonthStartIsoUtc(d: Date = new Date()): string {
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
}

/** Start of the user's local NEXT month as an ISO UTC string (exclusive upper bound). */
export function localMonthEndIsoUtc(d: Date = new Date()): string {
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString();
}

/** Start of the user's local month N months ago as an ISO UTC string. */
export function localMonthStartAgoIsoUtc(monthsAgo: number, d: Date = new Date()): string {
  return new Date(d.getFullYear(), d.getMonth() - monthsAgo, 1).toISOString();
}

/**
 * Convert a "YYYY-MM-DD" string (from <input type="date">) to the ISO UTC
 * instant that is local midnight of that calendar day. Undefined/empty input
 * returns null.
 */
export function dateInputToLocalStartIsoUtc(input: string | null | undefined): string | null {
  if (!input) return null;
  const [y, m, d] = input.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).toISOString();
}

/**
 * Exclusive upper bound: local midnight of the day AFTER the picked day.
 * Intended for backend windows like `column < endIsoUtc`.
 */
export function dateInputToLocalEndIsoUtc(input: string | null | undefined): string | null {
  if (!input) return null;
  const [y, m, d] = input.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d + 1).toISOString();
}

// ─── Date-range formatting (admin date-preset captions) ─────────────
//
// SSOT for rendering a human-readable "Apr 26 – May 2, 2026" string
// from any pair of dates. Used by /admin/time, /admin/reports, and
// /admin/reports/weekly so admins can verify at a glance what range
// a preset like "Last month" actually covers.
//
// Smart abbreviations:
//   - same day:       "Apr 30, 2026"
//   - same month:     "Apr 1 – 30, 2026"
//   - same year:      "Apr 26 – May 2, 2026"
//   - cross-year:     "Dec 26, 2025 – Jan 2, 2026"

/**
 * Convert various date-ish inputs to a Date in the viewer's local
 * timezone. Accepts:
 *   - Date objects
 *   - ISO 8601 strings (UTC instants from the local* helpers above)
 *   - "YYYY-MM-DD" strings (raw <input type="date"> values)
 * Returns null for null/undefined/empty/invalid inputs.
 *
 * For ISO instants and Date objects we preserve the moment in time and
 * the consumer's locale rendering will format it correctly. For
 * "YYYY-MM-DD" we anchor to local midnight so the day stamp doesn't
 * drift across timezones.
 */
function toLocalDate(input: Date | string | null | undefined): Date | null {
  if (input == null || input === "") return null;
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input;
  }
  const s = String(input);
  // "YYYY-MM-DD" without a time component → anchor to local midnight.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * For "exclusive upper bound" inputs (the convention this file uses for
 * end-of-week / end-of-month — they point at midnight of the day AFTER
 * the last included day), subtract one calendar day so the displayed
 * range matches what the user thinks of as "Apr 26 – May 2" instead of
 * "Apr 26 – May 3".
 */
function decrementDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
}

interface FormatRangeOptions {
  /** Treat `end` as an exclusive upper bound (subtract one day for display). */
  endExclusive?: boolean;
  /** Returned when start or end is null/empty. Default "All time". */
  emptyLabel?: string;
}

/**
 * Format a date range as a short human-readable string with smart
 * collapsing. Returns `emptyLabel` when either end is null.
 *
 * Examples (today = 2026-04-30 in en-US locale):
 *   formatDateRangeShort("2026-04-30", "2026-04-30")              → "Apr 30, 2026"
 *   formatDateRangeShort("2026-04-01", "2026-04-30")              → "Apr 1 – 30, 2026"
 *   formatDateRangeShort("2026-04-26", "2026-05-02")              → "Apr 26 – May 2, 2026"
 *   formatDateRangeShort("2025-12-26", "2026-01-02")              → "Dec 26, 2025 – Jan 2, 2026"
 *   formatDateRangeShort(weekStartIsoUtc, weekEndIsoUtc, {endExclusive: true})
 *     where end is the next Sunday → previous Saturday is shown.
 */
export function formatDateRangeShort(
  start: Date | string | null | undefined,
  end: Date | string | null | undefined,
  opts: FormatRangeOptions = {},
): string {
  const startD = toLocalDate(start);
  let endD = toLocalDate(end);
  if (!startD || !endD) return opts.emptyLabel ?? "All time";
  if (opts.endExclusive) endD = decrementDay(endD);

  const sameYear = startD.getFullYear() === endD.getFullYear();
  const sameMonth = sameYear && startD.getMonth() === endD.getMonth();
  const sameDay = sameMonth && startD.getDate() === endD.getDate();

  const monthShort = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short" });
  const day = (d: Date) => String(d.getDate());
  const year = (d: Date) => String(d.getFullYear());

  if (sameDay) {
    return `${monthShort(startD)} ${day(startD)}, ${year(startD)}`;
  }
  if (sameMonth) {
    return `${monthShort(startD)} ${day(startD)} – ${day(endD)}, ${year(startD)}`;
  }
  if (sameYear) {
    return `${monthShort(startD)} ${day(startD)} – ${monthShort(endD)} ${day(endD)}, ${year(startD)}`;
  }
  return `${monthShort(startD)} ${day(startD)}, ${year(startD)} – ${monthShort(endD)} ${day(endD)}, ${year(endD)}`;
}
