import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
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
 */
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

  const roles = session.user["mikro/roles"] as string[] | undefined;
  const role = roles?.[0] || "user";
  // All three admin tiers land on /admin/dashboard. Per-page guards
  // inside scope what each tier sees.
  if (role === "admin" || role === "super_admin" || role === "team_admin") {
    redirect("/admin/dashboard");
  } else if (role === "validator") {
    redirect("/validator/dashboard");
  } else {
    redirect("/user/dashboard");
  }
}
