import Image from "next/image";

export default function WelcomePage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#f9fafb",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          backgroundColor: "white",
          borderRadius: 16,
          padding: 48,
          maxWidth: 480,
          width: "100%",
          margin: 16,
          boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          textAlign: "center",
        }}
      >
        <Image
          src="/mikro-logo.png"
          alt="Mikro"
          width={64}
          height={64}
          style={{ margin: "0 auto 24px" }}
        />
        <h1
          style={{
            fontSize: 24,
            fontWeight: 600,
            color: "#111827",
            marginBottom: 8,
          }}
        >
          Email Verified!
        </h1>
        <p
          style={{
            fontSize: 16,
            color: "#6b7280",
            marginBottom: 32,
            lineHeight: 1.6,
          }}
        >
          Your account is ready. Click below to log in.
        </p>
        <a
          href="/auth/login?prompt=login"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 8,
            backgroundColor: "#004e89",
            padding: "12px 32px",
            fontSize: 16,
            fontWeight: 500,
            color: "white",
            textDecoration: "none",
          }}
        >
          Log in to Mikro
        </a>
      </div>
    </div>
  );
}
