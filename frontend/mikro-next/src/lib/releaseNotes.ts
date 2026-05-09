/**
 * SSOT for the "What's New" modal.
 *
 * Adding a release: prepend a new entry to the top of `RELEASES`.
 * `version` is the comparison key — date-based strings sort lexically
 * just as well as semver here, and we only ever need ">" comparisons.
 *
 * Audience model: each release has optional `forAdmin` and `forUser`
 * arrays. Admins see admin entries; mappers AND validators share the
 * `forUser` bucket. A release with no entries for a given audience is
 * silently skipped for that audience — they'll never see a popup with
 * nothing relevant inside.
 */

export type WhatsNewAudience = "admin" | "user";

export interface ReleaseEntry {
  /** Short headline. Keep under ~50 chars. */
  title: string;
  /** One concise sentence. Plain text — no markup. */
  body: string;
}

export interface Release {
  /** Comparison key. Date-based strings work (e.g. "2026-04-29"). */
  version: string;
  /** Display date — typically same as version. */
  date: string;
  forAdmin?: ReleaseEntry[];
  forUser?: ReleaseEntry[];
}

/** Newest first. */
export const RELEASES: Release[] = [
  {
    version: "2026-04-29",
    date: "2026-04-29",
    forAdmin: [
      {
        title: "Release updates at a glance",
        body:
          "This pop-up appears on your first login after each release, summarizing recent updates relevant to your role. Hit 'Got it' to dismiss — you won't see this batch again.",
      },
      {
        title: "Pending Adjustment Requests strip",
        body:
          "/admin/time now shows a strip at the top listing every unresolved adjustment request with a Review & Edit button — date filter no longer hides them.",
      },
      {
        title: "Time tab on user profiles",
        body:
          "Click any user → the new Time tab on their profile shows Hours This Week, Hours This Month, Average Session, anomalies, and recent entries — focused on that one person.",
      },
      {
        title: "Deactivate user (separate from delete)",
        body:
          "Soft-disable users from their admin profile. They're blocked from logging in, hidden behind a Deactivated tab on the users list, but their data stays intact.",
      },
      {
        title: "Region filtering on admin views",
        body:
          "Admins assigned to a country only see projects matching that country in /admin/projects and dashboard counts. Admins with no country assignments still see everything.",
      },
      {
        title: "Team scope dropdown on the dashboard",
        body:
          "Pick a team next to Sync All Tasks and the time-related panels scope to its members. Selection persists across reloads.",
      },
      {
        title: "Cleaner report exports",
        body:
          "CSV / PDF exports of time reports handle non-ASCII OSM usernames cleanly, plus a 'Hide OSM username column' toggle in the Export menu.",
      },
      {
        title: "Calendar-aligned date presets",
        body:
          "Last Month is now last calendar month. Last 3 Months is the last three FULL calendar months. New Last Week preset added.",
      },
    ],
    forUser: [
      {
        title: "Release updates at a glance",
        body:
          "This pop-up appears on your first login after each release, summarizing recent updates relevant to you. Hit 'Got it' to dismiss — you won't see this batch again.",
      },
      {
        title: "Notes on time entries",
        body:
          "Add an optional note (up to 500 chars) on any of your time entries — visible on the sidebar clock, the dashboard widget, and your time history.",
      },
      {
        title: "Discard Active Time Record",
        body:
          "Clocked into the wrong project by accident? Hit the Discard button within 5 minutes of clocking in to throw the entry away cleanly. Confirmation prompt prevents accidents.",
      },
      {
        title: "Topic → Task in the clock-in",
        body:
          "The dropdown formerly labeled 'Topic' now reads 'Task'. Same options, clearer name.",
      },
      {
        title: "Consistent HH:MM:SS time format",
        body:
          "Every time value across the app now reads HH:MM:SS. The sidebar clock also shows your current Week total alongside Today.",
      },
      {
        title: "Project dropdowns are alphabetized",
        body:
          "Project pickers are sorted A–Z everywhere; on the clock-in widgets your most recently worked-on project is pinned to the top.",
      },
      {
        title: "Community category fixed",
        body:
          "Clocking in under the Community category works again (was rejecting silently with a backend validation error).",
      },
    ],
  },
];

/** Latest release in the list. */
export function latestRelease(): Release | null {
  return RELEASES[0] ?? null;
}

/**
 * Releases newer than `lastSeen` that have content for `audience`.
 * Returns newest first. Empty array if nothing to show.
 *
 * `lastSeen` of null/empty means the user has never dismissed the
 * modal — show every release with audience-relevant content.
 */
export function unseenReleases(
  lastSeen: string | null,
  audience: WhatsNewAudience,
): Release[] {
  const entriesKey = audience === "admin" ? "forAdmin" : "forUser";
  return RELEASES.filter((r) => {
    const hasContent = (r[entriesKey]?.length ?? 0) > 0;
    if (!hasContent) return false;
    if (!lastSeen) return true;
    return r.version > lastSeen;
  });
}

/** Map a backend role to the audience bucket the modal uses.
 * Any admin tier (super_admin, admin/org_admin, team_admin) gets
 * the admin-only release notes; everyone else gets the user bucket.
 */
export function audienceForRole(
  role: string | null | undefined,
): WhatsNewAudience {
  if (role === "admin" || role === "super_admin" || role === "team_admin") {
    return "admin";
  }
  return "user";
}
