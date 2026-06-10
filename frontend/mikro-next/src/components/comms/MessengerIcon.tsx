"use client";

import { useMessagesUnreadCount, useVisibilityPoll } from "@/hooks";
import { HeaderIconButton } from "./HeaderIconButton";
import { ROUTES } from "@/lib/routes";

/**
 * Header shortcut to the messenger page. Shows a red badge with the
 * user's total unread message count across all conversations (DMs +
 * org broadcast). Polls the count every 30s while the tab is visible.
 */
export function MessengerIcon() {
  const { data, refetch } = useMessagesUnreadCount();

  useVisibilityPoll(() => {
    refetch().catch(() => {});
  }, 30000);

  const unread = data?.unread_count ?? 0;

  return (
    <HeaderIconButton
      ariaLabel="Messages"
      unreadCount={unread}
      href={ROUTES.messages}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    </HeaderIconButton>
  );
}
