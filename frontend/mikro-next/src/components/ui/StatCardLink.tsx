"use client";

import Link from "next/link";

/**
 * Small corner affordance for stat cards: a clickable icon in the
 * upper-right that navigates to the page which best details the stat.
 *
 * Usage:
 *   <StatCardLink href="/admin/users" label="Manage users" />
 *
 * Or wrap an existing decorative SVG so the icon keeps its shape
 * but gains the link function:
 *   <StatCardLink href="/admin/users" label="Manage users">
 *     <svg>...</svg>
 *   </StatCardLink>
 *
 * Matches the conventional "↗" external-link feel without requiring
 * a new-tab target — the dashboards link to in-app detail pages.
 */
interface StatCardLinkProps {
  href: string;
  label: string;
  children?: React.ReactNode;
  className?: string;
}

export function StatCardLink({
  href,
  label,
  children,
  className,
}: StatCardLinkProps) {
  return (
    <Link
      href={href}
      className={
        "text-muted-foreground hover:text-kaart-orange transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded" +
        (className ? ` ${className}` : "")
      }
      aria-label={label}
      title={label}
    >
      {children ?? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          className="h-4 w-4"
        >
          <path d="M7 17L17 7" />
          <path d="M7 7h10v10" />
        </svg>
      )}
    </Link>
  );
}
