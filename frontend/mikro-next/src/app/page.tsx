import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { syncUserWithBackend } from "@/lib/syncUser";
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

  // Sync user with the backend (creates/updates the user record).
  // Wrapped so a stale token doesn't prevent the redirect below.
  try {
    const tokenResponse = await auth0.getAccessToken();
    if (tokenResponse?.token) {
      await syncUserWithBackend(tokenResponse.token, {
        name: session.user?.name,
        email: session.user?.email,
      });
    }
  } catch {
    // Token/backend unavailable — proceed to dashboard anyway.
  }

  redirect("/dashboard");
}
