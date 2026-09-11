import { BACKEND_REASON, type OrgVerdict } from "@/lib/org";

const BACKEND_URL = process.env.FLASK_BACKEND_URL || "http://localhost:5004";

interface UserInfo {
  name?: string;
  email?: string;
}

export interface SyncResult {
  role: string;
  paymentsVisible: boolean;
  displayName: string;
  /**
   * The backend's org verdict. This — not any token claim — decides whether a
   * session may proceed. See src/lib/org.ts for what each value means and
   * `redirectForVerdict` for where each one routes.
   */
  verdict: OrgVerdict;
}

/**
 * Resolve the user's role + flags + org verdict from the backend
 * (POST /api/login) — the authoritative source for all three.
 *
 * Shared by the authenticated layout AND the `/` landing redirect so role
 * routing can never diverge between them (that divergence is what previously
 * sent admins whose Auth0 `mikro/roles` claim was empty to /user/dashboard
 * while their sidebar correctly showed admin nav).
 *
 * ORG AUTHORITY: the backend resolves org through a 3-tier chain (native
 * claim → namespaced claim → the caller's own DB row; see
 * backend/api/auth/auth.py). That is why the frontend must ask rather than
 * pre-judge on a claim: a member whose token carries no org claim still has
 * one in the database, and rejecting them on the claim alone is the
 * "No Organization Found" bug reported on 2026-09-10.
 *
 * FAILURE MODE IS DELIBERATE: any failure that is not an explicit org
 * rejection returns `verdict: "unavailable"` with safe defaults, so a backend
 * outage under-privileges rather than locks out. Only an explicit 403 with a
 * known reason rejects.
 */
export async function syncUserWithBackend(
  accessToken: string,
  userInfo?: UserInfo,
): Promise<SyncResult> {
  const safeDefaults = (verdict: OrgVerdict): SyncResult => ({
    role: "user",
    paymentsVisible: false,
    displayName: "",
    verdict,
  });

  try {
    const response = await fetch(`${BACKEND_URL}/api/login`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(userInfo || {}),
    });

    if (response.ok) {
      const data = await response.json();
      return {
        role: data.role || "user",
        paymentsVisible: data.micropayments_visible ?? false,
        displayName: data.name || "",
        verdict: "ok",
      };
    }

    // A 403 carries an explicit machine-readable reason. Those — and only
    // those — are real rejections.
    if (response.status === 403) {
      try {
        const data = await response.json();
        if (data?.reason === BACKEND_REASON.orgNotActive) {
          return safeDefaults("org_not_active");
        }
        if (data?.reason === BACKEND_REASON.noOrg) {
          return safeDefaults("no_org");
        }
      } catch {
        // Response wasn't JSON — treat as unavailable, not as a rejection.
      }
    }

    console.error("Failed to sync user with backend:", response.status);
    return safeDefaults("unavailable");
  } catch (error) {
    console.error("Error syncing user with backend:", error);
    return safeDefaults("unavailable");
  }
}
