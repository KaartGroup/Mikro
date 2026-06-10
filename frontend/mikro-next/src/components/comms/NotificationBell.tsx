"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  useNotificationUnreadCount,
  useNotifications,
  useMarkNotificationsRead,
  useVisibilityPoll,
} from "@/hooks";
import type { Notification } from "@/types";
import { relativeTime } from "@/lib/relativeTime";
import { HeaderIconButton } from "./HeaderIconButton";

/**
 * F9 — bell + dropdown panel for in-app notifications. Polls the
 * unread count every 30s while the tab is visible. Fetches the full
 * list on panel open.
 *
 * Per the comms-platform plan, in-app bell rows are ALWAYS created
 * regardless of user preferences (prefs only control email delivery).
 */

export function NotificationBell() {
  const router = useRouter();
  const { data: unreadData, refetch: refetchUnread } =
    useNotificationUnreadCount();
  const { mutate: fetchList } = useNotifications();
  const { mutate: markRead } = useMarkNotificationsRead();

  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLElement | null>(null);

  // Poll unread count every 30s while tab is visible.
  useVisibilityPoll(() => {
    refetchUnread().catch(() => {});
  }, 30000);

  // Close the panel when clicking outside.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const loadList = useCallback(async () => {
    setListLoading(true);
    try {
      const res = await fetchList({ limit: 20, offset: 0 });
      setItems(res?.notifications || []);
    } catch {
      setItems([]);
    } finally {
      setListLoading(false);
    }
  }, [fetchList]);

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next) loadList();
  };

  const handleItemClick = async (n: Notification) => {
    // Mark as read optimistically, then navigate.
    if (!n.is_read) {
      setItems((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)),
      );
      try {
        await markRead({ ids: [n.id] });
        refetchUnread().catch(() => {});
      } catch {
        /* swallow — best-effort */
      }
    }
    setOpen(false);
    if (n.link) router.push(n.link);
  };

  const handleMarkAllRead = async () => {
    try {
      await markRead({});
      setItems((prev) => prev.map((x) => ({ ...x, is_read: true })));
      refetchUnread().catch(() => {});
    } catch {
      /* swallow */
    }
  };

  const unread = unreadData?.unread_count ?? 0;

  return (
    <div style={{ position: "relative" }}>
      <HeaderIconButton
        ref={buttonRef}
        ariaLabel="Notifications"
        unreadCount={unread}
        onClick={handleToggle}
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
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
      </HeaderIconButton>

      {open && (
        <div
          ref={panelRef}
          style={{
            position: "absolute",
            top: 44,
            right: 0,
            width: 360,
            maxHeight: 480,
            overflow: "auto",
            borderRadius: 10,
            border: "1px solid var(--border)",
            background: "var(--background)",
            boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
            zIndex: 60,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 14px",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 14 }}>Notifications</span>
            {items.some((x) => !x.is_read) && (
              <button
                onClick={handleMarkAllRead}
                style={{
                  fontSize: 12,
                  color: "#ff6b35",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                Mark all read
              </button>
            )}
          </div>
          {listLoading ? (
            <div
              style={{
                padding: 20,
                fontSize: 13,
                color: "var(--muted-foreground)",
              }}
            >
              Loading…
            </div>
          ) : items.length === 0 ? (
            <div
              style={{
                padding: 20,
                fontSize: 13,
                color: "var(--muted-foreground)",
                textAlign: "center",
              }}
            >
              You&apos;re all caught up.
            </div>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => handleItemClick(n)}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 14px",
                      border: "none",
                      borderBottom: "1px solid var(--border)",
                      background: n.is_read
                        ? "transparent"
                        : "rgba(255,107,53,0.06)",
                      cursor: "pointer",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 13,
                        color: "var(--foreground)",
                        fontWeight: n.is_read ? 400 : 600,
                        lineHeight: 1.35,
                      }}
                    >
                      {!n.is_read && (
                        <span
                          style={{
                            display: "inline-block",
                            width: 6,
                            height: 6,
                            borderRadius: 3,
                            background: "#ff6b35",
                            marginRight: 6,
                            verticalAlign: "middle",
                          }}
                        />
                      )}
                      {n.message}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--muted-foreground)",
                        marginTop: 4,
                      }}
                    >
                      {relativeTime(n.created_at)}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
