"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUser } from "@auth0/nextjs-auth0/client";
import { SidebarClock } from "./SidebarClock";
import { Tooltip } from "@/components/ui";

interface SidebarProps {
  role: "user" | "validator" | "team_admin" | "admin" | "super_admin";
  paymentsVisible?: boolean;
}

interface NavItem {
  label: string;
  href: string;
  icon: string;
  tooltip?: string;
}

const userNavItems: NavItem[] = [
  { label: "Dashboard", href: "/user/dashboard", icon: "home" },
  { label: "Projects", href: "/user/projects", icon: "folder" },
  { label: "Time", href: "/user/time", icon: "clock" },
  { label: "Training", href: "/user/training", icon: "book" },
  { label: "Checklists", href: "/user/checklists", icon: "list" },
  { label: "Payments", href: "/user/payments", icon: "dollar" },
  { label: "Teams", href: "/user/teams", icon: "team" },
];

const validatorNavItems: NavItem[] = [
  { label: "Dashboard", href: "/validator/dashboard", icon: "home" },
  { label: "Projects", href: "/user/projects", icon: "folder" },
  { label: "Time", href: "/user/time", icon: "clock" },
  { label: "Training", href: "/user/training", icon: "book" },
  { label: "Checklists", href: "/validator/checklists", icon: "list" },
  { label: "Payments", href: "/user/payments", icon: "dollar" },
  { label: "Teams", href: "/user/teams", icon: "team" },
];

const adminNavItems: NavItem[] = [
  { label: "Dashboard", href: "/admin/dashboard", icon: "home" },
  { label: "Projects", href: "/admin/projects", icon: "folder" },
  // { label: "Tasks", href: "/admin/tasks", icon: "tasks" }, // Disabled until scope is clarified with project owner
  { label: "Time", href: "/admin/time", icon: "clock" },
  { label: "Time Categories", href: "/admin/time-categories", icon: "list", tooltip: "Configure tier-2 subcategories under each activity" },
  { label: "Training", href: "/admin/training", icon: "book" },
  { label: "Checklists", href: "/admin/checklists", icon: "list" },
  { label: "Users", href: "/admin/users", icon: "users" },
  { label: "Teams", href: "/admin/teams", icon: "team" },
  // OLD payments page hidden 2026-05-19 — kept in code for fallback;
  // route /admin/payments still works directly. Re-enable by un-commenting.
  // { label: "Payments", href: "/admin/payments", icon: "dollar" },
  { label: "Payments v2", href: "/admin/payments-v2", icon: "dollar", tooltip: "New — Payroll workspace" },
  { label: "Reports", href: "/admin/reports", icon: "chart" },
  { label: "Regions", href: "/admin/regions", icon: "globe" },
  { label: "Punks List", href: "/admin/punks", icon: "shield" },
  { label: "Friends List", href: "/admin/friends", icon: "users" },
  { label: "Transcribe", href: "/admin/transcribe", icon: "mic", tooltip: "New — Experimental Feature" },
];

// Team Admin sees a scoped subset: their teams' surface area only.
// Excludes org-wide admin pages (Regions, Friends, Punks, Transcribe)
// because team_admin endpoints there are gated to Org Admin / above.
const teamAdminNavItems: NavItem[] = [
  { label: "Dashboard", href: "/admin/dashboard", icon: "home" },
  { label: "Projects", href: "/admin/projects", icon: "folder" },
  { label: "Time", href: "/admin/time", icon: "clock" },
  { label: "Time Categories", href: "/admin/time-categories", icon: "list", tooltip: "Manage your teams' time subcategories" },
  { label: "Training", href: "/admin/training", icon: "book" },
  { label: "Checklists", href: "/admin/checklists", icon: "list" },
  { label: "Users", href: "/admin/users", icon: "users" },
  { label: "Teams", href: "/admin/teams", icon: "team" },
  // OLD payments page hidden 2026-05-19 — kept in code for fallback;
  // route /admin/payments still works directly. Re-enable by un-commenting.
  // { label: "Payments", href: "/admin/payments", icon: "dollar" },
  { label: "Payments v2", href: "/admin/payments-v2", icon: "dollar", tooltip: "New — Payroll workspace" },
  { label: "Reports", href: "/admin/reports", icon: "chart" },
];

const iconMap: Record<string, React.ReactNode> = {
  clock: (
    <svg style={{ width: 20, height: 20 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  home: (
    <svg style={{ width: 20, height: 20 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  ),
  external: (
    <svg style={{ width: 20, height: 20 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
    </svg>
  ),
  folder: (
    <svg style={{ width: 20, height: 20 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  ),
  dollar: (
    <svg style={{ width: 20, height: 20 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  book: (
    <svg style={{ width: 20, height: 20 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
    </svg>
  ),
  list: (
    <svg style={{ width: 20, height: 20 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
    </svg>
  ),
  users: (
    <svg style={{ width: 20, height: 20 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  ),
  tasks: (
    <svg style={{ width: 20, height: 20 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  team: (
    <svg style={{ width: 20, height: 20 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  ),
  chart: (
    <svg style={{ width: 20, height: 20 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  ),
  globe: (
    <svg style={{ width: 20, height: 20 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  shield: (
    <svg style={{ width: 20, height: 20 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  ),
  mic: (
    <svg style={{ width: 20, height: 20 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
    </svg>
  ),
  settings: (
    <svg style={{ width: 20, height: 20 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
};

export function Sidebar({ role, paymentsVisible = true }: SidebarProps) {
  const pathname = usePathname();
  const { user: clientUser } = useUser();

  const isAnyAdmin =
    role === "admin" || role === "super_admin" || role === "team_admin";

  const allNavItems =
    role === "team_admin"
      ? teamAdminNavItems
      : role === "admin" || role === "super_admin"
        ? adminNavItems
        : role === "validator"
          ? validatorNavItems
          : userNavItems;

  // Hide Payments link for non-admin users when payments not visible.
  // All admin tiers always see Payments (each tier's data is scoped
  // server-side).
  const navItems = isAnyAdmin
    ? allNavItems
    : paymentsVisible
      ? allNavItems
      : allNavItems.filter((item) => item.label !== "Payments");

  const linkBaseStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 12,
    borderRadius: 8,
    padding: "10px 12px",
    fontSize: 14,
    fontWeight: 500,
    textDecoration: "none",
    transition: "background-color 0.15s, color 0.15s",
  };

  const getNavLinkStyle = (isActive: boolean): React.CSSProperties => ({
    ...linkBaseStyle,
    backgroundColor: isActive ? "rgba(255, 107, 53, 0.1)" : "transparent",
    color: isActive ? "#ff6b35" : "var(--muted-foreground)",
  });

  return (
    <aside
      className="hide-mobile"
      style={{
        position: "fixed",
        left: 0,
        top: 64,
        zIndex: 40,
        height: "calc(100vh - 64px)",
        width: 180,
        borderRight: "1px solid var(--border)",
        backgroundColor: "var(--background)",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          padding: "16px 0",
        }}
      >
        <nav style={{ flex: 1, padding: "0 12px", overflowY: "auto" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {navItems.map((item) => {
              const isExternal = item.href.startsWith("http");
              const isActive = !isExternal && pathname === item.href;

              if (isExternal) {
                return (
                  <a
                    key={item.href}
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={getNavLinkStyle(false)}
                  >
                    {iconMap[item.icon]}
                    <span>{item.label}</span>
                  </a>
                );
              }

              // If client-side auth is lost, use hard navigation so
              // middleware can properly redirect to login
              if (!clientUser) {
                return (
                  <a
                    key={item.href}
                    href={item.href}
                    style={getNavLinkStyle(isActive)}
                  >
                    {iconMap[item.icon]}
                    <span>{item.label}</span>
                  </a>
                );
              }

              const link = (
                <Link
                  key={item.href}
                  href={item.href}
                  style={getNavLinkStyle(isActive)}
                >
                  {iconMap[item.icon]}
                  <span>{item.label}</span>
                </Link>
              );

              if (item.tooltip) {
                return (
                  <Tooltip key={item.href} content={item.tooltip} position="right" delay={200}>
                    {link}
                  </Tooltip>
                );
              }

              return link;
            })}
          </div>
        </nav>
        <SidebarClock />
      </div>
    </aside>
  );
}
