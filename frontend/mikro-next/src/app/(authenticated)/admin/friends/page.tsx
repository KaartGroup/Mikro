"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  ConfirmDialog,
  Input,
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  Skeleton,
  Val,
} from "@/components/ui";
import { AddFriendModal } from "@/components/modals/friend/AddFriendModal";
import { EditFriendModal } from "@/components/modals/friend/EditFriendModal";
import { useToastActions } from "@/components/ui";
import {
  useFriendsList,
  useDeleteFriend,
  useRefreshFriendActivity,
} from "@/hooks";
import type { Friend } from "@/types";
import { formatNumber, formatDate } from "@/lib/utils";

export default function FriendsListPage() {
  const { data, loading, refetch } = useFriendsList();
  const { mutate: deleteFriend, loading: deleting } = useDeleteFriend();
  const { mutate: refreshFriendActivity } = useRefreshFriendActivity();
  const toast = useToastActions();

  const friends = data?.friends ?? [];

  // Modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedFriend, setSelectedFriend] = useState<Friend | null>(null);

  // Search & sort
  const [searchTerm, setSearchTerm] = useState("");
  const [sortKey, setSortKey] = useState<string>("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Pagination
  const ROWS_PER_PAGE = 20;
  const [currentPage, setCurrentPage] = useState(1);

  // Per-row refresh loading
  const [refreshingIds, setRefreshingIds] = useState<Set<number>>(new Set());

  // Stats
  const activeLast7Days = useMemo(() => {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    return friends.filter(
      (p) =>
        p.cached_last_active && new Date(p.cached_last_active) >= sevenDaysAgo,
    ).length;
  }, [friends]);

  const mostActive = useMemo(() => {
    if (friends.length === 0) return null;
    return friends.reduce<Friend | null>((best, p) => {
      if (!best) return p;
      return (p.cached_total_changesets ?? 0) >
        (best.cached_total_changesets ?? 0)
        ? p
        : best;
    }, null);
  }, [friends]);

  // Sort handler
  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  // Filter and sort
  const filteredAndSorted = useMemo(() => {
    let filtered = friends;
    if (searchTerm.trim()) {
      const s = searchTerm.trim().toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.osm_username.toLowerCase().includes(s) ||
          (p.notes || "").toLowerCase().includes(s) ||
          (p.tags || []).join(" ").toLowerCase().includes(s),
      );
    }

    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      let aVal: string | number = "";
      let bVal: string | number = "";
      switch (sortKey) {
        case "username":
          aVal = a.osm_username.toLowerCase();
          bVal = b.osm_username.toLowerCase();
          break;
        case "added_by":
          aVal = (a.added_by_name || "").toLowerCase();
          bVal = (b.added_by_name || "").toLowerCase();
          break;
        case "created_at":
          aVal = a.created_at || "";
          bVal = b.created_at || "";
          break;
        case "last_active":
          aVal = a.cached_last_active || "";
          bVal = b.cached_last_active || "";
          if (!aVal && !bVal) return 0;
          if (!aVal) return 1;
          if (!bVal) return -1;
          break;
        case "changesets":
          aVal = a.cached_total_changesets ?? 0;
          bVal = b.cached_total_changesets ?? 0;
          break;
        default:
          return 0;
      }
      if (aVal < bVal) return -1 * dir;
      if (aVal > bVal) return 1 * dir;
      return 0;
    });
  }, [friends, searchTerm, sortKey, sortDir]);

  // Reset page when search/sort changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, sortKey, sortDir]);

  // Pagination calculations
  const totalPages = Math.ceil(filteredAndSorted.length / ROWS_PER_PAGE);
  const paginatedFriends = filteredAndSorted.slice(
    (currentPage - 1) * ROWS_PER_PAGE,
    currentPage * ROWS_PER_PAGE,
  );
  const showingStart =
    filteredAndSorted.length > 0 ? (currentPage - 1) * ROWS_PER_PAGE + 1 : 0;
  const showingEnd = Math.min(
    currentPage * ROWS_PER_PAGE,
    filteredAndSorted.length,
  );

  const openEditModal = (friend: Friend) => {
    setSelectedFriend(friend);
    setShowEditModal(true);
  };

  // CRUD handlers
  const handleDeleteFriend = async () => {
    if (!selectedFriend) return;
    try {
      await deleteFriend({ friend_id: selectedFriend.id });
      toast.success("Friend removed successfully");
      setShowDeleteModal(false);
      setSelectedFriend(null);
      refetch();
    } catch {
      toast.error("Failed to remove friend");
    }
  };

  const handleRefresh = async (friend: Friend) => {
    setRefreshingIds((prev) => new Set(prev).add(friend.id));
    try {
      await refreshFriendActivity({ friend_id: friend.id });
      toast.success(`Refreshed activity for ${friend.osm_username}`);
      refetch();
    } catch {
      toast.error("Failed to refresh activity");
    } finally {
      setRefreshingIds((prev) => {
        const next = new Set(prev);
        next.delete(friend.id);
        return next;
      });
    }
  };

  // SortHeader sub-component
  const SortHeader = ({
    label,
    sortField,
  }: {
    label: string;
    sortField: string;
  }) => (
    <TableHead
      className="cursor-pointer select-none hover:text-kaart-orange transition-colors"
      onClick={() => handleSort(sortField)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortKey === sortField && (
          <svg
            className="w-3 h-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d={sortDir === "asc" ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"}
            />
          </svg>
        )}
      </span>
    </TableHead>
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-10 w-24" />
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Friends List</h1>
          <p className="text-muted-foreground">
            Track and manage friendly OSM users
          </p>
        </div>
        <Button onClick={() => setShowAddModal(true)}>Add Friend</Button>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Listed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              <Val>{formatNumber(friends.length)}</Val>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Active Last 7 Days
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-kaart-orange">
              <Val>{formatNumber(activeLast7Days)}</Val>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Most Active</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              <Val>{mostActive?.osm_username}</Val>
            </div>
            {mostActive?.cached_total_changesets != null && (
              <p className="text-xs text-muted-foreground">
                <Val>{formatNumber(mostActive.cached_total_changesets)}</Val>{" "}
                changesets
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="flex-1">
        <Input
          placeholder="Search by username, notes, or tags..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <SortHeader label="OSM Username" sortField="username" />
                <TableHead>Notes</TableHead>
                <TableHead>Tags</TableHead>
                <SortHeader label="Added By" sortField="added_by" />
                <SortHeader label="Date Added" sortField="created_at" />
                <SortHeader label="Last Active" sortField="last_active" />
                <SortHeader label="Changesets" sortField="changesets" />
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedFriends.map((friend) => (
                <TableRow key={friend.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/admin/friends/${friend.id}`}
                      className="text-kaart-orange hover:underline"
                    >
                      {friend.osm_username}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-[200px] truncate">
                    <Val>
                      {friend.notes
                        ? friend.notes.length > 60
                          ? `${friend.notes.slice(0, 60)}...`
                          : friend.notes
                        : null}
                    </Val>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {(friend.tags || []).map((tag) => (
                        <Badge key={tag} variant="secondary">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <Val>{friend.added_by_name}</Val>
                  </TableCell>
                  <TableCell>{formatDate(friend.created_at)}</TableCell>
                  <TableCell>
                    {friend.cached_last_active
                      ? formatDate(friend.cached_last_active)
                      : "Never"}
                  </TableCell>
                  <TableCell>
                    <Val>{formatNumber(friend.cached_total_changesets)}</Val>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openEditModal(friend)}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRefresh(friend)}
                        isLoading={refreshingIds.has(friend.id)}
                      >
                        Refresh
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                          setSelectedFriend(friend);
                          setShowDeleteModal(true);
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {filteredAndSorted.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="text-center py-8 text-muted-foreground"
                  >
                    {friends.length === 0
                      ? "No friends listed yet. Add an OSM username to start tracking."
                      : "No results match your search."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination Controls */}
      {filteredAndSorted.length > ROWS_PER_PAGE && (
        <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
          <span>
            Showing {showingStart}-{showingEnd} of {filteredAndSorted.length}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((p) => p - 1)}
            >
              Previous
            </Button>
            <span className="flex items-center px-2">
              Page {currentPage} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Add Modal */}
      <AddFriendModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onCreated={refetch}
      />

      {/* Edit Modal */}
      <EditFriendModal
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setSelectedFriend(null);
        }}
        friend={selectedFriend}
        onSaved={refetch}
      />

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setSelectedFriend(null);
        }}
        onConfirm={handleDeleteFriend}
        title="Remove from Friends List"
        message={`Are you sure you want to remove ${selectedFriend?.osm_username} from the Friends List?`}
        confirmText="Remove"
        variant="destructive"
        isLoading={deleting}
      />
    </div>
  );
}
