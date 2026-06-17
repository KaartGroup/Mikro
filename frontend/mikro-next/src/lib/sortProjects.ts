/**
 * Single source of truth for project-list ordering across the app.
 *
 * Two policies:
 * - sortProjectsAlphabetical: pure A–Z by display name. Use everywhere a
 *   user picks from the full org/validator project list (admin pages,
 *   filters, edit-entry modals).
 * - sortProjectsRecentPinned: projects in the user's country/region float
 *   to the top; within each group the most recently `last_worked_on`
 *   project is pinned, with the rest alphabetical underneath. Use on
 *   personal clock-in widgets so the projects you're likely to work are one
 *   click away while the rest stays predictable to scan.
 *
 * Both helpers are pure and return a NEW array — never mutate the input.
 */

interface ProjectLike {
  id: number;
  name: string;
  short_name?: string | null;
  last_worked_on?: string | null;
  // True when the project is in a country/region the current user is
  // associated with. Set by the backend on the clock-in project list so a
  // mapper's local projects sort ahead of everything else.
  matches_user_location?: boolean;
}

/**
 * The label a project should be shown under in dropdowns, lists, and any
 * other UI: its standardized short name when one is set, otherwise the full
 * project name. Single source of truth so every menu reads the same way.
 */
export const projectDisplayName = <T extends ProjectLike>(p: T): string =>
  (p.short_name && p.short_name.length > 0 ? p.short_name : p.name) || "";

const displayName = projectDisplayName;

const alphaCompare = <T extends ProjectLike>(a: T, b: T): number =>
  displayName(a).localeCompare(displayName(b), undefined, {
    sensitivity: "base",
    numeric: true,
  });

export function sortProjectsAlphabetical<T extends ProjectLike>(
  projects: T[],
): T[] {
  return projects.slice().sort(alphaCompare);
}

// Within a single group: pin the most-recently-worked project to the top,
// the rest alphabetical. Degrades to pure alpha when no project in the group
// has a last_worked_on.
function sortGroupRecentPinned<T extends ProjectLike>(projects: T[]): T[] {
  if (projects.length === 0) return [];

  // Find the single project with the latest last_worked_on (ignoring nulls).
  let mostRecent: T | null = null;
  let mostRecentTs = "";
  for (const p of projects) {
    const ts = p.last_worked_on || "";
    if (ts && ts > mostRecentTs) {
      mostRecent = p;
      mostRecentTs = ts;
    }
  }

  if (!mostRecent) {
    // Nobody has a last_worked_on — degrade to pure alphabetical.
    return sortProjectsAlphabetical(projects);
  }

  const rest = projects.filter((p) => p.id !== mostRecent!.id);
  return [mostRecent, ...sortProjectsAlphabetical(rest)];
}

export function sortProjectsRecentPinned<T extends ProjectLike>(
  projects: T[],
): T[] {
  if (projects.length === 0) return [];

  // Projects in the user's country/region sort ahead of the rest. Each group
  // keeps the recent-pinned + alphabetical ordering. When no project carries
  // matches_user_location, the first group is empty and this is identical to
  // a single recent-pinned list — so callers without location data are
  // unaffected.
  const inLocation = projects.filter((p) => p.matches_user_location);
  const others = projects.filter((p) => !p.matches_user_location);

  return [
    ...sortGroupRecentPinned(inLocation),
    ...sortGroupRecentPinned(others),
  ];
}
