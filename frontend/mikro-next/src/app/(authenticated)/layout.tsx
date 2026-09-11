import { auth0 } from "@/lib/auth0";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";
import { AprilFools } from "@/components/layout/AprilFools";
import { AuthGuard } from "@/components/AuthGuard";
import { syncUserWithBackend } from "@/lib/syncUser";
import { redirectForVerdict, type OrgVerdict } from "@/lib/org";
import { RoleProvider } from "@/contexts/RoleContext";
import type { UserRole } from "@/types";

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth0.getSession();

  if (!session) {
    redirect("/auth/logout");
  }

  // NO claim-based org gate here. This used to reject anyone whose ID token
  // carried no org claim, which refused confirmed org members whose Mikro row
  // held the correct org_id (the "No Organization Found" bug of 2026-09-10).
  // The backend resolves org through a 3-tier chain that includes the user's DB
  // row, so its verdict — obtained from the sync below — is the only authority.

  // Sync user with backend and get role + org verdict from database
  let role = "user";
  let paymentsVisible = false;
  let displayName = "";
  let orgVerdict: OrgVerdict = "unavailable";
  try {
    const tokenResponse = await auth0.getAccessToken();
    if (!tokenResponse?.token) {
      // No valid access token — session is stale, force re-login
      redirect("/auth/logout");
    }
    // Pass user info from session to backend for syncing
    const userInfo = {
      name: session.user?.name,
      email: session.user?.email,
    };
    const syncResult = await syncUserWithBackend(tokenResponse.token, userInfo);
    role = syncResult.role;
    paymentsVisible = syncResult.paymentsVisible;
    displayName = syncResult.displayName;
    orgVerdict = syncResult.verdict;
  } catch {
    // Token retrieval failed — session expired, force re-login
    redirect("/auth/logout");
  }

  // Act on the backend's org verdict. Done OUTSIDE the try/catch above so
  // redirect()'s control-flow throw (NEXT_REDIRECT) isn't swallowed by that
  // catch and turned into a logout — the verdict is CAPTURED inside the try and
  // ACTED ON here, and that split must stay.
  //
  // redirectForVerdict() is the single source of truth for this routing (see
  // src/lib/org.ts); do not re-derive the destinations here. It returns null
  // for "unavailable", which is DELIBERATE: a backend outage or a non-JSON
  // error must never lock users out, so we fall through to the safe defaults
  // above (role "user", payments hidden) — under-privilege, not lockout.
  const orgRedirect = redirectForVerdict(orgVerdict);
  if (orgRedirect) {
    redirect(orgRedirect);
  }

  return (
    <RoleProvider
      initialRole={role as UserRole}
      initialActualRole={role as UserRole}
      initialPaymentsVisible={paymentsVisible}
      sub={session.user.sub ?? ""}
      displayName={displayName}
      email={session.user.email ?? ""}
    >
      <div style={{ minHeight: "100vh", backgroundColor: "var(--muted)" }}>
        <AuthGuard />
        <AprilFools />
<Header displayName={displayName} />
        <Sidebar />
        <main
          className="main-content"
          style={{
            paddingTop: 64,
            paddingBottom: 120,
          }}
        >
<div style={{ padding: 24 }}>{children}</div>
        </main>
      </div>
    </RoleProvider>
  );
}
