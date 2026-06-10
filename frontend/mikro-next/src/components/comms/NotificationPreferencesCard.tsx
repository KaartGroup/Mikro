"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  useToastActions,
} from "@/components/ui";
import {
  useNotificationPreferences,
  useUpdateNotificationPreferences,
} from "@/hooks";
import type { NotificationPreferences } from "@/types";

/**
 * Account-page card listing every notify_* preference as a toggle.
 * In-app bell notifications are ALWAYS created — these toggles only
 * control whether an email is also sent for each category.
 */

const ROWS: {
  key: keyof NotificationPreferences;
  label: string;
  help: string;
}[] = [
  {
    key: "notify_entry_adjusted",
    label: "Time entry adjustments",
    help: "When an admin edits or voids one of your time entries.",
  },
  {
    key: "notify_entry_force_closed",
    label: "Force clock-out",
    help: "When an admin ends an active clock-in session you left open.",
  },
  {
    key: "notify_adjustment_requested",
    label: "Adjustment requests (admins)",
    help: "When an editor requests a time-entry review. Admin-only.",
  },
  {
    key: "notify_assigned_to_project",
    label: "Project assignments",
    help: "When you're added to a new project.",
  },
  {
    key: "notify_payment_sent",
    label: "Payment sent",
    help: "When your payment has been processed.",
  },
  {
    key: "notify_bank_info_changed",
    label: "Bank info alerts (admins)",
    help: "When a contractor reports a bank-info change. Admin-only.",
  },
  {
    key: "notify_announcement",
    label: "Org announcements",
    help: "Admin-broadcast emails. Critical comms may override this.",
  },
  {
    key: "notify_message_received",
    label: "Direct messages",
    help: "When someone sends you a message in the messenger.",
  },
];

export function NotificationPreferencesCard() {
  const toast = useToastActions();
  const { data, loading, refetch } = useNotificationPreferences();
  const { mutate: update } = useUpdateNotificationPreferences();
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data?.preferences) setPrefs(data.preferences);
  }, [data]);

  const toggle = async (key: keyof NotificationPreferences) => {
    if (!prefs) return;
    const next: NotificationPreferences = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    setSaving(true);
    try {
      await update({ preferences: { [key]: next[key] } });
      // Refetch to ensure the source of truth is in sync.
      refetch().catch(() => {});
    } catch {
      toast.error("Failed to update preference. Try again.");
      // Revert on failure.
      setPrefs(prefs);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card id="notifications">
      <CardHeader>
        <CardTitle>Notification Preferences</CardTitle>
      </CardHeader>
      <CardContent>
        <p
          style={{
            fontSize: 13,
            color: "var(--muted-foreground)",
            marginBottom: 16,
          }}
        >
          These toggles control whether you get an <strong>email</strong> for
          each type of notification. In-app bell notifications are always shown
          regardless. Admin-forced announcements may bypass these settings in
          rare cases (payroll deadlines, security alerts).
        </p>
        {loading && !prefs ? (
          <p style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
            Loading…
          </p>
        ) : prefs ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {ROWS.map((row) => (
              <label
                key={row.key}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                  padding: 10,
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                  cursor: saving ? "wait" : "pointer",
                  opacity: saving ? 0.7 : 1,
                }}
              >
                <input
                  type="checkbox"
                  checked={prefs[row.key]}
                  onChange={() => toggle(row.key)}
                  disabled={saving}
                  style={{ marginTop: 4 }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>
                    {row.label}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--muted-foreground)",
                      marginTop: 2,
                    }}
                  >
                    {row.help}
                  </div>
                </div>
              </label>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
            Couldn&apos;t load preferences.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
