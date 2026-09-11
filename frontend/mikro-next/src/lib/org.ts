/**
 * Organization resolution — the single place the frontend decides which org a
 * session belongs to, and the single definition of the backend's org verdict.
 *
 * WHY THIS EXISTS
 *
 * Three separate places used to compute the org inline and hard-redirect to
 * /no-org when it came out empty: lib/auth0.ts (onCallback), app/page.tsx, and
 * app/(authenticated)/layout.tsx. All three read only ID-token claims and none
 * of them ever asked the backend — which meant a user whose Mikro row held the
 * correct organization was still refused, because the claim was the only thing
 * consulted. That is exactly the failure reported on 2026-09-10: the org-picker
 * login showed "No Organization Found" to a confirmed org member, while the
 * personal-account login worked.
 *
 * The backend now resolves org through a 3-tier chain (native claim →
 * namespaced claim → the caller's DB row) in backend/api/auth/auth.py, and
 * POST /api/login is the authority on whether a session may proceed. The
 * frontend's job is to ASK, not to pre-judge.
 *
 * Claim precedence here matches the backend's tiers 1 and 2 so the two agree:
 * Auth0's native `org_id` (emitted on an org-scoped login, and the strongest
 * signal because Auth0 itself verified membership) before the namespaced
 * `mikro/org_id` from app_metadata.
 */

/** Namespace for Mikro's Auth0 custom claims. Matches AUTH0_NAMESPACE server-side. */
export const CLAIM_NAMESPACE = "mikro";

/** Auth0 organization ids look like `org_XXXXXXXX`. */
const ORG_ID_RE = /^org_[A-Za-z0-9]+$/;

function validOrgId(value: unknown): value is string {
  return typeof value === "string" && ORG_ID_RE.test(value);
}

/**
 * Read an org id out of a session user's claims, or `undefined`.
 *
 * NOTE: absence is NOT grounds for rejecting the user. The DB may still know
 * their org — only the backend can say. Use this for display, telemetry and
 * as a hint; never as a gate. `orgVerdict` is the gate.
 */
export function orgIdFromClaims(
  user: Record<string, unknown> | null | undefined,
): string | undefined {
  if (!user) return undefined;

  const native = user["org_id"];
  if (validOrgId(native)) return native;

  const namespaced = user[`${CLAIM_NAMESPACE}/org_id`];
  if (validOrgId(namespaced)) return namespaced;

  return undefined;
}

/** Which claim supplied the org — for logging, not for decisions. */
export function orgClaimSource(
  user: Record<string, unknown> | null | undefined,
): "native" | "namespaced" | null {
  if (!user) return null;
  if (validOrgId(user["org_id"])) return "native";
  if (validOrgId(user[`${CLAIM_NAMESPACE}/org_id`])) return "namespaced";
  return null;
}

/**
 * The backend's verdict on a session, as returned by POST /api/login.
 *
 * - `ok`          — proceed.
 * - `no_org`      — the backend could not resolve an organization by ANY tier,
 *                   including the user's own DB row. Genuinely org-less. → /no-org
 * - `org_not_active` — the org exists but is disabled or unknown. → /wrong-org
 * - `unavailable` — the backend could not be reached or errored. Deliberately
 *                   NOT a rejection: a backend blip must never lock users out,
 *                   so callers fall through to safe defaults.
 */
export type OrgVerdict = "ok" | "no_org" | "org_not_active" | "unavailable";

/** Reason strings the backend sends on a 403. Keep in sync with Login.py. */
export const BACKEND_REASON = {
  noOrg: "no_org",
  orgNotActive: "org_not_active",
} as const;

/**
 * Where a verdict should send the user, or `null` to stay put.
 * Single source of truth for org routing — callers must not re-derive it.
 */
export function redirectForVerdict(verdict: OrgVerdict): string | null {
  switch (verdict) {
    case "no_org":
      return "/no-org";
    case "org_not_active":
      return "/wrong-org";
    case "ok":
    case "unavailable":
      return null;
  }
}
