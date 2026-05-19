import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { syncUserWithBackend } from "@/lib/syncUser";
import { LandingClient } from "./LandingClient";

/**
 * Landing page — server component.
 *
 * Authoritatively resolves session state server-side via auth0.getSession()
 * so we never hit the stale-client-cache problem where a just-logged-out
 * user gets bounced back into the authenticated area because SWR still
 * has the old user object warm.
 *
 * Flow:
 *   - No session           -> render the LandingClient (carousel + Login / Sign Up)
 *   - Session, no org      -> /no-org
 *   - Session + org + role -> appropriate role dashboard
 *
 * Role source: the backend DB (POST /api/login) — the SAME authoritative
 * source the authenticated layout/sidebar use. The Auth0 ID-token claim
 * `mikro/roles` is only a fallback: it is empty for accounts whose
 * app_metadata was never synced, which previously misrouted admins to
 * /user/dashboard while their sidebar correctly showed admin nav.
 */
function dashboardForRoles(...roles: Array<string | undefined>): string {
  const present = new Set(roles.filter(Boolean) as string[]);
  if (
    present.has("admin") ||
    present.has("super_admin") ||
    present.has("team_admin")
  ) {
    return "/admin/dashboard";
  }
  if (present.has("validator")) {
    return "/validator/dashboard";
  }
  return "/user/dashboard";
}

export default async function LandingPage() {
  const session = await auth0.getSession();

  if (!session) {
    return <LandingClient />;
  }

  const orgId =
    (session.user["mikro/org_id"] as string | undefined) ??
    (session.user.org_id as string | undefined);
  if (!orgId) {
    redirect("/no-org");
  }

  // Authoritative role from the backend — the same call the authenticated
  // layout makes. Wrapped so a thrown getAccessToken (stale token) falls
  // back to the token claim; redirect() is called AFTER the try so its
  // control-flow throw is never swallowed here.
  let dbRole: string | undefined;
  try {
    const tokenResponse = await auth0.getAccessToken();
    if (tokenResponse?.token) {
      const sync = await syncUserWithBackend(tokenResponse.token, {
        name: session.user?.name,
        email: session.user?.email,
      });
      dbRole = sync.role;
    }
  } catch {
    // Token/backend unavailable — fall back to the token claim below.
  }

  const claimRole = (session.user["mikro/roles"] as string[] | undefined)?.[0];

  // Route by whichever source grants the most access, so neither an empty
  // token claim nor a transient backend hiccup can misroute a privileged
  // user. Worst case equals the previous behavior.
  redirect(dashboardForRoles(dbRole, claimRole));
}
