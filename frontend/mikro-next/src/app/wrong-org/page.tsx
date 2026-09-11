import { ROUTES } from "@/lib/routes";

export default function WrongOrgPage() {
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
          maxWidth: 520,
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
          Mikro isn&apos;t available for your organization
        </h1>
        <p style={{ color: "#4b5563", marginBottom: 16, lineHeight: 1.6 }}>
          Your organization isn&apos;t active in Mikro right now. That may be
          because access hasn&apos;t been set up yet, or because it has been
          disabled.
        </p>
        <p style={{ color: "#4b5563", marginBottom: 24, lineHeight: 1.6 }}>
          Contact your administrator to have access restored, or reach out to{" "}
          <a
            href="mailto:dev@kaart.com?subject=Mikro%20access%20for%20our%20organization"
            style={{ color: "#004e89", fontWeight: 600 }}
          >
            dev@kaart.com
          </a>{" "}
          if you think this is a mistake.
        </p>
        <p
          style={{
            color: "#6b7280",
            fontSize: 14,
            marginBottom: 32,
            lineHeight: 1.6,
          }}
        >
          If you meant to sign in with a different organization, log out and try
          again — you&apos;ll be able to pick the right one at the org selector.
        </p>
        <a
          href={ROUTES.authLogout}
          style={{
            display: "inline-block",
            backgroundColor: "#004e89",
            color: "white",
            fontWeight: 600,
            padding: "10px 24px",
            borderRadius: 6,
            textDecoration: "none",
          }}
        >
          Sign out and try a different account
        </a>
      </div>
    </div>
  );
}
