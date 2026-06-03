"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Modal,
  Input,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  useToastActions,
  Val,
} from "@/components/ui";
import { KpiCard } from "@/components/ui/KpiCard";
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
import { isAnyAdmin } from "@/types";
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
import { CycleConfigModal } from "@/components/admin/payments/CycleConfigModal";
import {
  ReimbursementsAdminPanel,
  ReimbursementsAdminSummary,
} from "@/components/admin/payments/ReimbursementsAdmin";
import type {
  PayrollForecastResponse,
  ProjectDispensationResponse,
} from "@/types";
import { CyclePicker } from "@/components/admin/payments/CyclePicker";

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

export function AdminPayments() {
  const toast = useToastActions();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const activeTab: "payments" | "reimbursements" =
    searchParams?.get("tab") === "reimbursements"
      ? "reimbursements"
      : "payments";
  const setActiveTab = (next: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (next === "payments") {
      params.delete("tab");
    } else {
      params.set("tab", next);
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };
  const { role: viewerRole } = useCurrentUserRole();
  const canEdit = isAnyAdmin(viewerRole);

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

  const [filterRegionId, setFilterRegionId] = useState<string | null>(null);
  const [filterCountryId, setFilterCountryId] = useState<string | null>(null);
  const [filterTeamId, setFilterTeamId] = useState<string | null>(null);
  const [filterRole, setFilterRole] = useState<string | null>(null);
  const [filterTimezone, setFilterTimezone] = useState<string | null>(null);
  const [filterComp, setFilterComp] = useState<string | null>(null);
  const [showCycleConfig, setShowCycleConfig] = useState(false);
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

  useEffect(() => {
    setPage(1);
  }, [filter, search, cycleStart, cycleEnd, filtersBody]);

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
  const onResetPending = (row: PaymentCycleRow) => setRowStatus(row, "pending");

  const onExport = async () => {
    try {
      await exportCsv(cycleStart, cycleEnd, filtersBody);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    }
  };

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

  const filteredRows = rows.filter((r) => {
    if (filter === "hourly" && r.compensation_model !== "hourly") return false;
    if (filter === "salaried" && r.compensation_model !== "salaried")
      return false;
    if (filter === "project" && r.compensation_model !== "project_based")
      return false;
    if (filter === "hybrid" && r.compensation_model !== "hybrid") return false;
    if (filter === "on_hold" && r.status !== "held") return false;
    if (
      filter === "info_needed" &&
      ((r.hourly_rate ?? 0) > 0 || (r.monthly_salary ?? 0) > 0)
    )
      return false;

    if (search) {
      const q = search.toLowerCase();
      const hay =
        `${r.name} ${r.osm_username ?? ""} ${r.email ?? ""}`.toLowerCase();
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
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          defaultValue="payments"
        >
          <TabsList>
            <TabsTrigger value="payments">Payments</TabsTrigger>
            <TabsTrigger value="reimbursements">Reimbursements</TabsTrigger>
          </TabsList>
        </Tabs>
        <CyclePicker
          cycleStart={cycleStart}
          cycleEnd={cycleEnd}
          onChange={(s, e) => {
            setCycleStart(s);
            setCycleEnd(e);
          }}
        />
      </div>

      {activeTab === "reimbursements" ? (
        <ReimbursementsAdminPanel />
      ) : (
        <>
          <Card>
            <CardContent className="py-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-44">
                  <StandaloneFilter
                    label="Region"
                    allLabel="All regions"
                    options={(filterOptions?.dimensions?.region ?? []).map(
                      (v) =>
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
                    options={(filterOptions?.dimensions?.country ?? []).map(
                      (v) =>
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
                          ? {
                              value: v,
                              label: v.charAt(0).toUpperCase() + v.slice(1),
                            }
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
                    options={(filterOptions?.dimensions?.timezone ?? []).map(
                      (v) =>
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

          <div className="flex flex-row gap-4 justify-between overflow-x-auto py-2">
            <KpiCard
              label="Total Payable"
              className="w-44"
              value={kpis ? formatCurrency(kpis.total_payable) : null}
              subtitle="All rows this cycle"
              trend={{ dir: "up", text: "+12%" }}
            />
            <KpiCard
              label="Pending Payment"
              className="w-44"
              value={formatCurrency(pendingTotal)}
              subtitle={kpis ? `${kpis.pending_count} awaiting review` : "—"}
              trend={{ dir: "flat", text: `${kpis?.pending_count ?? 0} rows` }}
            />
            <KpiCard
              label="On Hold"
              className="w-44"
              value={formatCurrency(heldTotal)}
              subtitle={kpis ? `${kpis.held_count} blocked` : "—"}
              trend={{
                dir: kpis && kpis.held_count > 0 ? "down" : "flat",
                text: `${kpis?.held_count ?? 0} rows`,
              }}
            />
            <KpiCard
              label="Active Contributors"
              className="w-44"
              value={formatNumber(activeContributors)}
              subtitle="With hours this cycle"
              trend={{ dir: "up", text: `of ${rows.length}` }}
            />
            <KpiCard
              label="Avg. Payout"
              className="w-44"
              value={formatCurrency(avgPayout)}
              subtitle="Per active contributor"
              trend={{ dir: "flat", text: "this cycle" }}
            />
            <KpiCard
              label="Avg. Hourly Rate"
              className="w-44"
              value={formatCurrency(avgHourlyRate)}
              subtitle={`${ratedRows.length} rated users`}
              trend={{ dir: "flat", text: "current" }}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
                Pending Payments This Cycle
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                {(
                  [
                    { id: "all", label: "All" },
                    { id: "hourly", label: "Hourly" },
                    { id: "salaried", label: "Salaried" },
                    { id: "project", label: "Project-based" },
                    { id: "hybrid", label: "Hybrid" },
                    { id: "on_hold", label: "On Hold" },
                    { id: "info_needed", label: "Info Needed" },
                  ] as { id: TableFilter; label: string }[]
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
                  >
                    {chip.label}
                  </button>
                ))}
              </div>

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
                  Showing{" "}
                  {filteredRows.length === 0
                    ? 0
                    : (safePage - 1) * pageSize + 1}{" "}
                  to {Math.min(safePage * pageSize, filteredRows.length)} of{" "}
                  {filteredRows.length} contributors
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
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(
                    (p) => (
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
                    ),
                  )}
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
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
                Selected Contributor Detail
                <span className="ml-2 text-[10px] normal-case tracking-normal text-muted-foreground/70 italic">
                  (shows details for the row selected in the table above —
                  section title added for clarity; the mockup has no header
                  here)
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
        </>
      )}
    </div>
  );
}
