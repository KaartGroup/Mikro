"use client";

import Link from "next/link";
import { CSSProperties, ReactNode, forwardRef } from "react";
import { CountBadge } from "./CountBadge";

// Shared shell for header nav icons (NotificationBell, MessengerIcon).
// 36px square button with border. Supports an optional unread-count
// badge in the upper right via the `unreadCount` prop.

const shellStyle: CSSProperties = {
  position: "relative",
  width: 36,
  height: 36,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--background)",
  color: "var(--foreground)",
  textDecoration: "none",
  cursor: "pointer",
  padding: 0,
};

interface HeaderIconButtonProps {
  children: ReactNode; // the SVG icon
  ariaLabel: string;
  unreadCount?: number;
  href?: string; // render as <Link> if set
  onClick?: () => void; // render as <button> if set
}

export const HeaderIconButton = forwardRef<HTMLElement, HeaderIconButtonProps>(
  function HeaderIconButton(
    { children, ariaLabel, unreadCount, href, onClick },
    ref,
  ) {
    const body = (
      <>
        {children}
        {unreadCount !== undefined && unreadCount > 0 && (
          <CountBadge count={unreadCount} position="absolute-top-right" />
        )}
      </>
    );
    if (href) {
      return (
        <Link
          ref={ref as React.ForwardedRef<HTMLAnchorElement>}
          href={href}
          aria-label={
            unreadCount ? `${ariaLabel} (${unreadCount} unread)` : ariaLabel
          }
          style={shellStyle}
        >
          {body}
        </Link>
      );
    }
    return (
      <button
        ref={ref as React.ForwardedRef<HTMLButtonElement>}
        onClick={onClick}
        aria-label={
          unreadCount ? `${ariaLabel} (${unreadCount} unread)` : ariaLabel
        }
        style={shellStyle}
      >
        {body}
      </button>
    );
  },
);
