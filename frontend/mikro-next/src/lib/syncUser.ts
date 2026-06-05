const BACKEND_URL = process.env.FLASK_BACKEND_URL || "http://localhost:5004";

export interface UserInfo {
  name?: string;
  email?: string;
}

export interface SyncResult {
  role: string;
  paymentsVisible: boolean;
  displayName: string;
  /** Backend rejected this org (disabled/unknown) — caller routes to /wrong-org. */
  orgRejected: boolean;
}

/**
 * Resolve the user's role + flags from the backend DB (POST /api/login) —
 * the authoritative source of role. Shared by the authenticated layout
 * AND the `/` landing redirect so role routing can never diverge between
 * them (the divergence is what previously sent admins whose Auth0
 * `mikro/roles` claim was empty to /user/dashboard while their sidebar
 * correctly showed admin nav).
 *
 * Returns safe defaults ({ role: "user", ... }) on any failure. Callers
 * that must distinguish "genuine user" from "backend unavailable" should
 * combine this with the Auth0 token claim.
 */
export async function syncUserWithBackend(
  accessToken: string,
  userInfo?: UserInfo,
): Promise<SyncResult> {
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
        orgRejected: false,
      };
    }
    // A 403 with reason "org_not_active" means this org is disabled/unknown —
    // signal the caller to route to /wrong-org. ANY OTHER failure (500,
    // network) must NOT lock users out, so it falls through to safe defaults.
    if (response.status === 403) {
      try {
        const data = await response.json();
        if (data?.reason === "org_not_active") {
          return {
            role: "user",
            paymentsVisible: false,
            displayName: "",
            orgRejected: true,
          };
        }
      } catch {
        // Response wasn't JSON — fall through to safe defaults.
      }
    }
    console.error("Failed to sync user with backend:", response.status);
    return {
      role: "user",
      paymentsVisible: false,
      displayName: "",
      orgRejected: false,
    };
  } catch (error) {
    console.error("Error syncing user with backend:", error);
    return {
      role: "user",
      paymentsVisible: false,
      displayName: "",
      orgRejected: false,
    };
  }
}
