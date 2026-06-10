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
  useDeleteMessage,
  useDeleteConversation,
  useFetchUserTeams,
  useFetchTeamMembers,
  useManagedTeams,
} from "@/hooks";
import { useRole } from "@/contexts/RoleContext";
import type {
  Conversation,
  Message,
  MessageScopeType,
  TeamMemberItem,
  User,
} from "@/types";
import { isAnyAdmin } from "@/types";
import { relativeTime } from "@/lib/relativeTime";
import { CountBadge } from "@/components/comms/CountBadge";

/*
 * Messenger page — two-pane layout. Left: conversation list grouped by
 * scope. Right: thread view + composer. Polls the active thread every 5s
 * while open; conversation list refreshes every 30s.
 *
 * The comms service is app-agnostic — it targets DMs (scope_type "user"),
 * opaque "group" keys, and "org" broadcasts. Mikro resolves team membership
 * → recipient subs for the "group" path: a team thread is keyed "team:<id>".
 * Admins start team threads from the compose modal's Team tab (org admins →
 * any team, team leads → only led teams); members see the thread because the
 * page asserts their membership via group_keys on the conversations call.
 * Team threads render the team NAME, never the raw "team:<id>" key.
 */

const TARGET_LABELS: Record<MessageScopeType, string> = {
  user: "Direct Messages",
  group: "Teams",
  org: "Organization",
};

// A raw Auth0 sub ("auth0|abc", "google-oauth2|123", "samlp|...", "waad|...")
// must NEVER be shown to a user. If a name can't be resolved, fall back to
// this generic label instead of leaking the ID.
const FALLBACK_NAME = "Unknown user";
const looksLikeSub = (s: string): boolean => /^[a-z0-9_-]+\|/i.test(s);
const safeLabel = (s: string | null | undefined): string =>
  s && !looksLikeSub(s) ? s : FALLBACK_NAME;

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

  // Teams the current user BELONGS to. comms only returns group/team threads
  // when the app asserts membership via group_keys.
  const { data: userTeamsData } = useFetchUserTeams();

  // Teams the current user can MANAGE (led teams for team_admin, all org teams
  // for org_admin) — drives the compose "Team" tab AND supplies names for any
  // managed-team thread the admin starts. Role-scoped server-side.
  const { teams: managedTeams } = useManagedTeams();

  // group_keys ("team:<id>") the page asserts on the conversations call: teams
  // the user belongs to UNION teams they manage — so an admin who messages a
  // team they don't belong to still sees that thread afterward.
  const myGroupKeys = useMemo(() => {
    const keys = new Set<string>();
    (userTeamsData?.teams ?? []).forEach((t) => keys.add(`team:${t.id}`));
    managedTeams.forEach((t) => keys.add(`team:${t.id}`));
    return Array.from(keys);
  }, [userTeamsData, managedTeams]);

  // team:<id> → team NAME. Built from BOTH membership and managed teams so a
  // team thread always renders its name, never the raw "team:<id>" key.
  const teamNameByKey = useMemo(() => {
    const map: Record<string, string> = {};
    (userTeamsData?.teams ?? []).forEach((t) => {
      map[`team:${t.id}`] = t.name;
    });
    managedTeams.forEach((t) => {
      map[`team:${t.id}`] = t.name;
    });
    return map;
  }, [userTeamsData, managedTeams]);

  const { data: convData, refetch: refetchConversations } =
    useConversations(myGroupKeys);
  const { mutate: fetchThread } = useMessageThread();
  const { mutate: sendMessage, loading: sending } = useSendMessage();
  const { mutate: markRead } = useMarkMessagesRead();
  const { mutate: deleteMessage } = useDeleteMessage();
  const { mutate: deleteConversation } = useDeleteConversation();
  const { mutate: fetchTeamMembers } = useFetchTeamMembers();
  const { data: usersData, loading: usersLoading } = useUsersList();

  // sub → display name map, used to label DM/org message senders and DM
  // conversation rows. comms is app-agnostic — it returns only the raw
  // Auth0 sub (sender_id / peer scope_key), never a display name — so the
  // frontend resolves names from Mikro's own user list. Only store real
  // names/emails here: a raw sub must never become a value (it would leak the
  // ID). Include the current authenticated user so my own messages show me.
  const nameBySub = useMemo(() => {
    const map: Record<string, string> = {};
    (usersData?.users ?? []).forEach((u: User) => {
      const label = u.name || u.email;
      if (u.id && label) map[u.id] = label;
    });
    if (authUser?.sub) {
      const mine = authUser.name || authUser.email || map[authUser.sub];
      if (mine) map[authUser.sub] = mine;
    }
    return map;
  }, [usersData, authUser]);

  // Resolve a sub to a display name. NEVER returns the raw sub. While the
  // user list is still loading we return a neutral placeholder ("…") rather
  // than "Unknown user" — so a real person's name doesn't briefly flash as
  // unknown (and a sub never flashes at all).
  const nameForSub = useCallback(
    (sub: string): string => {
      const resolved = nameBySub[sub];
      if (resolved && !looksLikeSub(resolved)) return resolved;
      return usersLoading ? "…" : FALLBACK_NAME;
    },
    [nameBySub, usersLoading],
  );

  // Label a conversation row. For DMs, resolve the peer (scope_key) to a name;
  // org/group use the server label. safeLabel guarantees a sub never leaks
  // even if the server label itself is a raw sub.
  const convLabel = useCallback(
    (c: Conversation): string => {
      if (c.scope_type === "user") return nameForSub(c.scope_key);
      // Team threads: comms only knows the raw "team:<id>" key — resolve the
      // real team name locally, never leak the key.
      if (c.scope_type === "group") return teamNameByKey[c.scope_key] || "Team";
      return safeLabel(c.label);
    },
    [nameForSub, teamNameByKey],
  );

  // Only the scope is stored — the visible label is DERIVED below so it can
  // never freeze on a stale value (and so a sub can never get captured into
  // state and rendered before names resolve).
  const [selected, setSelected] = useState<{
    scope_type: MessageScopeType;
    scope_key: string;
  } | null>(null);

  // Reactive label for the open thread header — recomputes as names load.
  const selectedLabel = useMemo(() => {
    if (!selected) return "";
    if (selected.scope_type === "user") return nameForSub(selected.scope_key);
    if (selected.scope_type === "group")
      return teamNameByKey[selected.scope_key] || "Team";
    return TARGET_LABELS[selected.scope_type] || "Conversation";
  }, [selected, nameForSub, teamNameByKey]);
  // Resolved recipient subs for the selected team thread — a "group" send
  // must carry recipient_user_ids so comms can fan the message out. Seeded
  // from the compose modal (which already resolved members) and re-derived
  // whenever a team thread is opened from the list.
  const [groupRecipients, setGroupRecipients] = useState<string[]>([]);
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
        });
        return;
      }
      // Not in the list yet (first message never sent) — still select it.
      setSelected({
        scope_type: initialScopeType,
        scope_key: initialScopeKey,
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

  // Resolve recipients whenever a TEAM thread is selected (e.g. opened from
  // the list, or restored from a URL) so the first send isn't empty. When a
  // team is started from the compose modal, the modal seeds groupRecipients
  // directly (see onStarted) — this effect then keeps it correct. For non-team
  // scopes, clear it. Membership = assigned === "Assigned"; exclude myself.
  useEffect(() => {
    if (selected?.scope_type !== "group") {
      setGroupRecipients([]);
      return;
    }
    const teamId = Number(selected.scope_key.split(":")[1]);
    if (!Number.isFinite(teamId)) {
      setGroupRecipients([]);
      return;
    }
    let cancelled = false;
    fetchTeamMembers({ teamId })
      .then((res) => {
        if (cancelled) return;
        const subs = (res?.users ?? [])
          .filter((m: TeamMemberItem) => m.assigned === "Assigned")
          .map((m: TeamMemberItem) => m.id)
          .filter((id: string) => id && id !== myId);
        setGroupRecipients(subs);
      })
      .catch(() => {
        if (!cancelled) setGroupRecipients([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, fetchTeamMembers, myId]);

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
    // DM → target_user_id; org broadcast needs no extra targeting; team
    // message → target_group_key + the resolved member subs as recipients.
    if (selected.scope_type === "user") {
      body.target_user_id = selected.scope_key;
    } else if (selected.scope_type === "group") {
      body.target_group_key = selected.scope_key;
      body.recipient_user_ids = groupRecipients;
    }
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

  // Delete a single message (admin: any; otherwise: own only). Optimistically
  // drop it from the open thread, then refresh.
  const handleDeleteMessage = async (m: Message) => {
    if (!amAdmin && m.sender_id !== myId) return;
    if (!window.confirm("Delete this message? This cannot be undone.")) return;
    try {
      await deleteMessage({ message_id: m.id });
      setThread((prev) => prev.filter((x) => x.id !== m.id));
      refetchConversations().catch(() => {});
    } catch (err) {
      setSendError(
        err instanceof Error && err.message
          ? err.message
          : "Couldn't delete the message.",
      );
    }
  };

  // Delete the whole open conversation (admin only). Clears the pane.
  const handleDeleteConversation = async () => {
    if (!selected || !amAdmin) return;
    if (
      !window.confirm(
        "Delete this entire conversation for everyone? This permanently " +
          "removes all of its messages and cannot be undone.",
      )
    )
      return;
    try {
      await deleteConversation({
        scope_type: selected.scope_type,
        scope_key: selected.scope_key,
      });
      setSelected(null);
      setThread([]);
      refetchConversations().catch(() => {});
    } catch (err) {
      setSendError(
        err instanceof Error && err.message
          ? err.message
          : "Couldn't delete the conversation.",
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

  const senderLabel = (m: Message): string => nameForSub(m.sender_id);

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
                          {convLabel(c)}
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
              style={{
                padding: 12,
                borderBottom: "1px solid var(--border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
                {selectedLabel}
              </h3>
              {amAdmin && (
                <button
                  onClick={handleDeleteConversation}
                  title="Delete this entire conversation for everyone"
                  style={{
                    padding: "5px 10px",
                    fontSize: 12,
                    fontWeight: 600,
                    background: "transparent",
                    color: "#dc2626",
                    border: "1px solid #dc2626",
                    borderRadius: 6,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  Delete conversation
                </button>
              )}
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
                  const canDelete = amAdmin || isMe;
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
                      <div
                        style={{
                          fontSize: 10,
                          opacity: 0.7,
                          marginTop: 4,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 8,
                        }}
                      >
                        <span>{relativeTime(m.created_at)}</span>
                        {canDelete && (
                          <button
                            onClick={() => handleDeleteMessage(m)}
                            title="Delete this message"
                            style={{
                              background: "transparent",
                              border: "none",
                              padding: 0,
                              cursor: "pointer",
                              fontSize: 10,
                              fontWeight: 600,
                              color: "inherit",
                              opacity: 0.85,
                              textDecoration: "underline",
                            }}
                          >
                            Delete
                          </button>
                        )}
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
          onStarted={(scope, recipients) => {
            setShowNewModal(false);
            // Seed recipients first so a team's first send isn't empty (the
            // selected-effect would otherwise race the immediate compose).
            setGroupRecipients(recipients ?? []);
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

type ComposeTab = "user" | "group" | "org";

function NewMessageModal({
  onClose,
  onStarted,
  isAdmin,
  myId,
  users,
}: {
  onClose: () => void;
  onStarted: (
    scope: {
      scope_type: MessageScopeType;
      scope_key: string;
    },
    recipients?: string[],
  ) => void;
  isAdmin: boolean;
  myId: string;
  users: User[];
}) {
  const [tab, setTab] = useState<ComposeTab>("user");
  const [search, setSearch] = useState("");
  const [teamSearch, setTeamSearch] = useState("");
  const [teamError, setTeamError] = useState<string | null>(null);
  const [resolvingTeamId, setResolvingTeamId] = useState<number | null>(null);

  // Teams the caller may message: led teams for team_admin, all org teams for
  // org_admin (role-scoped server-side). Only shown on the admin-only Team tab.
  const { teams: managedTeams, loading: teamsLoading } = useManagedTeams();
  const { mutate: fetchTeamMembers } = useFetchTeamMembers();

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

  const filteredTeams = useMemo(() => {
    const q = teamSearch.toLowerCase().trim();
    if (!q) return managedTeams;
    return managedTeams.filter((t) => t.name.toLowerCase().includes(q));
  }, [managedTeams, teamSearch]);

  // Resolve a team's assigned members → recipient subs, then open the thread.
  // No-op (with a note) if the team has no assignable members.
  const startTeam = useCallback(
    async (teamId: number) => {
      setTeamError(null);
      setResolvingTeamId(teamId);
      try {
        const res = await fetchTeamMembers({ teamId });
        const subs = (res?.users ?? [])
          .filter((m: TeamMemberItem) => m.assigned === "Assigned")
          .map((m: TeamMemberItem) => m.id)
          .filter((id: string) => id && id !== myId);
        if (subs.length === 0) {
          setTeamError("This team has no other assignable members to message.");
          return;
        }
        onStarted({ scope_type: "group", scope_key: `team:${teamId}` }, subs);
      } catch {
        setTeamError("Couldn't load this team's members. Please try again.");
      } finally {
        setResolvingTeamId(null);
      }
    },
    [fetchTeamMembers, myId, onStarted],
  );

  const tabs: { key: ComposeTab; label: string; enabled: boolean }[] = [
    { key: "user", label: "Direct Message", enabled: true },
    { key: "group", label: "Team", enabled: isAdmin },
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

        {tab === "group" && (
          <>
            <div
              style={{
                fontSize: 12,
                color: "var(--muted-foreground)",
                marginBottom: 8,
              }}
            >
              Message an entire <strong>team</strong>. Every assigned member
              sees the thread in their messages.
            </div>
            <input
              value={teamSearch}
              onChange={(e) => setTeamSearch(e.target.value)}
              placeholder="Search teams…"
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
            {teamError && (
              <div
                style={{
                  color: "#dc2626",
                  fontSize: 12,
                  marginBottom: 8,
                }}
              >
                {teamError}
              </div>
            )}
            <div
              style={{
                maxHeight: 320,
                overflowY: "auto",
                border: "1px solid var(--border)",
                borderRadius: 6,
              }}
            >
              {teamsLoading ? (
                <div
                  style={{
                    padding: 16,
                    color: "var(--muted-foreground)",
                    fontSize: 13,
                    textAlign: "center",
                  }}
                >
                  Loading teams…
                </div>
              ) : filteredTeams.length === 0 ? (
                <div
                  style={{
                    padding: 16,
                    color: "var(--muted-foreground)",
                    fontSize: 13,
                    textAlign: "center",
                  }}
                >
                  {managedTeams.length === 0
                    ? "No teams available to message."
                    : "No matches."}
                </div>
              ) : (
                filteredTeams.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => startTeam(t.id)}
                    disabled={resolvingTeamId !== null}
                    title={`Message the ${t.name} team`}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "8px 12px",
                      border: "none",
                      borderBottom: "1px solid var(--border)",
                      background: "transparent",
                      cursor: resolvingTeamId !== null ? "wait" : "pointer",
                      opacity:
                        resolvingTeamId !== null && resolvingTeamId !== t.id
                          ? 0.6
                          : 1,
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      {t.name}
                    </div>
                    {resolvingTeamId === t.id && (
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--muted-foreground)",
                        }}
                      >
                        Opening…
                      </div>
                    )}
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
