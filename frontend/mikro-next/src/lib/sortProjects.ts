/**
 * Single source of truth for project-list ordering across the app.
 *
 * Two policies:
 * - sortProjectsAlphabetical: pure A–Z by display name. Use everywhere a
 *   user picks from the full org/validator project list (admin pages,
 *   filters, edit-entry modals).
 * - sortProjectsRecentPinned: the project with the most recent
 *   `last_worked_on` is pinned to the top; then the user's in-country
 *   projects (A–Z), then all other projects (A–Z). Use on personal
 *   clock-in widgets so the project you just used is one click away,
 *   your country's projects float near the top, and the rest stays
 *   predictable to scan. When no project carries `in_user_country`,
 *   this degrades to recent-pin + pure alphabetical (today's behavior).
 *
 * Both helpers are pure and return a NEW array — never mutate the input.
 */

interface ProjectLike {
  id: number;
  name: string;
  short_name?: string | null;
  last_worked_on?: string | null;
  in_user_country?: boolean;
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

export function sortProjectsRecentPinned<T extends ProjectLike>(
  projects: T[],
): T[] {
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

  // Everything below the (optional) pinned project: in-country projects
  // first, alphabetized, then the rest, alphabetized. When mostRecent is
  // null there's no pin and the whole list is partitioned this way.
  const rest = mostRecent
    ? projects.filter((p) => p.id !== mostRecent!.id)
    : projects;
  // Partition the remainder: the user's in-country projects float above
  // everything else, each group alphabetized on its own. When no project
  // is flagged in_user_country, `inCountry` is empty and the result is
  // identical to recent-pin + pure alphabetical.
  const inCountry = rest.filter((p) => p.in_user_country === true);
  const others = rest.filter((p) => p.in_user_country !== true);
  const ordered = [
    ...sortProjectsAlphabetical(inCountry),
    ...sortProjectsAlphabetical(others),
  ];
  return mostRecent ? [mostRecent, ...ordered] : ordered;
}
