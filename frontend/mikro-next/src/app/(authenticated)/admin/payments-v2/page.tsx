"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Modal,
  Input,
  Skeleton,
  useToastActions,
  Val,
} from "@/components/ui";
import { formatCurrency, formatNumber, type FormattedValue } from "@/lib/utils";
import {
  useFetchPaymentCycle,
  useFetchPaymentCycleKpis,
  useFetchPaymentForecast,
  useFetchProjectDispensation,
  useSetPaymentCycleStatus,
  useExportPaymentCycle,
  useCurrentUserRole,
  useFetchFilterOptions,
} from "@/hooks";
import { StandaloneFilter } from "@/components/admin/StandaloneFilter";
import { isOrgAdminOrAbove } from "@/types";
import type {
  PaymentCycleKpis,
  PaymentCycleResponse,
  PaymentCycleRow,
  PaymentCycleStatus,
} from "@/types";
import {
  PaymentsTable,
  PAYMENTS_TABLE_COLUMNS,
} from "@/components/admin/payments/PaymentsTable";
import { ColumnsMenu } from "@/components/admin/payments/ColumnsMenu";
import { ContributorDetailPanel } from "@/components/admin/payments/ContributorDetailPanel";
import { CyclePicker } from "@/components/admin/payments/CyclePicker";
import { CycleConfigModal } from "@/components/admin/payments/CycleConfigModal";
import { PayrollForecastChart } from "@/components/admin/payments/PayrollForecastChart";
import { ProjectDispensationCard } from "@/components/admin/payments/ProjectDispensationCard";
import type {
  PayrollForecastResponse,
  ProjectDispensationResponse,
} from "@/types";

// ─── helpers ────────────────────────────────────────────────────────

// Role hierarchy — mirrors backend pay_visibility._ROLE_RANK. The Role
// filter only offers roles ranking strictly below the viewer's own, so a
// team_admin can't even attempt to isolate org/super/peer-admin pay
// (the backend SSOT enforces it regardless; this keeps the UI honest).
const ROLE_RANK: Record<string, number> = {
  user: 0,
  validator: 0,
  team_admin: 2,
  admin: 3,
  super_admin: 4,
};

function firstOfMonthIso(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function lastOfMonthIso(d = new Date()): string {
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-${String(
    last.getDate(),
  ).padStart(2, "0")}`;
}

function firstOfLastMonthIso(d = new Date()): string {
  const target = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return firstOfMonthIso(target);
}

function lastOfLastMonthIso(d = new Date()): string {
  const target = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return lastOfMonthIso(target);
}

// ─── page ───────────────────────────────────────────────────────────

export default function AdminPaymentsV2Page() {
  const toast = useToastActions();
  const { role: viewerRole } = useCurrentUserRole();
  const canEdit = isOrgAdminOrAbove(viewerRole);

  // Cycle state
  const [cycleStart, setCycleStart] = useState(firstOfMonthIso());
  const [cycleEnd, setCycleEnd] = useState(lastOfMonthIso());
  const [includeZeroHours, setIncludeZeroHours] = useState(false);

  // Data
  const [rows, setRows] = useState<PaymentCycleRow[]>([]);
  const [kpis, setKpis] = useState<PaymentCycleKpis | null>(null);
  const [forecast, setForecast] = useState<PayrollForecastResponse | null>(
    null,
  );
  const [dispensation, setDispensation] =
    useState<ProjectDispensationResponse | null>(null);
  const { mutate: fetchDispensation } = useFetchProjectDispensation();
  const { mutate: fetchCycle, loading: cycleLoading } = useFetchPaymentCycle();
  const { mutate: fetchKpis } = useFetchPaymentCycleKpis();
  const { mutate: fetchForecast, loading: forecastLoading } =
    useFetchPaymentForecast();
  const { mutate: setStatus } = useSetPaymentCycleStatus();
  const { download: exportCsv, loading: exporting } = useExportPaymentCycle();

  // Drill-in drawer
  const [drillRow, setDrillRow] = useState<PaymentCycleRow | null>(null);

  // Hold modal
  const [holdTarget, setHoldTarget] = useState<PaymentCycleRow | null>(null);
  const [holdNote, setHoldNote] = useState("");

  // Table filters / search / pagination
  type TableFilter =
    | "all"
    | "hourly"
    | "salaried"
    | "project"
    | "hybrid"
    | "on_hold"
    | "info_needed";
  const [filter, setFilter] = useState<TableFilter>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Master page filter — mirrors the Users/Projects standard filters.
  // Resolved server-side via the same `filters` body + resolve_filtered_
  // user_ids, intersected with team scope so it can never conflict with
  // the per-table chips (which only ever subset what this returns).
  const [filterRegionId, setFilterRegionId] = useState<string | null>(null);
  const [filterCountryId, setFilterCountryId] = useState<string | null>(null);
  const [filterTeamId, setFilterTeamId] = useState<string | null>(null);
  const [filterRole, setFilterRole] = useState<string | null>(null);
  const [filterTimezone, setFilterTimezone] = useState<string | null>(null);
  const [filterComp, setFilterComp] = useState<string | null>(null);
  const [showCycleConfig, setShowCycleConfig] = useState(false);
  // Column show/hide. Empty = all shown; resets each visit (no persistence).
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set());
  const { data: filterOptions } = useFetchFilterOptions();

  const filtersBody = useMemo(() => {
    const f: Record<string, string[]> = {};
    if (filterRegionId) f.region = [filterRegionId];
    if (filterCountryId) f.country = [filterCountryId];
    if (filterTeamId) f.team = [filterTeamId];
    if (filterRole) f.role = [filterRole];
    if (filterTimezone) f.timezone = [filterTimezone];
    if (filterComp) f.compensation = [filterComp];
    return Object.keys(f).length > 0 ? f : undefined;
  }, [
    filterRegionId,
    filterCountryId,
    filterTeamId,
    filterRole,
    filterTimezone,
    filterComp,
  ]);

  // Load cycle + KPIs
  const reload = async () => {
    try {
      const [cycle, kpisRes] = await Promise.all([
        fetchCycle({
          cycle_start: cycleStart,
          cycle_end: cycleEnd,
          include_zero_hours: includeZeroHours,
          ...(filtersBody ? { filters: filtersBody } : {}),
        }),
        fetchKpis({
          cycle_start: cycleStart,
          cycle_end: cycleEnd,
          ...(filtersBody ? { filters: filtersBody } : {}),
        }),
      ]);
      setRows((cycle as PaymentCycleResponse).rows);
      setKpis(kpisRes.kpis);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to load payroll cycle",
      );
    }
  };

  // Forecast — cohort depends on master filters; cadence/today drive
  // the periods (so it does NOT depend on cycleStart). Also refreshed
  // explicitly after a cadence-config save.
  const reloadForecast = async () => {
    try {
      const res = await fetchForecast(
        filtersBody ? { filters: filtersBody } : {},
      );
      setForecast(res);
    } catch {
      /* non-fatal — card shows its empty/loading state */
    }
  };

  useEffect(() => {
    reloadForecast();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersBody]);

  // Project dispensation — org/team-scoped, not affected by master
  // filters or cycle, so fetch once on mount.
  useEffect(() => {
    fetchDispensation({})
      .then(setDispensation)
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycleStart, cycleEnd, includeZeroHours, filtersBody]);

  // Reset to page 1 when filter / search / cycle changes
  useEffect(() => {
    setPage(1);
  }, [filter, search, cycleStart, cycleEnd, filtersBody]);

  // Status setters
  const setRowStatus = async (
    row: PaymentCycleRow,
    status: PaymentCycleStatus,
    note?: string,
  ) => {
    try {
      await setStatus({
        user_id: row.user_id,
        cycle_start: cycleStart,
        cycle_end: cycleEnd,
        status,
        note: note ?? null,
      });
      toast.success(`Marked ${row.name} as ${status}`);
      reload();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update status",
      );
    }
  };

  const onApprove = (row: PaymentCycleRow) => setRowStatus(row, "approved");
  const onHold = (row: PaymentCycleRow) => {
    setHoldTarget(row);
    setHoldNote("");
  };
  const onConfirmHold = async () => {
    if (!holdTarget) return;
    if (!holdNote.trim()) {
      toast.error("Hold reason is required");
      return;
    }
    await setRowStatus(holdTarget, "held", holdNote.trim());
    setHoldTarget(null);
  };
  const onMarkPaid = (row: PaymentCycleRow) => setRowStatus(row, "paid");
  const onResetPending = (row: PaymentCycleRow) =>
    setRowStatus(row, "pending");

  const onExport = async () => {
    try {
      await exportCsv(cycleStart, cycleEnd, filtersBody);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    }
  };

  // Derived KPIs (computed from rows when backend KPI doesn't provide them)
  const pendingTotal = rows
    .filter((r) => r.status === "pending")
    .reduce((s, r) => s + (r.total_payable || 0), 0);
  const heldTotal = rows
    .filter((r) => r.status === "held")
    .reduce((s, r) => s + (r.total_payable || 0), 0);
  const activeContributors = rows.filter((r) => (r.hours || 0) > 0).length;
  const cyclePayableTotal = kpis?.total_payable ?? 0;
  const avgPayout =
    activeContributors > 0 ? cyclePayableTotal / activeContributors : 0;
  const ratedRows = rows.filter((r) => (r.hourly_rate ?? 0) > 0);
  const avgHourlyRate =
    ratedRows.length > 0
      ? ratedRows.reduce((s, r) => s + (r.hourly_rate || 0), 0) /
        ratedRows.length
      : 0;

  // Apply table filter + search
  const filteredRows = rows.filter((r) => {
    // Filter chip — now backed by the real compensation_model field.
    // These narrow WITHIN the master-filtered set (can't conflict).
    if (filter === "hourly" && r.compensation_model !== "hourly") return false;
    if (filter === "salaried" && r.compensation_model !== "salaried")
      return false;
    if (filter === "project" && r.compensation_model !== "project_based")
      return false;
    if (filter === "hybrid" && r.compensation_model !== "hybrid") return false;
    if (filter === "on_hold" && r.status !== "held") return false;
    // "Info needed": no pay basis configured at all.
    if (
      filter === "info_needed" &&
      ((r.hourly_rate ?? 0) > 0 || (r.monthly_salary ?? 0) > 0)
    )
      return false;

    // Search
    if (search) {
      const q = search.toLowerCase();
      const hay = `${r.name} ${r.osm_username ?? ""} ${r.email ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedRows = filteredRows.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize,
  );

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Payroll & Financial Operations</h1>
          <p className="text-sm text-muted-foreground">
            Unified workflow for compensation, reviews, and payouts
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CyclePicker
            cycleStart={cycleStart}
            cycleEnd={cycleEnd}
            onChange={(s, e) => {
              setCycleStart(s);
              setCycleEnd(e);
            }}
          />
          {canEdit && (
            <button
              type="button"
              onClick={() => setShowCycleConfig(true)}
              title="Configure payroll cadence (org admin)"
              className="self-stretch px-3 rounded-md border border-border bg-muted/30 text-sm font-medium hover:bg-muted/50 transition-colors whitespace-nowrap flex items-center"
            >
              Configure Cycle
            </button>
          )}
          <span
            title={
              "PLACEHOLDER — not wired. Need from Logan: what a 'view' " +
              "saves (master filters + cycle + visible columns + table " +
              "chip?), whether views are per-admin or shared org-wide, and " +
              "whether they persist across devices (backend table) or just " +
              "the browser. Deferred until defined."
            }
            className="inline-flex"
          >
            <button
              type="button"
              disabled
              className="px-3 py-1.5 rounded-md border border-border bg-muted/30 text-sm flex items-center gap-2 hover:bg-muted/50 transition-colors disabled:cursor-not-allowed"
            >
              <span className="flex flex-col items-start leading-tight">
                <span className="text-xs text-muted-foreground">View</span>
                <span className="font-medium">Saved Views ▾</span>
              </span>
              <MockBadge />
            </button>
          </span>
        </div>
      </div>

      {/* Master filter bar — same standard filters as Users/Projects.
          Page-wide: narrows the table AND the selected-contributor detail.
          Server resolves via the universal `filters` body intersected with
          team scope, so it can never conflict with the per-table chips. */}
      <Card>
        <CardContent className="py-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-44">
              <StandaloneFilter
                label="Region"
                allLabel="All regions"
                options={(filterOptions?.dimensions?.region ?? []).map((v) =>
                  typeof v === "string"
                    ? { value: v, label: v }
                    : { value: String(v.id ?? v.name), label: v.name },
                )}
                value={filterRegionId}
                onChange={setFilterRegionId}
              />
            </div>
            <div className="w-44">
              <StandaloneFilter
                label="Country"
                allLabel="All countries"
                options={(filterOptions?.dimensions?.country ?? []).map((v) =>
                  typeof v === "string"
                    ? { value: v, label: v }
                    : { value: String(v.id ?? v.name), label: v.name },
                )}
                value={filterCountryId}
                onChange={setFilterCountryId}
              />
            </div>
            <div className="w-44">
              <StandaloneFilter
                label="Team"
                allLabel="All teams"
                options={(filterOptions?.dimensions?.team ?? []).map((v) =>
                  typeof v === "string"
                    ? { value: v, label: v }
                    : { value: String(v.id ?? v.name), label: v.name },
                )}
                value={filterTeamId}
                onChange={setFilterTeamId}
              />
            </div>
            <div className="w-44">
              <StandaloneFilter
                label="Role"
                allLabel="All roles"
                options={(filterOptions?.dimensions?.role ?? [])
                  .filter((v) => {
                    const r =
                      typeof v === "string" ? v : String(v.id ?? v.name);
                    const viewerRank = ROLE_RANK[viewerRole ?? ""] ?? 0;
                    return (ROLE_RANK[r] ?? 0) < viewerRank;
                  })
                  .map((v) =>
                    typeof v === "string"
                      ? { value: v, label: v.charAt(0).toUpperCase() + v.slice(1) }
                      : { value: String(v.id ?? v.name), label: v.name },
                  )}
                value={filterRole}
                onChange={setFilterRole}
              />
            </div>
            <div className="w-44">
              <StandaloneFilter
                label="Timezone"
                allLabel="All timezones"
                options={(filterOptions?.dimensions?.timezone ?? []).map((v) =>
                  typeof v === "string"
                    ? { value: v, label: v }
                    : { value: String(v.id ?? v.name), label: v.name },
                )}
                value={filterTimezone}
                onChange={setFilterTimezone}
              />
            </div>
            <div className="w-48">
              <StandaloneFilter
                label="Compensation"
                allLabel="All (excl. per-task)"
                options={[
                  { value: "hourly", label: "Hourly" },
                  { value: "salaried", label: "Salaried" },
                  { value: "project_based", label: "Project-based" },
                  { value: "hybrid", label: "Hybrid" },
                  { value: "per_task", label: "Per-task (micro-paid)" },
                ]}
                value={filterComp}
                onChange={setFilterComp}
              />
            </div>
            {filtersBody && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setFilterRegionId(null);
                  setFilterCountryId(null);
                  setFilterTeamId(null);
                  setFilterRole(null);
                  setFilterTimezone(null);
                  setFilterComp(null);
                }}
              >
                Clear filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* KPI strip — 8 cards matching mockup */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        <KpiCard
          label="Total Payable"
          value={kpis ? formatCurrency(kpis.total_payable) : null}
          subtitle="All rows this cycle"
          trend={{ dir: "up", text: "+12%", mock: true }}
        />
        <KpiCard
          label="Total Paid"
          value={kpis ? formatCurrency(kpis.total_paid_lifetime) : null}
          subtitle="Lifetime recorded payouts"
        />
        <KpiCard
          label="Pending Payment"
          value={formatCurrency(pendingTotal)}
          subtitle={kpis ? `${kpis.pending_count} awaiting review` : "—"}
          trend={{ dir: "flat", text: `${kpis?.pending_count ?? 0} rows`, mock: false }}
        />
        <KpiCard
          label="On Hold"
          value={formatCurrency(heldTotal)}
          subtitle={kpis ? `${kpis.held_count} blocked` : "—"}
          trend={{ dir: kpis && kpis.held_count > 0 ? "down" : "flat", text: `${kpis?.held_count ?? 0} rows`, mock: false }}
        />
        <KpiCard
          label="Active Contributors"
          value={formatNumber(activeContributors)}
          subtitle="With hours this cycle"
          trend={{ dir: "up", text: `of ${rows.length}`, mock: false }}
        />
        <KpiCard
          label="Avg. Payout"
          value={formatCurrency(avgPayout)}
          subtitle="Per active contributor"
          trend={{ dir: "flat", text: "this cycle", mock: false }}
        />
        <KpiCard
          label="Avg. Hourly Rate"
          value={formatCurrency(avgHourlyRate)}
          subtitle={`${ratedRows.length} rated users`}
          trend={{ dir: "flat", text: "current", mock: false }}
        />
        <KpiCard
          label="Audit Issues"
          value="3"
          subtitle="Anomalies needing review"
          mock
          tooltip={
            "PLACEHOLDER — not wired. Need from Logan: which signals count " +
            "as an 'audit issue' — held rows / missing pay basis (model " +
            "needs a rate or salary but none set) / missing payment_email / " +
            "over-long sessions (what hour threshold?) / approved-but-unpaid " +
            "older than N days (what N?) — and which combine into the count. " +
            "Backend has no audit logic yet; value '3' is fake."
          }
          trend={{ dir: "down", text: "−1 vs last", mock: true }}
        />
      </div>

      {/* Main grid: 8-col main / 4-col right rail */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* LEFT: table + featured contributor */}
        <div className="lg:col-span-8 space-y-4">
          {/* Pending payments — filter chips + search + columns/export + table + pagination */}
          <Card>
            <CardHeader>
              <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
                Pending Payments This Cycle
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Filter chips */}
              <div className="flex items-center gap-2 flex-wrap">
                {(
                  [
                    { id: "all", label: "All", mock: false },
                    { id: "hourly", label: "Hourly", mock: false },
                    { id: "salaried", label: "Salaried", mock: false },
                    { id: "project", label: "Project-based", mock: false },
                    { id: "hybrid", label: "Hybrid", mock: false },
                    { id: "on_hold", label: "On Hold", mock: false },
                    { id: "info_needed", label: "Info Needed", mock: false },
                  ] as { id: TableFilter; label: string; mock: boolean }[]
                ).map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    onClick={() => setFilter(chip.id)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border transition-colors ${
                      filter === chip.id
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted/30 border-border text-muted-foreground hover:bg-muted/50"
                    }`}
                    title={chip.mock ? "Mock filter — data field not yet implemented" : undefined}
                  >
                    {chip.label}
                    {chip.mock && <MockBadge />}
                  </button>
                ))}
              </div>

              {/* Search + Columns + Export row */}
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative flex-1 min-w-[200px]">
                  <input
                    type="text"
                    placeholder="Search contributors…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 text-sm rounded-md border border-input bg-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                    ⌕
                  </span>
                </div>
                <ColumnsMenu
                  columns={PAYMENTS_TABLE_COLUMNS}
                  hidden={hiddenCols}
                  onToggle={(key) =>
                    setHiddenCols((prev) => {
                      const next = new Set(prev);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      return next;
                    })
                  }
                  onShowAll={() => setHiddenCols(new Set())}
                />
                {canEdit && (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={onExport}
                    isLoading={exporting}
                    disabled={!kpis || kpis.approved_count === 0}
                  >
                    Export
                  </Button>
                )}
              </div>
            </CardContent>
            <CardContent className="p-0">
              <PaymentsTable
                rows={pagedRows}
                canEditStatus={canEdit}
                loading={cycleLoading}
                hiddenColumns={hiddenCols}
                onRowClick={setDrillRow}
                onApprove={onApprove}
                onHold={onHold}
                onMarkPaid={onMarkPaid}
                onResetPending={onResetPending}
              />
            </CardContent>
            <CardContent className="border-t border-border">
              <div className="flex items-center justify-between text-xs text-muted-foreground flex-wrap gap-2">
                <div>
                  Showing {filteredRows.length === 0 ? 0 : (safePage - 1) * pageSize + 1} to{" "}
                  {Math.min(safePage * pageSize, filteredRows.length)} of {filteredRows.length} contributors
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={safePage <= 1}
                    className="px-2 py-1 rounded border border-border hover:bg-muted/50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    ‹
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPage(p)}
                      className={`w-7 h-7 rounded text-xs transition-colors ${
                        p === safePage
                          ? "bg-primary text-primary-foreground"
                          : "border border-border hover:bg-muted/50"
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={safePage >= totalPages}
                    className="px-2 py-1 rounded border border-border hover:bg-muted/50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    ›
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <span>Rows per page:</span>
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setPage(1);
                    }}
                    className="px-1.5 py-0.5 rounded border border-border bg-background text-xs"
                  >
                    {[10, 20, 50, 100].map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Selected contributor detail (in-place, replaces modal) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
                Selected Contributor Detail
                <span className="ml-2 text-[10px] normal-case tracking-normal text-muted-foreground/70 italic">
                  (shows details for the row selected in the table above — section title added for clarity; the mockup has no header here)
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ContributorDetailPanel
                row={drillRow}
                cycleStart={cycleStart}
                cycleEnd={cycleEnd}
                filters={filtersBody}
                canEdit={canEdit}
                onChanged={reload}
                onApprove={onApprove}
                onHold={onHold}
                onMarkPaid={onMarkPaid}
                onResetPending={onResetPending}
              />
            </CardContent>
          </Card>
        </div>

        {/* RIGHT RAIL: cycle overview donut + notifications + provider status.
            Flex column so the 3 cards grow to fill the rail and the bottom of
            the last card aligns with the bottom of the left column. */}
        <div className="lg:col-span-4 flex flex-col gap-4">
          <Card className="flex-1 flex flex-col">
            <CardHeader>
              <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
                Payroll Cycle Overview
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 flex items-center">
              {kpis ? (
                <StatusDonut
                  segments={[
                    {
                      label: "Approved",
                      value: kpis.approved_count,
                      color: "#22c55e",
                    },
                    {
                      label: "Pending",
                      value: kpis.pending_count,
                      color: "#eab308",
                    },
                    {
                      label: "Held",
                      value: kpis.held_count,
                      color: "#ef4444",
                    },
                    {
                      label: "Paid",
                      value: kpis.paid_count,
                      color: "#3b82f6",
                    },
                  ]}
                />
              ) : (
                <Skeleton className="h-32 w-full" />
              )}
            </CardContent>
          </Card>

          <Card
            className="opacity-95 flex-1 flex flex-col"
            title={
              "PLACEHOLDER — not wired. Blocked on the comms platform " +
              "(notification model + mailer + in-app bell), which is " +
              "unbuilt and gated on SMTP setup. Need from Logan: which " +
              "payroll events should notify (entry waived/adjusted, " +
              "reimbursement request, bank info missing, cycle disbursed) " +
              "and to whom. No live notification source exists yet."
            }
          >
            <CardHeader>
              <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                Notifications & Alerts <MockBadge />
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1">
              <ul className="space-y-2 text-sm">
                <li className="flex gap-2">
                  <span className="text-yellow-500">⚠</span>
                  <span><span className="font-medium">Sarah Chen</span> — 72-hour session detected</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-blue-500">ℹ</span>
                  <span>3 new reimbursement requests in queue</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-red-500">●</span>
                  <span><span className="font-medium">Marcus Lee</span> — bank info incomplete</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-green-500">✓</span>
                  <span>April cycle disbursed successfully</span>
                </li>
              </ul>
            </CardContent>
          </Card>

          <Card
            className="opacity-95 flex-1 flex flex-col"
            title={
              "PLACEHOLDER — not wired. No payment-provider integration " +
              "exists (F15, P3, long-term); Aaron disburses manually. " +
              "Need from Logan / F15: which providers (Payoneer / Stripe / " +
              "manual CSV), what 'status' means (API health? connected " +
              "account?), and whether Mikro integrates with providers or " +
              "only tracks manual disbursement."
            }
          >
            <CardHeader>
              <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                Payment Provider Status <MockBadge />
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1">
              <ul className="space-y-2 text-sm">
                <li className="flex items-center justify-between">
                  <span>Payoneer</span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200 text-xs">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500" /> Connected
                  </span>
                </li>
                <li className="flex items-center justify-between">
                  <span>Stripe</span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-xs">
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" /> Not configured
                  </span>
                </li>
                <li className="flex items-center justify-between">
                  <span>Manual (CSV)</span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200 text-xs">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500" /> Active
                  </span>
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Bottom row — 5 widgets (3 live, 2 still mock) */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
              Compensation Model Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              if (!kpis) return <Skeleton className="h-24 w-full" />;
              const d = kpis.compensation_distribution;
              const total =
                d.hourly +
                d.salaried +
                d.project_based +
                d.hybrid +
                d.per_task;
              if (total === 0) {
                return (
                  <div className="text-xs text-muted-foreground italic">
                    No contributors in scope.
                  </div>
                );
              }
              return (
                <div className="space-y-2">
                  <StatusDonut
                    segments={[
                      { label: "Hourly", value: d.hourly, color: "#3b82f6" },
                      { label: "Salaried", value: d.salaried, color: "#f59e0b" },
                      {
                        label: "Project-based",
                        value: d.project_based,
                        color: "#a855f7",
                      },
                      { label: "Hybrid", value: d.hybrid, color: "#ec4899" },
                      { label: "Per-task", value: d.per_task, color: "#14b8a6" },
                    ]}
                  />
                  <div className="text-[10px] text-muted-foreground pt-1">
                    {total} contributor{total === 1 ? "" : "s"} in scope
                    (includes per-task; reflects true workforce makeup)
                  </div>
                </div>
              );
            })()}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
              Payroll Forecast
            </CardTitle>
          </CardHeader>
          <CardContent>
            {forecastLoading && !forecast ? (
              <Skeleton className="h-40 w-full" />
            ) : forecast ? (
              <PayrollForecastChart
                cycles={forecast.cycles}
                stats={forecast.stats}
              />
            ) : (
              <div className="text-xs text-muted-foreground italic">
                Forecast unavailable.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
              Project Dispensation Overview
            </CardTitle>
          </CardHeader>
          <CardContent>
            {dispensation ? (
              <ProjectDispensationCard data={dispensation} />
            ) : (
              <Skeleton className="h-40 w-full" />
            )}
          </CardContent>
        </Card>

        <Card
          className="opacity-95"
          title={
            "PLACEHOLDER — not wired. Undocumented; distinct from Project " +
            "Dispensation Overview (budget/distributed, which IS live). " +
            "Need from Logan: what 'allocation' means — planned per-project " +
            "comp pools, how a contributor's payroll splits across the " +
            "projects they worked, or the comp-spec's 'shared allocation " +
            "pool' — and the data source (no per-project allocation is " +
            "modeled today)."
          }
        >
          <CardHeader>
            <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-2">
              Project Compensation Allocation <MockBadge />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="text-sm space-y-1.5">
              <li className="flex justify-between"><span>Mona Kea — Hawaii</span><span className="tabular-nums">$8,420</span></li>
              <li className="flex justify-between"><span>Quandary — Colorado</span><span className="tabular-nums">$5,210</span></li>
              <li className="flex justify-between"><span>Bali Names</span><span className="tabular-nums">$3,120</span></li>
              <li className="flex justify-between"><span>Chile MR Tasks</span><span className="tabular-nums">$2,489</span></li>
              <li className="flex justify-between text-muted-foreground"><span>Other</span><span className="tabular-nums">$3,150</span></li>
            </ul>
          </CardContent>
        </Card>

        <Card
          className="opacity-95"
          title={
            "PLACEHOLDER — not wired. Mockup shows an activity feed AND an " +
            "'Add note' button. Need from Logan: is it (a) an auto audit " +
            "feed from existing payroll audit fields (adjustment + status " +
            "changes — buildable now, no comms dep), (b) a manual cycle " +
            "notepad (needs a new persisted notes model), or (c) both — " +
            "and whether it should tie into the comms platform. Activity " +
            "data exists; a notes model does not."
          }
        >
          <CardHeader>
            <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-2">
              Operational Notes <MockBadge />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="text-sm space-y-2">
              <li>
                <div className="text-xs text-muted-foreground">2 hours ago</div>
                <div>Aaron approved 12 rows for Mona Kea</div>
              </li>
              <li>
                <div className="text-xs text-muted-foreground">Yesterday</div>
                <div>Logan added $139 reimbursement for travel</div>
              </li>
              <li>
                <div className="text-xs text-muted-foreground">3 days ago</div>
                <div>April cycle closed — $18,432 disbursed</div>
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* Hold-reason modal */}
      <Modal
        isOpen={!!holdTarget}
        onClose={() => setHoldTarget(null)}
        title={holdTarget ? `Hold ${holdTarget.name}` : ""}
        footer={
          <>
            <Button variant="outline" onClick={() => setHoldTarget(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={onConfirmHold}>
              Confirm hold
            </Button>
          </>
        }
      >
        <Input
          label="Reason"
          value={holdNote}
          onChange={(e) => setHoldNote(e.target.value)}
          placeholder="Waiting on receipt, pay-period mismatch, etc."
        />
      </Modal>

      <CycleConfigModal
        isOpen={showCycleConfig}
        onClose={() => setShowCycleConfig(false)}
        onSaved={() => {
          reload();
          reloadForecast();
        }}
      />
    </div>
  );
}

// ─── KPI card with trend chip ──────────────────────────────────────

interface KpiCardProps {
  label: string;
  // Accepts FormattedValue from formatCurrency/formatNumber, a literal
  // string (mock cards), or null while loading. Mirrors how Val/StatCard
  // type their `value`/`children` props after the lib/utils refactor.
  value: FormattedValue | string | null;
  subtitle: string;
  mock?: boolean;
  /** Native hover tooltip (e.g. "what we still need from Logan"). */
  tooltip?: string;
  trend?: {
    dir: "up" | "down" | "flat";
    text: string;
    mock?: boolean;
  };
}

function KpiCard({ label, value, subtitle, mock, tooltip, trend }: KpiCardProps) {
  const trendColor =
    trend?.dir === "up"
      ? "text-green-600 dark:text-green-400 bg-green-100/60 dark:bg-green-900/30"
      : trend?.dir === "down"
        ? "text-red-600 dark:text-red-400 bg-red-100/60 dark:bg-red-900/30"
        : "text-muted-foreground bg-muted/50";
  const trendArrow =
    trend?.dir === "up" ? "↑" : trend?.dir === "down" ? "↓" : "→";
  // Extract plain text for the native tooltip + the mock render path.
  // <Val> already handles both shapes for the live path.
  const valueText =
    value == null ? undefined : typeof value === "string" ? value : value.text;
  return (
    <Card className={mock ? "opacity-95" : ""} title={tooltip}>
      <CardHeader className="pb-1">
        <CardTitle className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1 truncate">
          <span className="truncate">{label}</span> {mock && <MockBadge />}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <div className="text-lg font-bold tabular-nums truncate" title={valueText}>
          {value !== null ? (
            mock ? (
              valueText
            ) : (
              <Val>{value}</Val>
            )
          ) : (
            <Skeleton className="h-6 w-20" />
          )}
        </div>
        {trend && (
          <span
            className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${trendColor}`}
            title={trend.mock ? "Mock trend — wiring pending" : undefined}
          >
            {trendArrow} {trend.text}
          </span>
        )}
        <div className="text-[10px] text-muted-foreground truncate" title={subtitle}>
          {subtitle}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── stub widgets (MOCK DATA) ──────────────────────────────────────

function MockBadge() {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
      Mock
    </span>
  );
}

function StatusDonut({
  segments,
}: {
  segments: { label: string; value: number; color: string }[];
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  let cum = 0;
  const radius = 48;
  const strokeWidth = 18;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="-60 -60 120 120" className="w-32 h-32 -rotate-90">
        <circle r={radius} fill="none" stroke="currentColor" className="text-muted/30" strokeWidth={strokeWidth} />
        {segments.map((s) => {
          const len = total > 0 ? (s.value / total) * circumference : 0;
          const offset = -cum;
          cum += len;
          return (
            <circle
              key={s.label}
              r={radius}
              fill="none"
              stroke={s.color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${len} ${circumference - len}`}
              strokeDashoffset={offset}
            />
          );
        })}
        {/* svg is CSS -rotate-90; this single SVG-space +90 counter-
            rotation about (0,0) puts the number upright (no extra CSS
            rotate class — that double-rotated it to vertical). */}
        <text
          x="0"
          y="0"
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-foreground text-xl font-bold"
          transform="rotate(90)"
        >
          {total}
        </text>
      </svg>
      <ul className="text-xs space-y-1 flex-1">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
              {s.label}
            </span>
            <span className="tabular-nums text-muted-foreground">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
