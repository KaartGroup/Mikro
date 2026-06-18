/*
 * Email-campaign audience format — frontend mirror.
 *
 * KEEP IN SYNC with the comms service's email/audience.py — same
 * constants, same parse semantics. If the format changes, update both.
 *
 *   "all_org"     → everyone in the sender's org (comms resolves this itself)
 *   "team:<id>"   → members of that team (app-resolved recipients)
 *   "region:<id>" → users whose country belongs to that region (app-resolved)
 *   "custom"      → an explicit set of users; recipient_user_ids carries the subs
 */

export const AUDIENCE_ALL_ORG = "all_org";
export const AUDIENCE_CUSTOM = "custom";
const AUDIENCE_TEAM_PREFIX = "team:";
const AUDIENCE_REGION_PREFIX = "region:";

type AudienceKind = "all_org" | "custom" | "team" | "region" | "unknown";

interface ParsedAudience {
  kind: AudienceKind;
  targetId: number | null;
}

export function parseAudience(audience: string): ParsedAudience {
  if (audience === AUDIENCE_ALL_ORG) {
    return { kind: "all_org", targetId: null };
  }
  if (audience === AUDIENCE_CUSTOM) {
    return { kind: "custom", targetId: null };
  }
  if (audience.startsWith(AUDIENCE_TEAM_PREFIX)) {
    const n = Number(audience.slice(AUDIENCE_TEAM_PREFIX.length));
    return Number.isFinite(n)
      ? { kind: "team", targetId: n }
      : { kind: "unknown", targetId: null };
  }
  if (audience.startsWith(AUDIENCE_REGION_PREFIX)) {
    const n = Number(audience.slice(AUDIENCE_REGION_PREFIX.length));
    return Number.isFinite(n)
      ? { kind: "region", targetId: n }
      : { kind: "unknown", targetId: null };
  }
  return { kind: "unknown", targetId: null };
}

export function formatTeamAudience(teamId: number): string {
  return `${AUDIENCE_TEAM_PREFIX}${teamId}`;
}

/**
 * Human-readable label for an audience string — what the UI shows in
 * dropdown options and campaign history tables. Looks up team/region
 * names from the supplied lists; falls back to the raw id if not found.
 */
export function audienceLabel(
  audience: string,
  teams: { id: number; name: string }[],
  regions: { id: number; name: string }[],
): string {
  const parsed = parseAudience(audience);
  if (parsed.kind === "all_org") return "All Organization";
  if (parsed.kind === "custom") return "Specific people";
  if (parsed.kind === "team" && parsed.targetId !== null) {
    const team = teams.find((t) => t.id === parsed.targetId);
    return team ? `Team: ${team.name}` : audience;
  }
  if (parsed.kind === "region" && parsed.targetId !== null) {
    const region = regions.find((r) => r.id === parsed.targetId);
    return region ? `Region: ${region.name}` : audience;
  }
  return audience;
}
