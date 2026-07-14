"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useFetchTimekeepingStats } from "@/hooks/useApi";
import {
  dateInputToLocalStartIsoUtc,
  dateInputToLocalEndIsoUtc,
} from "@/lib/timeTracking";
import type { TimekeepingStatsResponse } from "@/types";

/**
 * Reports v2 shared data hook.
 *
 * DUPLICATED (deliberately) from AdminReports' fetch orchestration so the
 * live /reports page stays untouched — see the Phase 1 decision in
 * .claude/reports-v2-configurable-ui-plan.md. v1 and v2 can converge later
 * only if proven identical.
 *
 * Phase 1 scope: fetches timekeeping stats for a default (previous-week)
 * range and exposes the weekly/daily granularity toggle. Date-range and
 * filter controls, plus the editing/heatmap/element sources, are added in a
 * later phase — every future block subscribes to this one context rather
 * than refetching.
 */

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function prevWeekRange() {
  const today = new Date();
  const dow = today.getDay();
  const daysToLastSat = dow === 6 ? 7 : dow + 1;
  const lastSat = new Date(today);
  lastSat.setDate(today.getDate() - daysToLastSat);
  const prevSun = new Date(lastSat);
  prevSun.setDate(lastSat.getDate() - 6);
  return { start: localDateStr(prevSun), end: localDateStr(lastSat) };
}

export type ReportsGranularity = "weekly" | "daily";

export interface ReportsData {
  timekeeping: TimekeepingStatsResponse | null;
  granularity: ReportsGranularity;
  setGranularity: (g: ReportsGranularity) => void;
  loading: boolean;
  dateRange: { start: string; end: string };
}

export function useReportsData(): ReportsData {
  const dateRange = useMemo(() => prevWeekRange(), []);
  const [granularity, setGranularity] = useState<ReportsGranularity>("weekly");
  const [timekeeping, setTimekeeping] =
    useState<TimekeepingStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const { mutate: fetchTimekeeping } = useFetchTimekeepingStats();

  const fetchData = useCallback(async () => {
    const startIso = dateInputToLocalStartIsoUtc(dateRange.start);
    const endIso = dateInputToLocalEndIsoUtc(dateRange.end);
    setLoading(true);
    try {
      const res = await fetchTimekeeping({
        startDate: startIso,
        endDate: endIso,
        filters: {},
      });
      if (res?.status === 200) setTimekeeping(res);
    } catch {
      // Non-fatal: blocks render an empty state when timekeeping is null.
    } finally {
      setLoading(false);
    }
  }, [dateRange, fetchTimekeeping]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { timekeeping, granularity, setGranularity, loading, dateRange };
}
