import { auth0 } from "@/lib/auth0";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";
import { AprilFools } from "@/components/layout/AprilFools";
import { WhatsNewModal } from "@/components/layout/WhatsNewModal";
import { AuthGuard } from "@/components/AuthGuard";

const BACKEND_URL = process.env.FLASK_BACKEND_URL || "http://localhost:5004";

interface UserInfo {
  name?: string;
  email?: string;
}

interface SyncResult {
  role: string;
  paymentsVisible: boolean;
  displayName: string;
}

async function syncUserWithBackend(accessToken: string, userInfo?: UserInfo): Promise<SyncResult> {
  try {
    const response = await fetch(`${BACKEND_URL}/api/login`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
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
      };
    }
    console.error("Failed to sync user with backend:", response.status);
    return { role: "user", paymentsVisible: false, displayName: "" };
  } catch (error) {
    console.error("Error syncing user with backend:", error);
    return { role: "user", paymentsVisible: false, displayName: "" };
  }
}

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

  const userId = (session.user.sub as string | undefined) ?? "";

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--muted)" }}>
      <AuthGuard />
      <AprilFools />
      <WhatsNewModal userId={userId} role={role} />
      <Header displayName={displayName} />
      <Sidebar
        role={role as "user" | "validator" | "team_admin" | "admin" | "super_admin"}
        paymentsVisible={paymentsVisible}
      />
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
  );
}
