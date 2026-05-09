import { auth0 } from "@/lib/auth0";
import { redirect } from "next/navigation";

const BACKEND_URL = process.env.FLASK_BACKEND_URL || "http://localhost:5004";

interface UserInfo {
  name?: string;
  email?: string;
}

async function getUserRole(accessToken: string, userInfo?: UserInfo): Promise<string> {
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
      return data.role || "user";
    }
    return "user";
  } catch {
    return "user";
  }
}

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth0.getSession();

  if (!session) {
    redirect("/auth/login");
  }

  // Get role from backend
  let role = "user";
  try {
    const tokenResponse = await auth0.getAccessToken();
    if (!tokenResponse?.token) {
      redirect("/auth/login");
    }
    const userInfo = {
      name: session.user?.name,
      email: session.user?.email,
    };
    role = await getUserRole(tokenResponse.token, userInfo);
  } catch {
    // Token retrieval failed — session expired, force re-login
    redirect("/auth/login");
  }

  // Any admin tier can access /admin/*. Per-page guards inside each
  // page decide what each tier sees. team_admin gets a scoped subset.
  const adminTiers = new Set(["admin", "super_admin", "team_admin"]);
  if (!adminTiers.has(role)) {
    redirect("/unauthorized");
  }

  return <>{children}</>;
}
