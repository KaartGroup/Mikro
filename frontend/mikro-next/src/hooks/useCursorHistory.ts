"use client";

import { useState, useCallback, useRef } from "react";
import { useApiMutation } from "./useApi";
import type { TimeEntry, TimeTrackingHistoryResponse } from "@/types";

type Cursor = { clockIn: string; id: number };

interface HistoryStats {
  totalHours: number;
  pendingAdjustments: number;
  voidedEntries: number;
}

interface CursorHistoryResult {
  entries: TimeEntry[];
  nextCursor: Cursor | null;
  loading: boolean;
  loadingMore: boolean;
  stats: HistoryStats | null;
  /** Fetch page 1 with the given filters. Resets accumulated entries + cursor. */
  fetchPage: (filters?: Record<string, unknown>) => Promise<void>;
  /** Append the next server page using the stored cursor + last filters. */
  loadMore: () => Promise<void>;
}

/**
 * Shared cursor-based pagination hook for time-entry history endpoints.
 *
 * Usage:
 *   const history = useCursorHistory("/timetracking/history");
 *   history.fetchPage({ startDate, teamId });   // call when filters change
 *   history.loadMore();                          // call from Next button
 */
export function useCursorHistory(endpoint: string): CursorHistoryResult {
  const { mutate: fetchHistoryPage } =
    useApiMutation<TimeTrackingHistoryResponse>(endpoint);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<Cursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [stats, setStats] = useState<HistoryStats | null>(null);
  const lastFiltersRef = useRef<Record<string, unknown>>({});

  const fetchPage = useCallback(
    async (filters: Record<string, unknown> = {}) => {
      lastFiltersRef.current = filters;
      setLoading(true);
      try {
        const result = await fetchHistoryPage(filters);
        setEntries(result?.entries ?? []);
        setNextCursor(result?.nextCursor ?? null);
        if (result?.stats) setStats(result.stats);
      } catch {
        /* surfaced by mutation */
      } finally {
        setLoading(false);
      }
    },
    [fetchHistoryPage],
  );

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const result = await fetchHistoryPage({
        ...lastFiltersRef.current,
        cursor: nextCursor,
      });
      setEntries((prev) => [...prev, ...(result?.entries ?? [])]);
      setNextCursor(result?.nextCursor ?? null);
    } catch {
      /* surfaced by mutation */
    } finally {
      setLoadingMore(false);
    }
  }, [fetchHistoryPage, nextCursor]);

  return { entries, nextCursor, loading, loadingMore, stats, fetchPage, loadMore };
}
