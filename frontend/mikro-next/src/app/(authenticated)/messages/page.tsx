"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import { useUser } from "@auth0/nextjs-auth0/client";
import {
  useConversations,
  useMessageThread,
  useSendMessage,
  useMarkMessagesRead,
  useUsersList,
} from "@/hooks";
import { useRole } from "@/contexts/RoleContext";
import type { Conversation, Message, MessageScopeType, User } from "@/types";
import { isAnyAdmin } from "@/types";
import { relativeTime } from "@/lib/relativeTime";
import { CountBadge } from "@/components/comms/CountBadge";

/*
 * Messenger page — two-pane layout. Left: conversation list grouped by
 * scope. Right: thread view + composer. Polls the active thread every 5s
 * while open; conversation list refreshes every 30s.
 *
 * V1 SCOPE-DOWN: the comms service is app-agnostic — it targets DMs
 * (scope_type "user"), opaque "group" keys, and "org" broadcasts. Mikro
 * does not yet resolve team/region membership → recipient subs for the
 * "group" path, so this UI is scoped to Direct Messages + Organization
 * broadcast only. The donor's team/region tabs are intentionally dropped;
 * re-add them once Mikro wires group_keys + recipient_user_ids resolution.
 */

const TARGET_LABELS: Record<MessageScopeType, string> = {
  user: "Direct Messages",
  group: "Groups",
  org: "Organization",
};

function MessagesPageInner() {
  const params = useSearchParams();
  const initialScopeType = (params.get("scope") ||
    params.get("scope_type") ||
    "") as MessageScopeType | "";
  const initialScopeKey = params.get("key") || params.get("scope_key") || "";

  const { user: authUser } = useUser();
  const myId = authUser?.sub ?? "";
  const { role } = useRole();
  const amAdmin = isAnyAdmin(role);

  const { data: convData, refetch: refetchConversations } = useConversations();
  const { mutate: fetchThread } = useMessageThread();
  const { mutate: sendMessage, loading: sending } = useSendMessage();
  const { mutate: markRead } = useMarkMessagesRead();
  const { data: usersData } = useUsersList();

  // sub → display name map, used to label DM/org message senders (comms
  // returns only sender_id, never a display name — it's app-agnostic).
  const nameBySub = useMemo(() => {
    const map: Record<string, string> = {};
    (usersData?.users ?? []).forEach((u: User) => {
      if (u.id) map[u.id] = u.name || u.email || u.id;
    });
    return map;
  }, [usersData]);

  const [selected, setSelected] = useState<{
    scope_type: MessageScopeType;
    scope_key: string;
    label: string;
  } | null>(null);
  const [thread, setThread] = useState<Message[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [composer, setComposer] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  const conversations: Conversation[] = useMemo(
    () => convData?.conversations ?? [],
    [convData],
  );

  // Auto-select from URL on first load if provided.
  useEffect(() => {
    if (selected) return;
    if (initialScopeType && initialScopeKey && conversations.length > 0) {
      const match = conversations.find(
        (c) =>
          c.scope_type === initialScopeType && c.scope_key === initialScopeKey,
      );
      if (match) {
        setSelected({
          scope_type: match.scope_type,
          scope_key: match.scope_key,
          label: match.label,
        });
        return;
      }
      // Not in the list yet (first message never sent) — still select it.
      setSelected({
        scope_type: initialScopeType,
        scope_key: initialScopeKey,
        label: "Conversation",
      });
    }
  }, [conversations, initialScopeKey, initialScopeType, selected]);

  // Poll conversation list every 30s.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        refetchConversations().catch(() => {});
      }
    }, 30000);
    return () => window.clearInterval(id);
  }, [refetchConversations]);

  // showLoading=true only on the first load of a conversation. Background
  // polls (every 5s) pass false so the pane never flips back to a "Loading…"
  // spinner — which, on an empty thread, made it flash between "Loading…" and
  // "No messages yet" every 5 seconds.
  const loadThread = useCallback(
    async (showLoading = false) => {
      if (!selected) return;
      if (showLoading) setThreadLoading(true);
      try {
        const res = await fetchThread({
          scope_type: selected.scope_type,
          scope_key: selected.scope_key,
          limit: 100,
          offset: 0,
        });
        setThread(res?.messages || []);
      } catch {
        if (showLoading) setThread([]);
      } finally {
        if (showLoading) setThreadLoading(false);
      }
    },
    [selected, fetchThread],
  );

  // Load + poll the selected thread.
  useEffect(() => {
    if (!selected) {
      setThread([]);
      return;
    }
    setThread([]); // clear the previous conversation's messages immediately
    loadThread(true);
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") loadThread(false);
    }, 5000);
    return () => window.clearInterval(id);
  }, [selected, loadThread]);

  // Mark read on open + when new messages arrive.
  useEffect(() => {
    if (!selected || thread.length === 0) return;
    markRead({
      scope_type: selected.scope_type,
      scope_key: selected.scope_key,
    })
      .catch(() => {})
      .then(() => refetchConversations().catch(() => {}));
  }, [selected, thread.length, markRead, refetchConversations]);

  // Autoscroll to bottom on new messages.
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread.length]);

  const handleSend = async () => {
    if (!selected || !composer.trim()) return;
    setSendError(null);
    const body: Record<string, unknown> = {
      target_type: selected.scope_type,
      content: composer.trim(),
    };
    // DM → target_user_id; org broadcast needs no extra targeting.
    if (selected.scope_type === "user")
      body.target_user_id = selected.scope_key;
    try {
      await sendMessage(body);
      setComposer("");
      await loadThread(false);
      refetchConversations().catch(() => {});
    } catch (err) {
      // Surface the failure instead of swallowing it (was silent).
      setSendError(
        err instanceof Error && err.message
          ? err.message
          : "Couldn't send — please try again.",
      );
    }
  };

  const grouped = useMemo(() => {
    const g: Record<MessageScopeType, Conversation[]> = {
      user: [],
      group: [],
      org: [],
    };
    conversations.forEach((c) => {
      if (g[c.scope_type]) g[c.scope_type].push(c);
    });
    return g;
  }, [conversations]);

  const senderLabel = (m: Message): string =>
    nameBySub[m.sender_id] || m.sender_id;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "320px 1fr",
        gap: 16,
        height: "calc(100vh - 64px - 48px)",
      }}
    >
      {/* Left pane: conversation list */}
      <div
        style={{
          borderRight: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        <div
          style={{
            padding: 12,
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Messages</h2>
          <button
            onClick={() => setShowNewModal(true)}
            style={{
              padding: "6px 10px",
              fontSize: 12,
              fontWeight: 600,
              background: "#ff6b35",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            + New
          </button>
        </div>
        <div style={{ overflowY: "auto", flex: 1 }}>
          {(["user", "group", "org"] as MessageScopeType[]).map((scope) => {
            const rows = grouped[scope];
            if (rows.length === 0) return null;
            return (
              <div key={scope}>
                <div
                  style={{
                    padding: "8px 12px",
                    fontSize: 11,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                    color: "var(--muted-foreground)",
                    background: "var(--muted)",
                  }}
                >
                  {TARGET_LABELS[scope]}
                </div>
                {rows.map((c) => {
                  const isActive =
                    selected?.scope_type === c.scope_type &&
                    selected.scope_key === c.scope_key;
                  return (
                    <button
                      key={`${c.scope_type}:${c.scope_key}`}
                      onClick={() =>
                        setSelected({
                          scope_type: c.scope_type,
                          scope_key: c.scope_key,
                          label: c.label,
                        })
                      }
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        padding: "10px 12px",
                        border: "none",
                        borderBottom: "1px solid var(--border)",
                        background: isActive
                          ? "rgba(255,107,53,0.1)"
                          : "transparent",
                        cursor: "pointer",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <span style={{ fontWeight: 600, fontSize: 13 }}>
                          {c.label}
                        </span>
                        <CountBadge count={c.unread_count} position="inline" />
                      </div>
                      {c.last_message && (
                        <div
                          style={{
                            fontSize: 11,
                            color: "var(--muted-foreground)",
                            marginTop: 4,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          <span style={{ fontWeight: 500 }}>
                            {senderLabel(c.last_message)}:
                          </span>{" "}
                          {c.last_message.content}
                        </div>
                      )}
                      {c.last_message && (
                        <div
                          style={{
                            fontSize: 10,
                            color: "var(--muted-foreground)",
                            marginTop: 2,
                          }}
                        >
                          {relativeTime(c.last_message.created_at)}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
          {conversations.length === 0 && (
            <div
              style={{
                padding: 20,
                fontSize: 13,
                color: "var(--muted-foreground)",
              }}
            >
              No conversations yet. Click <strong>+ New</strong> to start one.
            </div>
          )}
        </div>
      </div>

      {/* Right pane: thread view */}
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        {!selected ? (
          <div
            style={{
              padding: 40,
              color: "var(--muted-foreground)",
              textAlign: "center",
            }}
          >
            Select a conversation to view messages, or start a new one.
          </div>
        ) : (
          <>
            <div
              style={{ padding: 12, borderBottom: "1px solid var(--border)" }}
            >
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
                {selected.label}
              </h3>
            </div>
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: 16,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {threadLoading && thread.length === 0 ? (
                <p style={{ color: "var(--muted-foreground)", fontSize: 13 }}>
                  Loading…
                </p>
              ) : thread.length === 0 ? (
                <p
                  style={{
                    color: "var(--muted-foreground)",
                    fontSize: 13,
                    textAlign: "center",
                  }}
                >
                  No messages yet — say hi.
                </p>
              ) : (
                thread.map((m) => {
                  const isMe = m.sender_id === myId;
                  return (
                    <div
                      key={m.id}
                      style={{
                        alignSelf: isMe ? "flex-end" : "flex-start",
                        maxWidth: "70%",
                        background: isMe ? "#ff6b35" : "var(--muted)",
                        color: isMe ? "#fff" : "var(--foreground)",
                        padding: "8px 12px",
                        borderRadius: 12,
                        borderBottomLeftRadius: isMe ? 12 : 4,
                        borderBottomRightRadius: isMe ? 4 : 12,
                        wordBreak: "break-word",
                      }}
                    >
                      {!isMe && (
                        <div
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            marginBottom: 2,
                            opacity: 0.8,
                          }}
                        >
                          {senderLabel(m)}
                        </div>
                      )}
                      <div style={{ fontSize: 13, lineHeight: 1.4 }}>
                        {m.content}
                      </div>
                      <div style={{ fontSize: 10, opacity: 0.7, marginTop: 4 }}>
                        {relativeTime(m.created_at)}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={threadEndRef} />
            </div>
            {/* Org broadcast is admin-only to compose. */}
            {selected.scope_type === "org" && !amAdmin ? (
              <div
                style={{
                  padding: 12,
                  borderTop: "1px solid var(--border)",
                  fontSize: 12,
                  color: "var(--muted-foreground)",
                  textAlign: "center",
                }}
              >
                Only admins can post to the organization broadcast.
              </div>
            ) : (
              <div
                style={{
                  borderTop: "1px solid var(--border)",
                }}
              >
                {sendError && (
                  <div
                    style={{
                      padding: "8px 12px 0",
                      color: "#dc2626",
                      fontSize: 12,
                    }}
                  >
                    {sendError}
                  </div>
                )}
                <div
                  style={{
                    padding: 12,
                    display: "flex",
                    gap: 8,
                  }}
                >
                  <textarea
                    value={composer}
                    onChange={(e) => {
                      setComposer(e.target.value);
                      if (sendError) setSendError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
                    rows={2}
                    style={{
                      flex: 1,
                      resize: "none",
                      padding: 8,
                      borderRadius: 6,
                      border: "1px solid var(--border)",
                      background: "var(--background)",
                      color: "var(--foreground)",
                      fontSize: 13,
                      fontFamily: "inherit",
                    }}
                  />
                  <button
                    onClick={handleSend}
                    disabled={!composer.trim() || sending}
                    style={{
                      padding: "8px 14px",
                      fontSize: 13,
                      fontWeight: 600,
                      background: "#ff6b35",
                      color: "#fff",
                      border: "none",
                      borderRadius: 6,
                      cursor:
                        composer.trim() && !sending ? "pointer" : "not-allowed",
                      opacity: composer.trim() && !sending ? 1 : 0.6,
                    }}
                  >
                    Send
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {showNewModal && (
        <NewMessageModal
          onClose={() => setShowNewModal(false)}
          onStarted={(scope) => {
            setShowNewModal(false);
            setSelected(scope);
          }}
          isAdmin={amAdmin}
          myId={myId}
          users={usersData?.users ?? []}
        />
      )}
    </div>
  );
}

function NewMessageModal({
  onClose,
  onStarted,
  isAdmin,
  myId,
  users,
}: {
  onClose: () => void;
  onStarted: (scope: {
    scope_type: MessageScopeType;
    scope_key: string;
    label: string;
  }) => void;
  isAdmin: boolean;
  myId: string;
  users: User[];
}) {
  const [tab, setTab] = useState<"user" | "org">("user");
  const [search, setSearch] = useState("");

  const contacts = useMemo(
    () => users.filter((u) => u.id && u.id !== myId),
    [users, myId],
  );

  const filteredContacts = contacts.filter((c) => {
    const q = search.toLowerCase().trim();
    if (!q) return true;
    return (
      (c.name || "").toLowerCase().includes(q) ||
      (c.email || "").toLowerCase().includes(q)
    );
  });

  const tabs: { key: "user" | "org"; label: string; enabled: boolean }[] = [
    { key: "user", label: "Direct Message", enabled: true },
    { key: "org", label: "Organization", enabled: isAdmin },
  ];

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 480,
          maxWidth: "90vw",
          background: "var(--background)",
          borderRadius: 10,
          border: "1px solid var(--border)",
          padding: 20,
          boxShadow: "0 20px 50px rgba(0,0,0,0.3)",
        }}
      >
        <h2 style={{ margin: "0 0 12px 0", fontSize: 18 }}>
          Start a Conversation
        </h2>
        <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => t.enabled && setTab(t.key)}
              disabled={!t.enabled}
              title={!t.enabled ? "Admin only" : undefined}
              style={{
                padding: "6px 12px",
                fontSize: 12,
                borderRadius: 6,
                border: "1px solid var(--border)",
                background: tab === t.key ? "#ff6b35" : "transparent",
                color:
                  tab === t.key
                    ? "#fff"
                    : t.enabled
                      ? "var(--foreground)"
                      : "var(--muted-foreground)",
                cursor: t.enabled ? "pointer" : "not-allowed",
                opacity: t.enabled ? 1 : 0.5,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "user" && (
          <>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search people…"
              style={{
                width: "100%",
                padding: 8,
                fontSize: 13,
                borderRadius: 6,
                border: "1px solid var(--border)",
                background: "var(--background)",
                color: "var(--foreground)",
                marginBottom: 8,
              }}
            />
            <div
              style={{
                maxHeight: 320,
                overflowY: "auto",
                border: "1px solid var(--border)",
                borderRadius: 6,
              }}
            >
              {filteredContacts.length === 0 ? (
                <div
                  style={{
                    padding: 16,
                    color: "var(--muted-foreground)",
                    fontSize: 13,
                    textAlign: "center",
                  }}
                >
                  No matches.
                </div>
              ) : (
                filteredContacts.map((c) => (
                  <button
                    key={c.id}
                    onClick={() =>
                      onStarted({
                        scope_type: "user",
                        scope_key: c.id,
                        label: c.name || c.email,
                      })
                    }
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "8px 12px",
                      border: "none",
                      borderBottom: "1px solid var(--border)",
                      background: "transparent",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      {c.name || c.email}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--muted-foreground)",
                      }}
                    >
                      {c.email}
                    </div>
                  </button>
                ))
              )}
            </div>
          </>
        )}

        {tab === "org" && (
          <div
            style={{
              padding: 16,
              fontSize: 13,
              color: "var(--muted-foreground)",
            }}
          >
            Posts a message to the <strong>entire organization</strong>. Every
            member receives a notification. Use sparingly.
            <div style={{ marginTop: 16, textAlign: "center" }}>
              <button
                onClick={() =>
                  onStarted({
                    scope_type: "org",
                    scope_key: "",
                    label: "Organization",
                  })
                }
                style={{
                  padding: "8px 14px",
                  fontSize: 13,
                  fontWeight: 600,
                  background: "#ff6b35",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                }}
              >
                Open Organization broadcast
              </button>
            </div>
          </div>
        )}

        <div style={{ marginTop: 16, textAlign: "right" }}>
          <button
            onClick={onClose}
            style={{
              padding: "6px 12px",
              fontSize: 13,
              background: "transparent",
              color: "var(--foreground)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MessagesPage() {
  return (
    <Suspense fallback={null}>
      <MessagesPageInner />
    </Suspense>
  );
}
