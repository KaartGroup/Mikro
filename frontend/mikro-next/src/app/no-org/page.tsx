export default function NoOrgPage() {
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
          No Organization Found
        </h1>
        <p style={{ color: "#4b5563", marginBottom: 24, lineHeight: 1.6 }}>
          Your account isn&apos;t associated with an organization. This can
          happen with a test account or an account that hasn&apos;t been invited
          to an organization yet.
        </p>
        <p
          style={{
            color: "#6b7280",
            fontSize: 14,
            marginBottom: 32,
            lineHeight: 1.6,
          }}
        >
          Log out and sign in with your organization account, or contact your
          administrator for an invitation.
        </p>
        <a
          href="/auth/logout"
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
          Log Out &amp; Try Again
        </a>
      </div>
    </div>
  );
}
