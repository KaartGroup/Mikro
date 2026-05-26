"use client";

import Link from "next/link";
import Image from "next/image";
import { useUser } from "@auth0/nextjs-auth0/client";
import { RolePreviewSwitcher } from "./RolePreviewSwitcher";

interface HeaderProps {
  displayName?: string;
}

export function Header({ displayName }: HeaderProps) {
  const { user, isLoading } = useUser();

  return (
    <header
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        backgroundColor: "var(--background)",
        borderBottom: "1px solid var(--border)",
        height: 64,
      }}
    >
      <div
        style={{
          display: "flex",
          height: "100%",
          alignItems: "center",
          justifyContent: "space-between",
          paddingLeft: 24,
          paddingRight: 24,
          maxWidth: "100%",
        }}
      >
        {/* Logo */}
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none" }}>
          <Image src="/mikro-logo.png" alt="Mikro" width={36} height={36} />
          <span style={{ fontSize: 20, fontWeight: 600, color: "var(--foreground)" }}>Mikro</span>
        </Link>

        {/* User Menu */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {isLoading ? (
            <div style={{ width: 32, height: 32, borderRadius: "50%", backgroundColor: "var(--border)" }} />
          ) : user ? (
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span className="hide-mobile" style={{ fontSize: 14, color: "var(--muted-foreground)" }}>
                {displayName || user.name || user.email}
              </span>
              <RolePreviewSwitcher />
              <Link
                href="/account"
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  color: "var(--foreground)",
                  textDecoration: "none",
                  padding: "8px 12px",
                  borderRadius: 6,
                  backgroundColor: "var(--secondary)",
                }}
              >
                Settings
              </Link>
              <a
                href="/auth/logout"
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  color: "var(--foreground)",
                  textDecoration: "none",
                  padding: "8px 12px",
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                }}
              >
                Logout
              </a>
            </div>
          ) : (
            <a
              href="/auth/login?prompt=login"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 6,
                backgroundColor: "#ff6b35",
                padding: "8px 16px",
                fontSize: 14,
                fontWeight: 500,
                color: "white",
                textDecoration: "none",
              }}
            >
              Sign In
            </a>
          )}
        </div>
      </div>
    </header>
  );
}
