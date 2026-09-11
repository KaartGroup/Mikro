import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { LandingClient } from "./LandingClient";

export default async function LandingPage() {
  const session = await auth0.getSession();

  if (!session) {
    return <LandingClient />;
  }

  // NO org gate here — deliberately.
  //
  // This page used to redirect to /no-org whenever the ID token carried no org
  // claim. That refused confirmed org members whose Mikro row held the correct
  // org_id (the "No Organization Found" bug of 2026-09-10): the claim is not
  // the source of truth, the database is. The only authoritative check is the
  // backend verdict from POST /api/login, and (authenticated)/layout.tsx makes
  // it one request later — so this page's entire job is to send a logged-in
  // user to /dashboard.
  //
  // NO backend sync here, and NO getAccessToken() — also deliberately.
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
