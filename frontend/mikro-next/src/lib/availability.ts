/**
 * Client-side helpers for the scheduling & availability UI.
 *
 * The division of labour with the backend matters:
 *   - `api/services/availability.py` is the SINGLE SOURCE OF TRUTH for
 *     local-wall-clock -> UTC resolution, DST handling, and exception
 *     application. Nothing here re-implements that.
 *   - This module only does two things: (a) translate between the weekly
 *     grid's painted slots and the block list the API stores, both of which
 *     are plain local wall-clock minutes with no zone math at all, and
 *     (b) lay already-resolved UTC windows out on a per-day axis in the
 *     viewer's own timezone for rendering.
 */

import type {
  AvailabilityBlock,
  AvailabilityBlockDraft,
  AvailabilityKind,
} from "@/types";
import { isValidTimeZone, zonedParts } from "./timeTracking";

export const MINUTES_IN_DAY = 1440;

/** Grid resolution. 30 minutes keeps a week at 7 × 48 = 336 cells. */
export const SLOT_MINUTES = 30;
export const SLOTS_PER_DAY = MINUTES_IN_DAY / SLOT_MINUTES;

/** `day_of_week` is 0=Monday on the backend — these are index-aligned. */
export const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const DAY_LABELS_FULL = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Minutes-from-midnight → "09:30". 1440 renders as "24:00" (end of day). */
export function minuteLabel(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

/** Minutes-from-midnight → "9:30 AM", for prose rather than axis ticks. */
export function minuteLabel12h(minute: number): string {
  const total = minute % MINUTES_IN_DAY;
  const h24 = Math.floor(total / 60);
  const m = total % 60;
  const suffix = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${pad2(m)} ${suffix}`;
}

/** "09:30" → 570. Returns null for anything unparseable. */
export function labelToMinute(label: string): number | null {
  const m = label.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > MINUTES_IN_DAY) {
    return null;
  }
  return minutes;
}

/** Slot key for the painted-grid map: "3:18" = Thursday, 09:00–09:30. */
export function slotKey(day: number, slot: number): string {
  return `${day}:${slot}`;
}

/**
 * Blocks → the painted-slot map the editor renders from.
 *
 * A slot is keyed to a single kind. `preferred` wins where the two overlap,
 * because "core hours" is the stronger claim and the backend stores the two
 * kinds as independent block sets that may cover the same minutes.
 */
export function blocksToSlots(
  blocks: Array<AvailabilityBlock | AvailabilityBlockDraft>,
): Map<string, AvailabilityKind> {
  const slots = new Map<string, AvailabilityKind>();
  for (const block of blocks) {
    const first = Math.floor(block.start_minute / SLOT_MINUTES);
    // Ceil so a block ending mid-slot still paints that slot rather than
    // silently dropping the tail.
    const last = Math.ceil(block.end_minute / SLOT_MINUTES);
    for (let slot = first; slot < last && slot < SLOTS_PER_DAY; slot++) {
      const key = slotKey(block.day_of_week, slot);
      if (slots.get(key) === "preferred") continue;
      slots.set(key, block.kind ?? "available");
    }
  }
  return slots;
}

/**
 * The painted-slot map → the block list `set_my` stores.
 *
 * Contiguous same-kind slots collapse into one block; the backend's
 * `normalize_blocks` merges again per (day, kind), so the stored grid is
 * canonical however the UI painted it.
 *
 * A `preferred` run is emitted once, as one preferred block. It does not
 * also need a covering `available` block: `resolve_intervals` reads every
 * kind unless a caller explicitly restricts to `{preferred}`, so core hours
 * already count as ordinary availability.
 */
export function slotsToBlocks(
  slots: Map<string, AvailabilityKind>,
): AvailabilityBlockDraft[] {
  const blocks: AvailabilityBlockDraft[] = [];

  for (let day = 0; day < 7; day++) {
    let runStart: number | null = null;
    let runKind: AvailabilityKind | null = null;

    const flush = (endSlot: number) => {
      if (runStart === null || runKind === null) return;
      const start_minute = runStart * SLOT_MINUTES;
      const end_minute = endSlot * SLOT_MINUTES;
      blocks.push({
        day_of_week: day,
        start_minute,
        end_minute,
        kind: runKind,
      });
      runStart = null;
      runKind = null;
    };

    for (let slot = 0; slot < SLOTS_PER_DAY; slot++) {
      const kind = slots.get(slotKey(day, slot)) ?? null;
      if (kind === null) {
        flush(slot);
        continue;
      }
      if (runKind !== null && runKind !== kind) flush(slot);
      if (runStart === null) {
        runStart = slot;
        runKind = kind;
      }
    }
    flush(SLOTS_PER_DAY);
  }

  return blocks;
}

/** Total painted hours in the week, counting each slot once. */
export function weeklyHours(slots: Map<string, AvailabilityKind>): number {
  return (slots.size * SLOT_MINUTES) / 60;
}

/** Painted hours per weekday index, counting each slot once. */
export function hoursByDay(slots: Map<string, AvailabilityKind>): number[] {
  const perDay = new Array(7).fill(0);
  for (const key of slots.keys()) {
    const day = Number(key.split(":")[0]);
    if (day >= 0 && day < 7) perDay[day] += SLOT_MINUTES / 60;
  }
  return perDay;
}

// ── Rendering resolved UTC windows in the viewer's zone ────────────────

/** A slice of a UTC window that falls on one calendar day in one zone. */
export interface DaySegment {
  /** "YYYY-MM-DD" in the rendering zone. */
  dateKey: string;
  /** Minutes from local midnight, 0–1440. */
  startMinute: number;
  endMinute: number;
}

/** The browser's own zone, for viewers whose profile has none set. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** `timeZone` if usable, else the browser's zone, else UTC. */
export function renderZone(timeZone: string | null | undefined): string {
  return isValidTimeZone(timeZone) ? timeZone : browserTimeZone();
}

/** "YYYY-MM-DD" for the calendar day `date` falls on in `timeZone`. */
export function dateKeyInZone(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** Minutes from local midnight for `date` as observed in `timeZone`. */
export function minuteInZone(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  return p.hour * 60 + p.minute;
}

/** Calendar arithmetic on a "YYYY-MM-DD" key — no zone involved. */
export function addDaysToKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(
    next.getUTCDate(),
  )}`;
}

/** Inclusive list of day keys from `startKey` to `endKey`. */
export function dateKeyRange(startKey: string, endKey: string): string[] {
  const keys: string[] = [];
  let current = startKey;
  // Bounded by the backend's MAX_RANGE_DAYS (90) with headroom, so a bad
  // pair of keys can't spin forever.
  for (let i = 0; i < 400 && current <= endKey; i++) {
    keys.push(current);
    current = addDaysToKey(current, 1);
  }
  return keys;
}

/**
 * Split one resolved UTC window into per-day segments in `timeZone`.
 *
 * A window that crosses local midnight (common once a teammate is 8 zones
 * away) becomes two segments, so each day row renders its own slice instead
 * of a bar running off the end of the axis.
 */
export function windowToDaySegments(
  startIso: string,
  endIso: string,
  timeZone: string,
): DaySegment[] {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    end <= start
  ) {
    return [];
  }

  const startKey = dateKeyInZone(start, timeZone);
  const endKey = dateKeyInZone(end, timeZone);
  const startMinute = minuteInZone(start, timeZone);
  const endMinute = minuteInZone(end, timeZone);

  if (startKey === endKey) {
    return endMinute > startMinute
      ? [{ dateKey: startKey, startMinute, endMinute }]
      : [];
  }

  const segments: DaySegment[] = [
    { dateKey: startKey, startMinute, endMinute: MINUTES_IN_DAY },
  ];
  for (
    let key = addDaysToKey(startKey, 1);
    key < endKey;
    key = addDaysToKey(key, 1)
  ) {
    segments.push({ dateKey: key, startMinute: 0, endMinute: MINUTES_IN_DAY });
  }
  // A window ending exactly at local midnight has no slice on the final day.
  if (endMinute > 0) {
    segments.push({ dateKey: endKey, startMinute: 0, endMinute });
  }
  return segments;
}

/** "9:30 AM" for a UTC instant as observed in `timeZone`. */
export function formatInstantInZone(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return minuteLabel12h(minuteInZone(date, timeZone));
}

/** "Thu, Aug 20" for a "YYYY-MM-DD" key. Rendered zone-free by design. */
export function formatDateKey(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return dateKey;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** Today's "YYYY-MM-DD" in `timeZone`. */
export function todayKey(timeZone: string): string {
  return dateKeyInZone(new Date(), timeZone);
}

/** Display name for a teammate, falling back to their email. */
export function memberName(member: {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  user_id: string;
}): string {
  const name = [member.first_name, member.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  return name || member.email || member.user_id;
}
