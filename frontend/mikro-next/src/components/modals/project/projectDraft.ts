/**
 * Pure SSOT for the Add Project review/completeness logic.
 *
 * No React imports — kept trivially testable. The stepper's Review step
 * uses this to flag (but never block) a project that has no team or no
 * region/location selected.
 */

export interface ProjectDraftReview {
  missingTeam: boolean;
  missingRegion: boolean;
  /** Human-readable labels for what's missing; empty when nothing is missing. */
  missing: string[];
}

export function reviewProjectDraft(input: {
  teamCount: number;
  countryCount: number;
}): ProjectDraftReview {
  const missingTeam = input.teamCount === 0;
  const missingRegion = input.countryCount === 0;

  const missing: string[] = [];
  if (missingTeam) missing.push("a team");
  if (missingRegion) missing.push("a region/location");

  return { missingTeam, missingRegion, missing };
}
