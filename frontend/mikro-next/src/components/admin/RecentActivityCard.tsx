"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import type { UserProfileData, Changeset } from "@/types";
import { NotesButton } from "@/components/widgets/NotesButton";
import { formatDurationHM } from "@/lib/timeTracking";

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  const diffMo = Math.floor(diffDay / 30);
  if (diffMo < 12) return `${diffMo}mo ago`;
  return `${Math.floor(diffDay / 365)}y ago`;
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  return formatDurationHM(seconds);
}

interface Props {
  user: UserProfileData;
  recentChangeset?: Changeset | null;
  /** True while the dedicated "most recent changeset" fetch is in flight. */
  recentChangesetLoading?: boolean;
  /** Backend-supplied note when there is no changeset to render — surfaced
   *  verbatim so admins can tell "no OSM username linked" apart from
   *  "couldn't reach OSM" apart from "no recent activity". */
  recentChangesetMessage?: string | null;
}

export function RecentActivityCard({
  user,
  recentChangeset,
  recentChangesetLoading,
  recentChangesetMessage,
}: Props) {
  const entries = user.time_entries ?? [];
  const activeEntry = entries.find((e) => e.status === "active") ?? null;
  const mostRecentEntry = entries[0] ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Activity</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
              Current status
            </p>
            {activeEntry ? (
              <div className="flex items-center gap-2">
                <span className="relative inline-flex h-2.5 w-2.5">
                  <span className="absolute inset-0 rounded-full bg-green-500 opacity-75 animate-ping" />
                  <span className="relative rounded-full bg-green-600 h-2.5 w-2.5" />
                </span>
                <span className="text-sm">
                  Clocked in
                  {activeEntry.projectName && (
                    <>
                      {" "}
                      on{" "}
                      <span className="font-medium">
                        {activeEntry.projectShortName ||
                          activeEntry.projectName}
                      </span>
                    </>
                  )}
                </span>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Not clocked in</p>
            )}
          </div>

          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
              Most recent project
            </p>
            {mostRecentEntry && mostRecentEntry.projectId ? (
              <Link
                href={`/admin/projects/${mostRecentEntry.projectId}`}
                className="text-sm font-medium hover:text-kaart-orange hover:underline"
              >
                {mostRecentEntry.projectShortName ||
                  mostRecentEntry.projectName}
              </Link>
            ) : (
              <p className="text-sm text-muted-foreground">—</p>
            )}
            {mostRecentEntry && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {formatRelative(
                  mostRecentEntry.clockOut || mostRecentEntry.clockIn,
                )}
                {mostRecentEntry.durationSeconds != null && (
                  <> · {formatDuration(mostRecentEntry.durationSeconds)}</>
                )}
              </p>
            )}
          </div>

          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
              Last session
            </p>
            {mostRecentEntry?.clockIn ? (
              <>
                <p className="text-sm">
                  {new Date(mostRecentEntry.clockIn).toLocaleDateString(
                    "en-US",
                    {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    },
                  )}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {new Date(mostRecentEntry.clockIn).toLocaleTimeString(
                    "en-US",
                    {
                      hour: "2-digit",
                      minute: "2-digit",
                    },
                  )}
                  {mostRecentEntry.clockOut && (
                    <>
                      {" → "}
                      {new Date(mostRecentEntry.clockOut).toLocaleTimeString(
                        "en-US",
                        {
                          hour: "2-digit",
                          minute: "2-digit",
                        },
                      )}
                    </>
                  )}
                </p>
                {mostRecentEntry.userNotes && (
                  <div className="mt-1.5">
                    <NotesButton
                      notes={mostRecentEntry.userNotes}
                      editable={false}
                      size="xs"
                      title="Note from this session"
                    />
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No sessions yet</p>
            )}
          </div>

          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
              Most recent changeset
            </p>
            {recentChangesetLoading && !recentChangeset ? (
              <p className="text-sm text-muted-foreground italic">Loading…</p>
            ) : recentChangeset ? (
              <>
                <a
                  href={`https://www.openstreetmap.org/changeset/${recentChangeset.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium hover:text-kaart-orange hover:underline font-mono"
                >
                  #{recentChangeset.id}
                </a>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {formatRelative(recentChangeset.createdAt)}
                  {recentChangeset.changesCount != null && (
                    <> · {recentChangeset.changesCount} edits</>
                  )}
                </p>
              </>
            ) : recentChangesetMessage ? (
              <p className="text-sm text-muted-foreground">
                {recentChangesetMessage}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                No recent OSM activity
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
