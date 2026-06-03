import { auth0 } from "@/lib/auth0";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";
import { AprilFools } from "@/components/layout/AprilFools";
import { AuthGuard } from "@/components/AuthGuard";
import { syncUserWithBackend } from "@/lib/syncUser";
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

  // Users without an org_id (test accounts, unassociated invites) cannot
  // use the app — backend sync and all role-scoped data depend on org_id.
  // Prefer the namespaced claim set from app_metadata; fall back to native.
  const orgId =
    (session.user["mikro/org_id"] as string | undefined) ??
    (session.user.org_id as string | undefined);
  if (!orgId) {
    redirect("/no-org");
  }

  // Sync user with backend and get role from database
  let role = "user";
  let paymentsVisible = false;
  let displayName = "";
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
  } catch {
    // Token retrieval failed — session expired, force re-login
    redirect("/auth/logout");
  }

  // All admin tiers always see Payments. Per-page server scoping
  // decides what each tier actually sees — for team_admin the data
  // narrows to managed-team users; nav stays visible.
  if (role === "admin" || role === "super_admin" || role === "team_admin") {
    paymentsVisible = true;
  }

  return (
    <RoleProvider
      initialRole={role as UserRole}
      initialActualRole={role as UserRole}
      initialPaymentsVisible={paymentsVisible}
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
