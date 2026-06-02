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
  Modal,
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
import { useToastActions } from "@/components/ui";
import {
  usePunksList,
  useCreatePunk,
  useUpdatePunk,
  useDeletePunk,
  useRefreshPunkActivity,
} from "@/hooks";
import type { Punk } from "@/types";
import { formatNumber } from "@/lib/utils";

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function AdminPunksPage() {
  const { data, loading, refetch } = usePunksList();
  const { mutate: createPunk, loading: creating } = useCreatePunk();
  const { mutate: updatePunk, loading: updating } = useUpdatePunk();
  const { mutate: deletePunk, loading: deleting } = useDeletePunk();
  const { mutate: refreshPunkActivity } = useRefreshPunkActivity();
  const toast = useToastActions();

  const punks = data?.punks ?? [];

  // Modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedPunk, setSelectedPunk] = useState<Punk | null>(null);

  // Add form fields
  const [addUsername, setAddUsername] = useState("");
  const [addNotes, setAddNotes] = useState("");
  const [addTags, setAddTags] = useState("");

  // Edit form fields
  const [editNotes, setEditNotes] = useState("");
  const [editTags, setEditTags] = useState("");

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
    return punks.filter(
      (p) =>
        p.cached_last_active && new Date(p.cached_last_active) >= sevenDaysAgo,
    ).length;
  }, [punks]);

  const mostActive = useMemo(() => {
    if (punks.length === 0) return null;
    return punks.reduce<Punk | null>((best, p) => {
      if (!best) return p;
      return (p.cached_total_changesets ?? 0) >
        (best.cached_total_changesets ?? 0)
        ? p
        : best;
    }, null);
  }, [punks]);

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
    let filtered = punks;
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
  }, [punks, searchTerm, sortKey, sortDir]);

  // Reset page when search/sort changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, sortKey, sortDir]);

  // Pagination calculations
  const totalPages = Math.ceil(filteredAndSorted.length / ROWS_PER_PAGE);
  const paginatedPunks = filteredAndSorted.slice(
    (currentPage - 1) * ROWS_PER_PAGE,
    currentPage * ROWS_PER_PAGE,
  );
  const showingStart =
    filteredAndSorted.length > 0 ? (currentPage - 1) * ROWS_PER_PAGE + 1 : 0;
  const showingEnd = Math.min(
    currentPage * ROWS_PER_PAGE,
    filteredAndSorted.length,
  );

  // CRUD handlers
  const handleCreatePunk = async () => {
    if (!addUsername.trim()) {
      toast.error("OSM username is required");
      return;
    }
    try {
      await createPunk({
        osm_username: addUsername.trim(),
        notes: addNotes,
        tags: addTags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      });
      toast.success("Punk added successfully");
      setShowAddModal(false);
      setAddUsername("");
      setAddNotes("");
      setAddTags("");
      refetch();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to add punk";
      toast.error(message);
    }
  };

  const openEditModal = (punk: Punk) => {
    setSelectedPunk(punk);
    setEditNotes(punk.notes || "");
    setEditTags((punk.tags || []).join(", "));
    setShowEditModal(true);
  };

  const handleUpdatePunk = async () => {
    if (!selectedPunk) return;
    try {
      await updatePunk({
        punk_id: selectedPunk.id,
        notes: editNotes,
        tags: editTags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      });
      toast.success("Punk updated successfully");
      setShowEditModal(false);
      setSelectedPunk(null);
      refetch();
    } catch {
      toast.error("Failed to update punk");
    }
  };

  const handleDeletePunk = async () => {
    if (!selectedPunk) return;
    try {
      await deletePunk({ punk_id: selectedPunk.id });
      toast.success("Punk removed successfully");
      setShowDeleteModal(false);
      setSelectedPunk(null);
      refetch();
    } catch {
      toast.error("Failed to remove punk");
    }
  };

  const handleRefresh = async (punk: Punk) => {
    setRefreshingIds((prev) => new Set(prev).add(punk.id));
    try {
      await refreshPunkActivity({ punk_id: punk.id });
      toast.success(`Refreshed activity for ${punk.osm_username}`);
      refetch();
    } catch {
      toast.error("Failed to refresh activity");
    } finally {
      setRefreshingIds((prev) => {
        const next = new Set(prev);
        next.delete(punk.id);
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
          <h1 className="text-3xl font-bold tracking-tight">Punks List</h1>
          <p className="text-muted-foreground">
            Track and manage problematic OSM users
          </p>
        </div>
        <Button onClick={() => setShowAddModal(true)}>Add Punk</Button>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Listed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              <Val>{formatNumber(punks.length)}</Val>
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
              {paginatedPunks.map((punk) => (
                <TableRow key={punk.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/admin/punks/${punk.id}`}
                      className="text-kaart-orange hover:underline"
                    >
                      {punk.osm_username}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-[200px] truncate">
                    <Val>
                      {punk.notes
                        ? punk.notes.length > 60
                          ? `${punk.notes.slice(0, 60)}...`
                          : punk.notes
                        : null}
                    </Val>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {(punk.tags || []).map((tag) => (
                        <Badge key={tag} variant="secondary">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <Val>{punk.added_by_name}</Val>
                  </TableCell>
                  <TableCell>{formatDate(punk.created_at)}</TableCell>
                  <TableCell>
                    {punk.cached_last_active
                      ? formatDate(punk.cached_last_active)
                      : "Never"}
                  </TableCell>
                  <TableCell>
                    <Val>{formatNumber(punk.cached_total_changesets)}</Val>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openEditModal(punk)}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRefresh(punk)}
                        isLoading={refreshingIds.has(punk.id)}
                      >
                        Refresh
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                          setSelectedPunk(punk);
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
                    {punks.length === 0
                      ? "No punks listed yet. Add an OSM username to start tracking."
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
      <Modal
        isOpen={showAddModal}
        onClose={() => {
          setShowAddModal(false);
          setAddUsername("");
          setAddNotes("");
          setAddTags("");
        }}
        title="Add to Punks List"
        description="Add an OSM user to the punks tracking list"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowAddModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreatePunk} isLoading={creating}>
              Add Punk
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="OSM Username"
            placeholder="Enter OSM username"
            value={addUsername}
            onChange={(e) => setAddUsername(e.target.value)}
          />
          <div>
            <label className="text-sm font-medium leading-none mb-2 block">
              Notes
            </label>
            <textarea
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              rows={3}
              placeholder="Optional notes about this user..."
              value={addNotes}
              onChange={(e) => setAddNotes(e.target.value)}
            />
          </div>
          <Input
            label="Tags"
            placeholder="vandal, revert-war, building-damage"
            value={addTags}
            onChange={(e) => setAddTags(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Separate tags with commas
          </p>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setSelectedPunk(null);
        }}
        title="Edit Punk"
        description={`Editing ${selectedPunk?.osm_username}`}
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setShowEditModal(false);
                setSelectedPunk(null);
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleUpdatePunk} isLoading={updating}>
              Save Changes
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium leading-none mb-2 block">
              OSM Username
            </label>
            <p className="text-sm text-muted-foreground">
              {selectedPunk?.osm_username}
            </p>
          </div>
          <div>
            <label className="text-sm font-medium leading-none mb-2 block">
              Notes
            </label>
            <textarea
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              rows={3}
              placeholder="Notes about this user..."
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
            />
          </div>
          <Input
            label="Tags"
            placeholder="vandal, revert-war, building-damage"
            value={editTags}
            onChange={(e) => setEditTags(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Separate tags with commas
          </p>
        </div>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setSelectedPunk(null);
        }}
        onConfirm={handleDeletePunk}
        title="Remove from Punks List"
        message={`Are you sure you want to remove ${selectedPunk?.osm_username} from the Punks List?`}
        confirmText="Remove"
        variant="destructive"
        isLoading={deleting}
      />
    </div>
  );
}
