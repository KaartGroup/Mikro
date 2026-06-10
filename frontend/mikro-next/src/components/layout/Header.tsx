"use client";

import Link from "next/link";
import Image from "next/image";
import { useRole } from "@/contexts/RoleContext";
import { RolePreviewSwitcher } from "./RolePreviewSwitcher";
import { MessengerIcon } from "@/components/comms/MessengerIcon";
import { NotificationBell } from "@/components/comms/NotificationBell";
import { ROUTES } from "@/lib/routes";

interface HeaderProps {
  displayName?: string;
}

export function Header({ displayName }: HeaderProps) {
  const { displayName: contextName, email } = useRole();
  const name = displayName || contextName || email;

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
        <Link
          href={ROUTES.home}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            textDecoration: "none",
          }}
        >
          <Image src="/mikro-logo.png" alt="Mikro" width={36} height={36} />
          <span
            style={{
              fontSize: 20,
              fontWeight: 600,
              color: "var(--foreground)",
            }}
          >
            Mikro
          </span>
        </Link>

        {/* User Menu */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span
              className="hide-mobile"
              style={{ fontSize: 14, color: "var(--muted-foreground)" }}
            >
              {name}
            </span>
            <MessengerIcon />
            <NotificationBell />
            <RolePreviewSwitcher />
            <Link
              href={ROUTES.account}
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
              href={ROUTES.authLogout}
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
        </div>
      </div>
    </header>
  );
}
