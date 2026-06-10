import { ROUTES } from "@/lib/routes";

/**
 * Unauthorized landing. Previously this did `redirect("/auth/login")`
 * which silently fed a dashboard→unauthorized→login→dashboard loop
 * when a user's role gate disagreed with their JWT claims. Now it's
 * a real stopping point with explicit actions, so the loop can't
 * continue and the user sees what's happening.
 */
export default function UnauthorizedPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#f9fafb",
      }}
    >
      <div
        style={{
          maxWidth: 480,
          width: "100%",
          backgroundColor: "white",
          borderRadius: 12,
          boxShadow: "0 10px 25px rgba(0,0,0,0.08)",
          padding: 32,
          textAlign: "center",
        }}
      >
        <h1
          style={{
            fontSize: 24,
            fontWeight: 700,
            color: "#111827",
            marginBottom: 16,
          }}
        >
          Access Denied
        </h1>
        <p style={{ color: "#4b5563", marginBottom: 24, lineHeight: 1.6 }}>
          Your account doesn&apos;t have permission to view this page.
        </p>
        <p
          style={{
            color: "#6b7280",
            fontSize: 14,
            marginBottom: 32,
            lineHeight: 1.6,
          }}
        >
          If you think this is a mistake, log out and sign back in, or contact
          your administrator.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <a
            href={ROUTES.home}
            style={{
              display: "inline-block",
              backgroundColor: "#e5e7eb",
              color: "#111827",
              fontWeight: 600,
              padding: "10px 24px",
              borderRadius: 6,
              textDecoration: "none",
            }}
          >
            Home
          </a>
          <a
            href={ROUTES.authLogout}
            style={{
              display: "inline-block",
              backgroundColor: "#dc2626",
              color: "white",
              fontWeight: 600,
              padding: "10px 24px",
              borderRadius: 6,
              textDecoration: "none",
            }}
          >
            Log out
          </a>
        </div>
      </div>
    </div>
  );
}
