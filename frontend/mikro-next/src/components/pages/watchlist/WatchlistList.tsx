"use client";

import React, { useState, useMemo, useEffect } from "react";
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
import { useToastActions } from "@/components/ui";
import { formatNumber, formatDate } from "@/lib/utils";
import {
  type WatchlistEntry,
  filterWatchlist,
  sortWatchlist,
  countActiveLast7Days,
  mostActiveEntry,
} from "./utils";

interface WatchlistListProps {
  entityLabel: string;
  subtitle: string;
  detailBase: string;
  entries: WatchlistEntry[];
  loading: boolean;
  refetch: () => void | Promise<unknown>;
  onDelete: (id: number) => Promise<unknown>;
  deleting: boolean;
  onRefresh: (id: number) => Promise<unknown>;
  renderAddModal: (a: {
    isOpen: boolean;
    onClose: () => void;
    onCreated: () => void;
  }) => React.ReactNode;
  renderEditModal: (a: {
    isOpen: boolean;
    onClose: () => void;
    onSaved: () => void;
    entry: WatchlistEntry | null;
  }) => React.ReactNode;
}

export function WatchlistList({
  entityLabel,
  subtitle,
  detailBase,
  entries,
  loading,
  refetch,
  onDelete,
  deleting,
  onRefresh,
  renderAddModal,
  renderEditModal,
}: WatchlistListProps) {
  const toast = useToastActions();

  // Modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<WatchlistEntry | null>(
    null,
  );

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
  const activeLast7Days = useMemo(
    () => countActiveLast7Days(entries, new Date()),
    [entries],
  );

  const mostActive = useMemo(() => mostActiveEntry(entries), [entries]);

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
    const filtered = filterWatchlist(entries, searchTerm);
    return sortWatchlist(filtered, sortKey, sortDir);
  }, [entries, searchTerm, sortKey, sortDir]);

  // Reset page when search/sort changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, sortKey, sortDir]);

  // Pagination calculations
  const totalPages = Math.ceil(filteredAndSorted.length / ROWS_PER_PAGE);
  const paginatedEntries = filteredAndSorted.slice(
    (currentPage - 1) * ROWS_PER_PAGE,
    currentPage * ROWS_PER_PAGE,
  );
  const showingStart =
    filteredAndSorted.length > 0 ? (currentPage - 1) * ROWS_PER_PAGE + 1 : 0;
  const showingEnd = Math.min(
    currentPage * ROWS_PER_PAGE,
    filteredAndSorted.length,
  );

  const openEditModal = (entry: WatchlistEntry) => {
    setSelectedEntry(entry);
    setShowEditModal(true);
  };

  // CRUD handlers
  const handleDeleteEntry = async () => {
    if (!selectedEntry) return;
    try {
      await onDelete(selectedEntry.id);
      toast.success(`${entityLabel} removed successfully`);
      setShowDeleteModal(false);
      setSelectedEntry(null);
      refetch();
    } catch {
      toast.error(`Failed to remove ${entityLabel.toLowerCase()}`);
    }
  };

  const handleRefresh = async (entry: WatchlistEntry) => {
    setRefreshingIds((prev) => new Set(prev).add(entry.id));
    try {
      await onRefresh(entry.id);
      toast.success(`Refreshed activity for ${entry.osm_username}`);
      refetch();
    } catch {
      toast.error("Failed to refresh activity");
    } finally {
      setRefreshingIds((prev) => {
        const next = new Set(prev);
        next.delete(entry.id);
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
          <p className="text-muted-foreground">{subtitle}</p>
        </div>
        <Button onClick={() => setShowAddModal(true)}>Add {entityLabel}</Button>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Listed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              <Val>{formatNumber(entries.length)}</Val>
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
              {paginatedEntries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`${detailBase}/${entry.id}`}
                      className="text-kaart-orange hover:underline"
                    >
                      {entry.osm_username}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-[200px] truncate">
                    <Val>
                      {entry.notes
                        ? entry.notes.length > 60
                          ? `${entry.notes.slice(0, 60)}...`
                          : entry.notes
                        : null}
                    </Val>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {(entry.tags || []).map((tag) => (
                        <Badge key={tag} variant="secondary">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <Val>{entry.added_by_name}</Val>
                  </TableCell>
                  <TableCell>{formatDate(entry.created_at)}</TableCell>
                  <TableCell>
                    {entry.cached_last_active
                      ? formatDate(entry.cached_last_active)
                      : "Never"}
                  </TableCell>
                  <TableCell>
                    <Val>{formatNumber(entry.cached_total_changesets)}</Val>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openEditModal(entry)}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRefresh(entry)}
                        isLoading={refreshingIds.has(entry.id)}
                      >
                        Refresh
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                          setSelectedEntry(entry);
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
                    {entries.length === 0
                      ? `No ${entityLabel.toLowerCase()}s listed yet. Add an OSM username to start tracking.`
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
      {renderAddModal({
        isOpen: showAddModal,
        onClose: () => setShowAddModal(false),
        onCreated: refetch,
      })}

      {/* Edit Modal */}
      {renderEditModal({
        isOpen: showEditModal,
        onClose: () => {
          setShowEditModal(false);
          setSelectedEntry(null);
        },
        onSaved: refetch,
        entry: selectedEntry,
      })}

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setSelectedEntry(null);
        }}
        onConfirm={handleDeleteEntry}
        title={`Remove from ${entityLabel}s List`}
        message={`Are you sure you want to remove ${selectedEntry?.osm_username} from the ${entityLabel}s List?`}
        confirmText="Remove"
        variant="destructive"
        isLoading={deleting}
      />
    </div>
  );
}
