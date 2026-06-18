"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  Card,
  CardContent,
  CardHeader,
  Badge,
  Button,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  useToastActions,
  Val,
  StatCard,
} from "@/components/ui";
import {
  useFriendDetail,
  useRefreshFriendActivity,
  useToggleFriendDiscussionFlag,
  useFriendDiscussions,
} from "@/hooks";
import type { FriendDetailResponse, DiscussionItem } from "@/types";
import { formatNumber, formatDate } from "@/lib/utils";
import { dynamicRoutes } from "@/lib/routes";

const MappingHeatmap = dynamic(() => import("@/components/MappingHeatmap"), {
  ssr: false,
});

function timeAgo(dateString: string): string {
  const diff = Date.now() - new Date(dateString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function accountAge(dateString: string): string {
  const diff = Date.now() - new Date(dateString).getTime();
  const days = Math.floor(diff / 86400000);
  if (days < 30) return `${days} days`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} months`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem > 0 ? `${years}y ${rem}mo` : `${years} years`;
}

export default function FriendDetailPage() {
  const params = useParams();
  const id = params.id;
  const toast = useToastActions();

  const {
    mutate: fetchDetail,
    error: detailError,
  } = useFriendDetail();

  const { mutate: refreshActivity, loading: refreshing } =
    useRefreshFriendActivity();

  const { mutate: toggleFlag } = useToggleFriendDiscussionFlag();

  const { mutate: fetchDiscussions } = useFriendDiscussions();

  const [data, setData] = useState<FriendDetailResponse | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [expandedDiscussions, setExpandedDiscussions] = useState<Set<number>>(
    new Set(),
  );

  // Discussions are fetched lazily on first activation of the Discussions tab
  const [activeTab, setActiveTab] = useState("heatmap");
  const [discussions, setDiscussions] = useState<DiscussionItem[]>([]);
  const [discussionsLoading, setDiscussionsLoading] = useState(false);
  const [discussionsLoaded, setDiscussionsLoaded] = useState(false);

  // Pagination for changesets
  const ROWS_PER_PAGE = 20;
  const [changesetPage, setChangesetPage] = useState(1);

  useEffect(() => {
    if (id) {
      fetchDetail({ friend_id: Number(id) })
        .then((res) => {
          if (res?.friend) setData(res);
        })
        .catch(() => {})
        .finally(() => setPageLoading(false));
    }
  }, [id, fetchDetail]);

  const handleRefresh = async () => {
    try {
      await refreshActivity({ friend_id: Number(id) });
      toast.success("Activity refreshed");
      const result = await fetchDetail({ friend_id: Number(id) });
      if (result?.friend) setData(result);
      // Let discussions reflect the refreshed activity on next view.
      setDiscussionsLoaded(false);
      if (activeTab === "discussions") loadDiscussions(true);
    } catch {
      toast.error("Failed to refresh activity");
    }
  };

  const loadDiscussions = async (force = false) => {
    if (!force && (discussionsLoaded || discussionsLoading)) return;
    setDiscussionsLoading(true);
    try {
      const res = await fetchDiscussions({ friend_id: Number(id) });
      setDiscussions(res?.discussions ?? []);
      setDiscussionsLoaded(true);
    } catch {
      toast.error("Failed to load discussions");
    } finally {
      setDiscussionsLoading(false);
    }
  };

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    if (value === "discussions") loadDiscussions();
  };

  const handleToggleFlag = async (link: string) => {
    // Optimistic update on local discussions state
    setDiscussions((prev) =>
      prev.map((d) => (d.link === link ? { ...d, flagged: !d.flagged } : d)),
    );
    try {
      await toggleFlag({ friend_id: Number(id), link });
    } catch {
      toast.error("Failed to toggle flag");
      // Revert on failure
      setDiscussions((prev) =>
        prev.map((d) => (d.link === link ? { ...d, flagged: !d.flagged } : d)),
      );
    }
  };

  if (pageLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-kaart-orange" />
      </div>
    );
  }

  if (detailError && !data) {
    return (
      <div className="space-y-4">
        <Link
          href={dynamicRoutes.adminWatchlistTab("friends")}
          className="text-kaart-orange hover:underline text-sm"
        >
          {"\u2190"} Back to Friends List
        </Link>
        <Card>
          <CardContent className="p-8 text-center text-red-500">
            Failed to load friend detail: {detailError}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  const { friend, changesets, heatmapPoints, hashtagSummary } = data;

  const sortedChangesets = [...changesets].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  const sortedHashtags = Object.entries(hashtagSummary).sort(
    (a, b) => b[1] - a[1],
  );

  const cachedChangesTotal = changesets.reduce(
    (sum, cs) => sum + (cs.changes_count || 0),
    0,
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link
          href={dynamicRoutes.adminWatchlistTab("friends")}
          className="text-kaart-orange hover:underline text-sm"
        >
          {"\u2190"} Back to Friends List
        </Link>

        <div className="flex items-start justify-between mt-2">
          <h1 className="text-2xl font-bold">{friend.osm_username}</h1>
          <div className="flex items-center gap-2">
            <a
              href={`https://www.openstreetmap.org/user/${encodeURIComponent(friend.osm_username)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="outline" size="sm">
                OSM Profile {"\u2197"}
              </Button>
            </a>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              {refreshing ? (
                <>
                  <span className="animate-spin inline-block h-4 w-4 border-b-2 border-current rounded-full mr-2" />
                  Refreshing...
                </>
              ) : (
                "Refresh Activity"
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Info Card */}
      <Card>
        <CardContent className="p-6 space-y-3">
          {friend.notes ? (
            <p className="text-sm">{friend.notes}</p>
          ) : (
            <p className="text-sm text-muted-foreground">No notes</p>
          )}

          {friend.tags && friend.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {friend.tags.map((tag) => (
                <Badge key={tag} variant="secondary">
                  {tag}
                </Badge>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span>
              Added by <Val>{friend.added_by_name || friend.added_by}</Val> on{" "}
              {formatDate(friend.created_at)}
            </span>
            <span>
              Last refreshed{" "}
              {friend.cache_updated_at
                ? timeAgo(friend.cache_updated_at)
                : "Never"}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Account Age"
          value={
            friend.cached_account_created
              ? accountAge(friend.cached_account_created)
              : "Unknown"
          }
        />
        <StatCard
          label="Total Changesets"
          value={
            friend.cached_total_changesets != null
              ? formatNumber(friend.cached_total_changesets)
              : "Unknown"
          }
        />
        <StatCard
          label="Last Active"
          value={
            friend.cached_last_active
              ? formatDate(friend.cached_last_active)
              : "Unknown"
          }
        />
        <StatCard
          label="Cached Changes"
          value={formatNumber(cachedChangesTotal)}
          sub={`from ${formatNumber(changesets.length).text} changesets`}
        />
      </div>

      {/* Tabbed Content — Heatmap, Changesets, Discussions */}
      <Tabs
        defaultValue="heatmap"
        value={activeTab}
        onValueChange={handleTabChange}
      >
        <TabsList>
          <TabsTrigger value="heatmap">Heatmap</TabsTrigger>
          <TabsTrigger value="changesets">
            Changesets ({formatNumber(changesets.length).text})
          </TabsTrigger>
          <TabsTrigger value="discussions">
            {discussionsLoaded
              ? `Discussions (${discussions.length})`
              : "Discussions"}
          </TabsTrigger>
          {sortedHashtags.length > 0 && (
            <TabsTrigger value="hashtags">
              Hashtags ({formatNumber(sortedHashtags.length).text})
            </TabsTrigger>
          )}
        </TabsList>

        {/* Heatmap Tab */}
        <TabsContent value="heatmap">
          <Card>
            <CardContent className="p-4">
              {heatmapPoints.length > 0 ? (
                <MappingHeatmap points={heatmapPoints} height="500px" />
              ) : (
                <p className="text-muted-foreground text-center py-8">
                  No location data available. Click Refresh Activity to fetch.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Changesets Tab */}
        <TabsContent value="changesets">
          <Card>
            <CardContent className="p-0">
              {sortedChangesets.length > 0 ? (
                <>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Changeset ID</TableHead>
                          <TableHead>Comment</TableHead>
                          <TableHead>Editor</TableHead>
                          <TableHead className="text-right">Changes</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sortedChangesets
                          .slice(
                            (changesetPage - 1) * ROWS_PER_PAGE,
                            changesetPage * ROWS_PER_PAGE,
                          )
                          .map((cs) => (
                            <TableRow key={cs.changeset_id}>
                              <TableCell className="whitespace-nowrap">
                                {formatDate(cs.created_at)}
                              </TableCell>
                              <TableCell>
                                <a
                                  href={`https://www.openstreetmap.org/changeset/${cs.changeset_id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-kaart-orange hover:underline"
                                >
                                  {cs.changeset_id}
                                </a>
                              </TableCell>
                              <TableCell className="max-w-xs truncate text-muted-foreground">
                                <Val>{cs.comment}</Val>
                              </TableCell>
                              <TableCell className="whitespace-nowrap">
                                <Val>{cs.editor}</Val>
                              </TableCell>
                              <TableCell className="text-right">
                                <Val>{formatNumber(cs.changes_count)}</Val>
                              </TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  </div>
                  {sortedChangesets.length > ROWS_PER_PAGE && (
                    <div className="flex items-center justify-between px-4 py-3 text-sm text-muted-foreground">
                      <span>
                        Showing {(changesetPage - 1) * ROWS_PER_PAGE + 1}-
                        {Math.min(
                          changesetPage * ROWS_PER_PAGE,
                          sortedChangesets.length,
                        )}{" "}
                        of {sortedChangesets.length}
                      </span>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={changesetPage === 1}
                          onClick={() => setChangesetPage((p) => p - 1)}
                        >
                          Previous
                        </Button>
                        <span className="flex items-center px-2">
                          Page {changesetPage} of{" "}
                          {Math.ceil(sortedChangesets.length / ROWS_PER_PAGE)}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={
                            changesetPage ===
                            Math.ceil(sortedChangesets.length / ROWS_PER_PAGE)
                          }
                          onClick={() => setChangesetPage((p) => p + 1)}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-muted-foreground text-center py-8">
                  No changesets cached. Click Refresh Activity to fetch data.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Discussions Tab */}
        <TabsContent value="discussions">
          <Card>
            <CardHeader className="pb-2">
              <p className="text-sm text-muted-foreground">
                Comments on this user&apos;s changesets from other OSM editors
                {discussionsLoaded && discussions.length > 0 && (
                  <span className="ml-2 text-xs">
                    (sorted: flagged first, then newest)
                  </span>
                )}
              </p>
            </CardHeader>
            <CardContent>
              {discussionsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-kaart-orange" />
                </div>
              ) : discussions.length > 0 ? (
                <div
                  className="space-y-3"
                  style={{ maxHeight: 600, overflowY: "auto" }}
                >
                  {discussions.map((disc, i) => {
                    const isExpanded = expandedDiscussions.has(i);
                    return (
                      <div
                        key={`${disc.link}-${disc.commentId || i}`}
                        className={`border rounded-lg p-3 ${
                          disc.flagged
                            ? "border-l-4 border-l-kaart-orange border-t border-r border-b border-border bg-orange-50/30 dark:bg-orange-950/10"
                            : "border-border"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">{disc.title}</p>
                            {disc.pubDate ? (
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {formatDate(disc.pubDate)} (
                                {timeAgo(disc.pubDate)})
                              </p>
                            ) : (
                              <p className="text-xs text-muted-foreground mt-0.5">
                                No date
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              onClick={() => handleToggleFlag(disc.link)}
                              className={`text-base leading-none ${
                                disc.flagged
                                  ? "text-kaart-orange"
                                  : "text-muted-foreground hover:text-kaart-orange"
                              } transition-colors`}
                              title={
                                disc.flagged ? "Unflag" : "Flag as important"
                              }
                            >
                              {disc.flagged ? "\u2605" : "\u2606"}
                            </button>
                            <a
                              href={disc.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-kaart-orange hover:underline whitespace-nowrap"
                            >
                              View on OSM
                            </a>
                          </div>
                        </div>
                        <p
                          className={`text-sm text-muted-foreground whitespace-pre-line ${
                            !isExpanded ? "line-clamp-3" : ""
                          }`}
                        >
                          {disc.description || "\u2014"}
                        </p>
                        {disc.description && disc.description.length > 100 && (
                          <button
                            onClick={() =>
                              setExpandedDiscussions((prev) => {
                                const next = new Set(prev);
                                if (next.has(i)) next.delete(i);
                                else next.add(i);
                                return next;
                              })
                            }
                            className="text-xs text-kaart-orange hover:underline mt-1"
                          >
                            {isExpanded ? "Show less" : "Show more"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-muted-foreground text-center py-8">
                  No changeset discussions found.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Hashtags Tab */}
        {sortedHashtags.length > 0 && (
          <TabsContent value="hashtags">
            <Card>
              <CardContent className="p-6">
                <div className="flex flex-wrap gap-2">
                  {sortedHashtags.map(([tag, count]) => (
                    <Badge key={tag} variant="secondary">
                      #{tag} ({formatNumber(count).text})
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
