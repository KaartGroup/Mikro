/**
 * Single source of truth for project-list ordering across the app.
 *
 * Two policies:
 * - sortProjectsAlphabetical: pure A–Z by display name. Use everywhere a
 *   user picks from the full org/validator project list (admin pages,
 *   filters, edit-entry modals).
 * - sortProjectsRecentPinned: the project with the most recent
 *   `last_worked_on` is pinned to the top; everything else (including
 *   projects with no last_worked_on) is alphabetical underneath. Use on
 *   personal clock-in widgets so the project you just used is one click
 *   away while the rest stays predictable to scan.
 *
 * Both helpers are pure and return a NEW array — never mutate the input.
 */

interface ProjectLike {
  id: number;
  name: string;
  short_name?: string | null;
  last_worked_on?: string | null;
}

const displayName = <T extends ProjectLike>(p: T): string =>
  (p.short_name && p.short_name.length > 0 ? p.short_name : p.name) || "";

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

  if (!mostRecent) {
    // Nobody has a last_worked_on — degrade to pure alphabetical.
    return sortProjectsAlphabetical(projects);
  }

  const rest = projects.filter((p) => p.id !== mostRecent!.id);
  return [mostRecent, ...sortProjectsAlphabetical(rest)];
}
