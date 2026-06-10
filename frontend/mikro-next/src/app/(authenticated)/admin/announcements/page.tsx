"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  useToastActions,
} from "@/components/ui";
import {
  useEmailCampaignsList,
  useCreateEmailCampaign,
  usePreviewEmailCampaign,
  useTargetableAudiences,
  useTargetableUsers,
} from "@/hooks";
import { useRole } from "@/contexts/RoleContext";
import { isAnyAdmin } from "@/types";
import type { EmailCampaign, TargetableTeam, TargetableRegion } from "@/types";
import {
  audienceLabel,
  parseAudience,
  AUDIENCE_ALL_ORG,
  AUDIENCE_CUSTOM,
  formatTeamAudience,
} from "@/lib/emailAudience";
import { formatDateTime } from "@/lib/utils";

/**
 * Admin email campaign composer + history. Sends a templated HTML email to
 * a role-scoped audience. Respects per-user notify_announcement prefs
 * unless "force delivery" is checked.
 *
 * Audience is resolved by Mikro's own backend (/api/comms/*), not by the
 * comms service directly. The backend reports which audience kinds the
 * caller may target (org / regions / individuals) plus the concrete teams
 * and regions to pick from; the page only offers what's allowed.
 */

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 8,
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--background)",
  color: "var(--foreground)",
  fontSize: 14,
};

export default function AnnouncementsPage() {
  const { role } = useRole();
  const allowed = isAnyAdmin(role);

  const toast = useToastActions();
  const { data: listData, refetch: refetchList } = useEmailCampaignsList();
  const { mutate: createCampaign, loading: sending } = useCreateEmailCampaign();
  const { mutate: previewCampaign } = usePreviewEmailCampaign();
  const { data: audienceData } = useTargetableAudiences();
  const { data: usersData } = useTargetableUsers();

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<string>(AUDIENCE_ALL_ORG);
  const [isForced, setIsForced] = useState(false);
  const [previewCount, setPreviewCount] = useState<number | null>(null);

  // Custom ("specific people") picker state.
  const [selectedSubs, setSelectedSubs] = useState<string[]>([]);
  const [userSearch, setUserSearch] = useState("");

  const campaigns: EmailCampaign[] = listData?.campaigns ?? [];

  const canTargetOrg = audienceData?.can_target_org ?? false;
  const canTargetRegions = audienceData?.can_target_regions ?? false;
  const canTargetIndividuals = audienceData?.can_target_individuals ?? false;
  const teams: TargetableTeam[] = useMemo(
    () => audienceData?.teams ?? [],
    [audienceData],
  );
  const regions: TargetableRegion[] = useMemo(
    () => audienceData?.regions ?? [],
    [audienceData],
  );
  const targetableUsers = useMemo(() => usersData?.users ?? [], [usersData]);

  // Pick a sensible default audience once the options load: org if allowed,
  // else the first team, else custom.
  useEffect(() => {
    if (!audienceData) return;
    if (canTargetOrg) {
      setAudience(AUDIENCE_ALL_ORG);
    } else if (teams.length > 0) {
      setAudience(formatTeamAudience(teams[0].id));
    } else if (canTargetIndividuals) {
      setAudience(AUDIENCE_CUSTOM);
    }
  }, [audienceData, canTargetOrg, canTargetIndividuals, teams]);

  const isCustom = parseAudience(audience).kind === "custom";

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return targetableUsers;
    return targetableUsers.filter(
      (u) =>
        u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
    );
  }, [targetableUsers, userSearch]);

  const subsKey = selectedSubs.join(",");

  // Refresh preview count when audience / force flag / selection changes.
  useEffect(() => {
    if (!allowed) return;
    if (isCustom && selectedSubs.length === 0) {
      setPreviewCount(0);
      return;
    }
    previewCampaign({
      audience,
      is_forced: isForced,
      ...(isCustom ? { recipient_user_ids: selectedSubs } : {}),
    })
      .then((res) => setPreviewCount(res?.recipient_count ?? null))
      .catch(() => setPreviewCount(null));
    // subsKey stands in for selectedSubs (stable string identity).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audience, isForced, isCustom, subsKey, previewCampaign, allowed]);

  const toggleSub = (sub: string) => {
    setSelectedSubs((prev) =>
      prev.includes(sub) ? prev.filter((s) => s !== sub) : [...prev, sub],
    );
  };

  const handleSend = async () => {
    if (!subject.trim() || !body.trim()) {
      toast.error("Subject and body are required.");
      return;
    }
    if (isCustom && selectedSubs.length === 0) {
      toast.error("Select at least one recipient.");
      return;
    }
    try {
      const result = await createCampaign({
        subject: subject.trim(),
        body_html: body,
        audience,
        is_forced: isForced,
        ...(isCustom ? { recipient_user_ids: selectedSubs } : {}),
      });
      const sentTo =
        result?.recipient_count ?? result?.campaign?.recipient_count ?? "?";
      toast.success(`Sent to ${sentTo} recipients`);
      setSubject("");
      setBody("");
      setIsForced(false);
      setSelectedSubs([]);
      setUserSearch("");
      refetchList().catch(() => {});
    } catch {
      toast.error("Failed to send campaign.");
    }
  };

  if (!allowed) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Announcements</CardTitle>
        </CardHeader>
        <CardContent>
          <p style={{ fontSize: 14, color: "var(--muted-foreground)" }}>
            You don&apos;t have access to this page.
          </p>
        </CardContent>
      </Card>
    );
  }

  const sendDisabled =
    sending ||
    !subject.trim() ||
    !body.trim() ||
    (isCustom && selectedSubs.length === 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Announcements</h1>
        <p className="text-muted-foreground" style={{ marginTop: 8 }}>
          Compose and send emails to members of your organization.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Compose</CardTitle>
        </CardHeader>
        <CardContent>
          <div style={{ display: "grid", gap: 12 }}>
            <label>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                Subject
              </div>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="What's the subject line?"
                style={inputStyle}
              />
            </label>

            <label>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                Body (HTML supported)
              </div>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="<p>Message content…</p>"
                rows={10}
                style={{
                  ...inputStyle,
                  fontFamily: "monospace",
                  fontSize: 13,
                  resize: "vertical",
                }}
              />
            </label>

            <label>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                Audience
              </div>
              <select
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                style={inputStyle}
              >
                {canTargetOrg && (
                  <option value={AUDIENCE_ALL_ORG}>Whole organization</option>
                )}
                {teams.map((t) => (
                  <option key={`team-${t.id}`} value={formatTeamAudience(t.id)}>
                    {t.name}
                  </option>
                ))}
                {canTargetRegions &&
                  regions.map((r) => (
                    <option key={`region-${r.id}`} value={`region:${r.id}`}>
                      Region: {r.name}
                    </option>
                  ))}
                {canTargetIndividuals && (
                  <option value={AUDIENCE_CUSTOM}>Specific people…</option>
                )}
              </select>
            </label>

            {isCustom && (
              <div
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  padding: 12,
                  display: "grid",
                  gap: 8,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <label style={{ flex: 1 }}>
                    <span className="sr-only">Search people</span>
                    <input
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      placeholder="Search by name or email…"
                      aria-label="Search people"
                      style={inputStyle}
                    />
                  </label>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--muted-foreground)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {selectedSubs.length} selected
                  </div>
                </div>
                <div
                  style={{
                    maxHeight: 220,
                    overflowY: "auto",
                    display: "grid",
                    gap: 2,
                  }}
                >
                  {filteredUsers.length === 0 ? (
                    <p
                      style={{
                        fontSize: 13,
                        color: "var(--muted-foreground)",
                        padding: 4,
                      }}
                    >
                      No matching people.
                    </p>
                  ) : (
                    filteredUsers.map((u) => (
                      <label
                        key={u.sub}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          fontSize: 13,
                          padding: "4px 2px",
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedSubs.includes(u.sub)}
                          onChange={() => toggleSub(u.sub)}
                        />
                        <span>
                          {u.name}{" "}
                          <span style={{ color: "var(--muted-foreground)" }}>
                            ({u.email})
                          </span>
                        </span>
                      </label>
                    ))
                  )}
                </div>
              </div>
            )}

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
              }}
            >
              <input
                type="checkbox"
                checked={isForced}
                onChange={(e) => setIsForced(e.target.checked)}
              />
              <span>
                Force delivery (bypass per-user opt-out).{" "}
                <em style={{ color: "var(--muted-foreground)" }}>
                  Use sparingly — only for payroll-critical or legal comms.
                </em>
              </span>
            </label>

            <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
              Preview recipients: <strong>{previewCount ?? "—"} </strong>
              {isForced
                ? "(forced — bypasses prefs)"
                : "(honors per-user prefs)"}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Button onClick={handleSend} disabled={sendDisabled}>
                {sending ? "Sending…" : "Send Campaign"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Past Campaigns</CardTitle>
        </CardHeader>
        <CardContent>
          {campaigns.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
              No campaigns sent yet.
            </p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  fontSize: 13,
                  borderCollapse: "collapse",
                }}
              >
                <thead>
                  <tr
                    style={{
                      textAlign: "left",
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    <th style={{ padding: 8 }}>Subject</th>
                    <th style={{ padding: 8 }}>Audience</th>
                    <th style={{ padding: 8 }}>Recipients</th>
                    <th style={{ padding: 8 }}>Sent By</th>
                    <th style={{ padding: 8 }}>Sent At</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c) => (
                    <tr
                      key={c.id}
                      style={{ borderBottom: "1px solid var(--border)" }}
                    >
                      <td style={{ padding: 8 }}>
                        {c.subject}
                        {c.is_forced && (
                          <span
                            style={{
                              marginLeft: 6,
                              fontSize: 10,
                              color: "#dc2626",
                              fontWeight: 600,
                            }}
                          >
                            FORCED
                          </span>
                        )}
                      </td>
                      <td style={{ padding: 8 }}>
                        {audienceLabel(c.audience, teams, regions)}
                      </td>
                      <td style={{ padding: 8 }}>{c.recipient_count ?? "—"}</td>
                      <td style={{ padding: 8 }}>{c.sent_by_name ?? "—"}</td>
                      <td style={{ padding: 8 }}>
                        {formatDateTime(c.sent_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
