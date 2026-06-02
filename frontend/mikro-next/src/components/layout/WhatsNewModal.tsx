"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import {
  audienceForRole,
  latestRelease,
  unseenReleases,
  type Release,
  type WhatsNewAudience,
} from "@/lib/releaseNotes";

interface WhatsNewModalProps {
  userId: string;
  role: string;
}

const storageKey = (userId: string) => `mikro.whatsNew.lastSeen.${userId}`;

function formatDate(iso: string): string {
  // iso is "YYYY-MM-DD". Render as "April 29, 2026" in UTC to avoid TZ shift.
  const d = new Date(`${iso}T00:00:00Z`);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function WhatsNewModal({ userId, role }: WhatsNewModalProps) {
  const [releases, setReleases] = useState<Release[] | null>(null);
  const audience: WhatsNewAudience = audienceForRole(role);

  useEffect(() => {
    if (!userId) return;
    let lastSeen: string | null = null;
    try {
      lastSeen = window.localStorage.getItem(storageKey(userId));
    } catch {
      // localStorage unavailable (private mode etc.) — treat as never-seen.
      lastSeen = null;
    }
    const unseen = unseenReleases(lastSeen, audience);
    if (unseen.length > 0) {
      setReleases(unseen);
    }
  }, [userId, audience]);

  const handleDismiss = () => {
    const top = latestRelease();
    if (top && userId) {
      try {
        window.localStorage.setItem(storageKey(userId), top.version);
      } catch {
        // No-op — modal still closes; we just can't persist the dismissal.
      }
    }
    setReleases(null);
  };

  if (!releases || releases.length === 0) return null;

  const entriesKey = audience === "admin" ? "forAdmin" : "forUser";

  return (
    <Modal
      isOpen={true}
      onClose={handleDismiss}
      title="What's New"
      description="Recent updates we thought you'd want to know about."
      size="2xl"
      footer={
        <Button onClick={handleDismiss} variant="primary">
          Got it
        </Button>
      }
    >
      <div className="space-y-6">
        {releases.map((release) => {
          const entries = release[entriesKey] ?? [];
          if (entries.length === 0) return null;
          return (
            <section key={release.version}>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                {formatDate(release.date)}
              </h3>
              <ul className="space-y-3">
                {entries.map((entry, idx) => (
                  <li key={idx} className="border-l-2 border-kaart-orange pl-4">
                    <div className="font-medium text-foreground">
                      {entry.title}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {entry.body}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </Modal>
  );
}
