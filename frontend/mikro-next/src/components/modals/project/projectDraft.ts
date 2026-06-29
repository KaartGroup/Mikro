/**
 * Pure SSOT for the Add Project review/completeness logic.
 *
 * No React imports — kept trivially testable. The stepper's Review step
 * uses this to drive both advisory warnings and hard blocks.
 *
 * invisible=true means nobody will see this project in the clock-in at
 * all: visibility is off and no team or user has been assigned.
 * Creation is blocked until the admin resolves it.
 */

interface ProjectDraftReview {
  missingTeam: boolean;
  missingRegion: boolean;
  /**
   * Hard block: project would be invisible to all users.
   * visibility=false AND no teams AND no users assigned.
   */
  invisible: boolean;
  /** Human-readable labels for what's missing; empty when nothing is missing. */
  missing: string[];
}

export function reviewProjectDraft(input: {
  teamCount: number;
  countryCount: number;
  userCount: number;
  isVisible: boolean;
}): ProjectDraftReview {
  const missingTeam = input.teamCount === 0;
  const missingRegion = input.countryCount === 0;
  const invisible =
    !input.isVisible && input.teamCount === 0 && input.userCount === 0;

  const missing: string[] = [];
  if (missingTeam) missing.push("a team");
  if (missingRegion) missing.push("a region/location");

  return { missingTeam, missingRegion, invisible, missing };
}
