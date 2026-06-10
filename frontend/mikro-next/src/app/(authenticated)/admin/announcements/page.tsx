"use client";

import { useEffect, useState } from "react";
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
} from "@/hooks";
import type { EmailCampaign } from "@/types";
import { audienceLabel, AUDIENCE_ALL_ORG } from "@/lib/emailAudience";

/**
 * Admin-only email campaign composer + history. Sends a templated HTML
 * email to an audience. Respects per-user notify_announcement prefs
 * unless "force delivery" is checked.
 *
 * V1 SCOPE-DOWN: audience is fixed to All Organization. The comms service
 * resolves "all_org" recipients itself from its Identity projection. Team
 * and region audiences require the calling app (Mikro) to resolve and pass
 * `recipient_emails` to comms — that wiring lands in a later phase, so the
 * UI offers only the org-wide audience for now.
 */

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AnnouncementsPage() {
  const toast = useToastActions();
  const { data: listData, refetch: refetchList } = useEmailCampaignsList();
  const { mutate: createCampaign, loading: sending } = useCreateEmailCampaign();
  const { mutate: previewCampaign } = usePreviewEmailCampaign();

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  // V1: org-wide only (comms resolves all_org itself).
  const audience = AUDIENCE_ALL_ORG;
  const [isForced, setIsForced] = useState(false);
  const [previewCount, setPreviewCount] = useState<number | null>(null);

  const campaigns: EmailCampaign[] = listData?.campaigns ?? [];

  // Refresh preview count when force flag changes.
  useEffect(() => {
    previewCampaign({ audience, is_forced: isForced })
      .then((res) => setPreviewCount(res?.recipient_count ?? null))
      .catch(() => setPreviewCount(null));
  }, [audience, isForced, previewCampaign]);

  const handleSend = async () => {
    if (!subject.trim() || !body.trim()) {
      toast.error("Subject and body are required.");
      return;
    }
    try {
      const result = await createCampaign({
        subject: subject.trim(),
        body_html: body,
        audience,
        is_forced: isForced,
      });
      const sentTo =
        result?.recipient_count ?? result?.campaign?.recipient_count ?? "?";
      toast.success(`Sent to ${sentTo} recipients`);
      setSubject("");
      setBody("");
      setIsForced(false);
      refetchList().catch(() => {});
    } catch {
      toast.error("Failed to send campaign.");
    }
  };

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
                style={{
                  width: "100%",
                  padding: 8,
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                  background: "var(--background)",
                  color: "var(--foreground)",
                  fontSize: 14,
                }}
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
                  width: "100%",
                  padding: 8,
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                  background: "var(--background)",
                  color: "var(--foreground)",
                  fontFamily: "monospace",
                  fontSize: 13,
                  resize: "vertical",
                }}
              />
            </label>

            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                Audience
              </div>
              <div
                style={{
                  padding: 8,
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                  background: "var(--muted)",
                  color: "var(--foreground)",
                  fontSize: 14,
                }}
              >
                All Organization
              </div>
            </div>

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
              <Button
                onClick={handleSend}
                disabled={sending || !subject.trim() || !body.trim()}
              >
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
                        {audienceLabel(c.audience, [], [])}
                      </td>
                      <td style={{ padding: 8 }}>{c.recipient_count ?? "—"}</td>
                      <td style={{ padding: 8 }}>
                        {c.sent_by_name ?? c.sent_by ?? "—"}
                      </td>
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
