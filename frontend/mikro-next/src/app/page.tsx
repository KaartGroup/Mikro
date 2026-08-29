import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { LandingClient } from "./LandingClient";

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

  // NO backend sync here, and NO getAccessToken() — deliberately.
  //
  // This page only ever redirects to /dashboard, whose layout
  // ((authenticated)/layout.tsx) already calls syncUserWithBackend() on the
  // very next request. Doing it here too made every single login POST
  // /api/login twice, one second apart (confirmed in production logs).
  //
  // Worse, getAccessToken() cannot persist here: this is a Server Component,
  // and Server Components cannot set cookies, so a refreshed/rotated token is
  // silently discarded while the session cookie keeps the old one. Auth0's
  // own SDK v4 guidance is to refresh in middleware, never in a Server
  // Component. Token refresh belongs in src/middleware.ts.
  redirect("/dashboard");
}
