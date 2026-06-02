"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  useToastActions,
  Val,
} from "@/components/ui";
import {
  useSaveWeeklyReport,
  useFetchWeeklyDraft,
  useFetchWeeklyDrafts,
  useDeleteWeeklyDraft,
  useFetchTimekeepingStats,
  useFetchElementAnalysis,
  useOrgProjects,
  useFetchTeams,
  useSyncCommunitySheet,
  useFetchCommunityEntries,
} from "@/hooks/useApi";
import {
  dateInputToLocalStartIsoUtc,
  dateInputToLocalEndIsoUtc,
  formatDateRangeShort,
} from "@/lib/timeTracking";
import type {
  TimekeepingStatsResponse,
  ElementAnalysisCategory,
  WeeklyReportDraft,
  CommunityEntry,
} from "@/types";
import {
  BarChart,
  Bar,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { formatNumber } from "@/lib/utils";
// Shared color palette — both this page and /reports/page.tsx
// import from the same module so future palette tweaks stay in sync.
import { COLORS, WEEKLY_TASK_COLORS } from "@/lib/chartColors";

// ─── Types ───────────────────────────────────────────────────

type SectionType =
  | "cover"
  | "summary"
  | "team_activity_charts"
  | "primary_activity"
  | "element_analysis"
  | "active_projects"
  | "community_outreach"
  | "community_discussions"
  | "investigations"
  | "drive_project";

interface ReportSection {
  type: SectionType;
  enabled: boolean;
  label: string;
  data: Record<string, unknown>;
  autoPopulated: boolean;
  placeholder?: boolean;
}

interface ManualTableRow {
  [key: string]: string;
}

// ─── Section Defaults ────────────────────────────────────────

function getDefaultSections(): ReportSection[] {
  return [
    {
      type: "cover",
      enabled: true,
      label: "1. Cover Page",
      autoPopulated: false,
      data: { teamName: "In-Country Editing Team" },
    },
    {
      type: "summary",
      enabled: true,
      label: "2. Summary",
      autoPopulated: false,
      data: { content: "" },
    },
    {
      type: "team_activity_charts",
      enabled: true,
      label: "3. Team Activity Charts",
      autoPopulated: true,
      data: {},
    },
    {
      type: "primary_activity",
      enabled: true,
      label: "4. Primary Activity",
      autoPopulated: false,
      data: { management: "", qcRegionalLead: "" },
    },
    {
      type: "element_analysis",
      enabled: true,
      label: "5. Element Analysis",
      autoPopulated: true,
      data: {},
    },
    {
      type: "active_projects",
      enabled: true,
      label: "6. Active Projects",
      autoPopulated: true,
      data: { impact: "", statusNotes: "" },
    },
    {
      type: "community_outreach",
      enabled: true,
      label: "7. Community Outreach",
      autoPopulated: false,
      placeholder: true,
      data: { rows: [] },
    },
    {
      type: "community_discussions",
      enabled: true,
      label: "8. Community Discussions",
      autoPopulated: false,
      placeholder: true,
      data: { rows: [] },
    },
    {
      type: "investigations",
      enabled: true,
      label: "9. Investigations",
      autoPopulated: false,
      placeholder: true,
      data: { rows: [] },
    },
    {
      type: "drive_project",
      enabled: false,
      label: "10. Drive Project",
      autoPopulated: false,
      placeholder: true,
      data: { summary: "", rows: [] },
    },
  ];
}

// ─── Helper: format date to YYYY-MM-DD ───────────────────────

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ─── Mini Chart Components ───────────────────────────────────

function MiniActivityChart({
  title,
  data,
}: {
  title: string;
  data: { day: string; deleted: number; added: number; modified: number }[];
}) {
  return (
    <Card>
      <CardContent className="p-3">
        <p className="text-xs font-semibold text-foreground mb-2">
          Team Activity: {title}
        </p>
        <div style={{ width: "100%", height: 140 }}>
          <ResponsiveContainer>
            <BarChart data={data} barSize={12}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 9 }} width={35} />
              <Tooltip contentStyle={{ fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 9 }} iconSize={8} />
              <Bar
                dataKey="deleted"
                name="Deleted"
                fill={COLORS.deleted}
                stackId="a"
              />
              <Bar
                dataKey="added"
                name="Added"
                fill={COLORS.added}
                stackId="a"
              />
              <Bar
                dataKey="modified"
                name="Modified"
                fill={COLORS.modified}
                stackId="a"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Editable Table Component ────────────────────────────────

function EditableTable({
  columns,
  rows,
  onChange,
}: {
  columns: { key: string; label: string }[];
  rows: ManualTableRow[];
  onChange: (rows: ManualTableRow[]) => void;
}) {
  const addRow = () => {
    const empty: ManualTableRow = {};
    columns.forEach((c) => (empty[c.key] = ""));
    onChange([...rows, empty]);
  };

  const updateCell = (rowIdx: number, key: string, value: string) => {
    const updated = rows.map((r, i) =>
      i === rowIdx ? { ...r, [key]: value } : r,
    );
    onChange(updated);
  };

  const removeRow = (rowIdx: number) => {
    onChange(rows.filter((_, i) => i !== rowIdx));
  };

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className="border border-border px-2 py-1 text-left text-xs font-medium text-muted-foreground bg-muted"
                >
                  {c.label}
                </th>
              ))}
              <th className="border border-border px-2 py-1 w-10 bg-muted" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIdx) => (
              <tr key={rowIdx}>
                {columns.map((c) => (
                  <td key={c.key} className="border border-border p-0">
                    <input
                      type="text"
                      value={row[c.key] || ""}
                      onChange={(e) =>
                        updateCell(rowIdx, c.key, e.target.value)
                      }
                      className="w-full px-2 py-1 text-sm bg-transparent border-0 focus:outline-none focus:ring-1 focus:ring-kaart-orange"
                    />
                  </td>
                ))}
                <td className="border border-border px-1 text-center">
                  <button
                    onClick={() => removeRow(rowIdx)}
                    className="text-red-500 hover:text-red-700 text-xs"
                    title="Remove row"
                  >
                    x
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        onClick={addRow}
        className="mt-2 text-xs text-kaart-orange hover:underline"
      >
        + Add Row
      </button>
    </div>
  );
}

// ─── Section Toggle Header ───────────────────────────────────

function SectionHeader({
  section,
  onToggle,
  collapsed,
  onCollapseToggle,
}: {
  section: ReportSection;
  onToggle: () => void;
  collapsed: boolean;
  onCollapseToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <button
          onClick={onCollapseToggle}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          {collapsed ? "\u25B6" : "\u25BC"}
        </button>
        <h3 className="text-sm font-semibold">{section.label}</h3>
        {section.autoPopulated && (
          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">
            Auto
          </span>
        )}
        {section.placeholder && (
          <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded">
            Coming Soon
          </span>
        )}
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <span className="text-xs text-muted-foreground">
          {section.enabled ? "Included" : "Excluded"}
        </span>
        <div
          onClick={onToggle}
          className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer ${
            section.enabled ? "bg-kaart-orange" : "bg-muted"
          }`}
        >
          <div
            className={`w-4 h-4 rounded-full bg-white shadow absolute top-0.5 transition-transform ${
              section.enabled ? "translate-x-4" : "translate-x-0.5"
            }`}
          />
        </div>
      </label>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────

export function AdminReportsWeekly() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToastActions();

  // Date defaults: last 7 days
  const defaultEnd = new Date();
  const defaultStart = new Date();
  defaultStart.setDate(defaultStart.getDate() - 7);

  const [title, setTitle] = useState("Weekly Report");
  const [startDate, setStartDate] = useState(toDateStr(defaultStart));
  const [endDate, setEndDate] = useState(toDateStr(defaultEnd));
  const [sections, setSections] =
    useState<ReportSection[]>(getDefaultSections());
  const [collapsedSections, setCollapsedSections] = useState<Set<SectionType>>(
    new Set(),
  );
  const [draftId, setDraftId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [showDraftsList, setShowDraftsList] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [compareEnabled, setCompareEnabled] = useState(false);

  // API hooks
  const { mutate: saveDraft } = useSaveWeeklyReport();
  const { mutate: fetchDraft } = useFetchWeeklyDraft();
  const { mutate: deleteDraft } = useDeleteWeeklyDraft();
  const { data: draftsData, refetch: refetchDrafts } = useFetchWeeklyDrafts();

  // Data hooks for auto-populated sections
  const { mutate: fetchTimekeeping, loading: tkLoading } =
    useFetchTimekeepingStats();
  const { mutate: fetchElements, loading: elemLoading } =
    useFetchElementAnalysis();
  const { data: projectsData } = useOrgProjects();
  const { data: teamsData } = useFetchTeams();
  const { mutate: syncSheet, loading: syncLoading } = useSyncCommunitySheet();
  const { mutate: fetchCommunityEntries } = useFetchCommunityEntries();

  // Auto-fetched data storage
  const [timekeepingData, setTimekeepingData] =
    useState<TimekeepingStatsResponse | null>(null);
  const [elementCategories, setElementCategories] = useState<
    ElementAnalysisCategory[]
  >([]);
  const [tkFetched, setTkFetched] = useState(false);
  const [elemFetched, setElemFetched] = useState(false);

  // ── Derive previous draft for comparison ──
  const prevDraft = draftsData?.drafts?.find((d) => d.id !== draftId) || null;

  // ── Fetch auto-populated data when date range or team changes ──
  const fetchAutoData = useCallback(async () => {
    setTkFetched(false);
    setElemFetched(false);

    // Convert the admin's picked calendar days (YYYY-MM-DD) to local-midnight
    // ISO UTC instants so the backend windows match their wall clock.
    const startIso = dateInputToLocalStartIsoUtc(startDate);
    const endIso = dateInputToLocalEndIsoUtc(endDate);
    try {
      const tkParams: Record<string, unknown> = {
        startDate: startIso,
        endDate: endIso,
      };
      if (selectedTeamId) tkParams.teamId = selectedTeamId;
      if (compareEnabled && prevDraft) {
        tkParams.compareStartDate = dateInputToLocalStartIsoUtc(
          prevDraft.start_date,
        );
        tkParams.compareEndDate = dateInputToLocalEndIsoUtc(prevDraft.end_date);
      }
      const tkResult = await fetchTimekeeping(tkParams);
      setTimekeepingData(tkResult);
      setTkFetched(true);
    } catch {
      setTkFetched(true);
    }

    try {
      const elemParams: Record<string, unknown> = {
        startDate: startIso,
        endDate: endIso,
      };
      if (selectedTeamId) elemParams.teamIds = [selectedTeamId];
      const elemResult = await fetchElements(elemParams);
      setElementCategories(elemResult?.categories ?? []);
      setElemFetched(true);
    } catch {
      setElemFetched(true);
    }
  }, [
    startDate,
    endDate,
    selectedTeamId,
    compareEnabled,
    prevDraft,
    fetchTimekeeping,
    fetchElements,
  ]);

  useEffect(() => {
    fetchAutoData();
  }, [fetchAutoData]);

  // ── Load draft from query param on mount ──
  useEffect(() => {
    const id = searchParams.get("id");
    if (id) {
      fetchDraft({ id: parseInt(id) })
        .then((result) => {
          if (result?.draft) {
            hydrateDraft(result.draft);
          }
        })
        .catch(() => {
          toast.error("Failed to load draft");
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Hydrate draft into state ──
  const hydrateDraft = (draft: WeeklyReportDraft) => {
    setDraftId(draft.id);
    setTitle(draft.title);
    setStartDate(draft.start_date);
    setEndDate(draft.end_date);
    try {
      const parsed = JSON.parse(draft.sections);
      // Support both old format (plain array) and new format (metadata + sections)
      let sectionData: ReportSection[] | null = null;
      if (parsed && parsed.metadata && parsed.sections) {
        // New format with metadata
        sectionData = parsed.sections;
        if (parsed.metadata.selectedTeamId !== undefined) {
          setSelectedTeamId(parsed.metadata.selectedTeamId);
        }
        if (parsed.metadata.compareEnabled !== undefined) {
          setCompareEnabled(parsed.metadata.compareEnabled);
        }
      } else if (Array.isArray(parsed)) {
        // Old format: plain array of sections
        sectionData = parsed;
      }
      if (sectionData && Array.isArray(sectionData)) {
        const defaults = getDefaultSections();
        const merged = defaults.map((def) => {
          const saved = sectionData!.find(
            (s: ReportSection) => s.type === def.type,
          );
          return saved ? { ...def, ...saved } : def;
        });
        setSections(merged);
      }
    } catch {
      // If sections can't be parsed, keep defaults
    }
  };

  // ── Save draft ──
  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await saveDraft({
        id: draftId,
        title,
        report_date: endDate,
        start_date: startDate,
        end_date: endDate,
        sections: JSON.stringify({
          metadata: { selectedTeamId, compareEnabled },
          sections,
        }),
      });
      if (result?.id) {
        setDraftId(result.id);
        toast.success("Draft saved");
        refetchDrafts();
      }
    } catch {
      toast.error("Failed to save draft");
    } finally {
      setSaving(false);
    }
  };

  // ── Delete draft ──
  const handleDelete = async (id: number) => {
    try {
      await deleteDraft({ id });
      toast.success("Draft deleted");
      refetchDrafts();
      if (id === draftId) {
        setDraftId(null);
        setTitle("Weekly Report");
        setSections(getDefaultSections());
      }
    } catch {
      toast.error("Failed to delete draft");
    }
  };

  // ── Pull community data from Google Sheet ──
  const handlePullCommunityData = async (
    sectionType:
      | "community_outreach"
      | "community_discussions"
      | "investigations",
  ) => {
    try {
      const result = await fetchCommunityEntries({
        startDate: dateInputToLocalStartIsoUtc(startDate),
        endDate: dateInputToLocalEndIsoUtc(endDate),
        entryType:
          sectionType === "community_outreach"
            ? "outreach"
            : sectionType === "community_discussions"
              ? "discussion"
              : "investigation",
      });
      if (result?.entries && result.entries.length > 0) {
        const rows = result.entries.map((entry: CommunityEntry) => {
          const data = entry.edited_data || entry.original_data;
          // Map sheet columns to table row format — use whatever keys exist
          const row: ManualTableRow = {};
          Object.entries(data).forEach(([key, value]) => {
            row[key] = value || "";
          });
          return row;
        });
        updateSection(sectionType, { rows });
        toast.success(`Pulled ${result.entries.length} entries from sheet`);
      } else {
        toast.info("No entries found for this date range");
      }
    } catch {
      toast.error("Failed to fetch community data");
    }
  };

  const handleSyncSheet = async () => {
    try {
      const result = await syncSheet({});
      if (result?.synced !== undefined) {
        toast.success(
          `Synced ${result.synced} new entries (${result.skipped} already imported)`,
        );
      }
    } catch {
      toast.error("Failed to sync from Google Sheet");
    }
  };

  // ── Section helpers ──
  const updateSection = (type: SectionType, data: Record<string, unknown>) => {
    setSections((prev) =>
      prev.map((s) =>
        s.type === type ? { ...s, data: { ...s.data, ...data } } : s,
      ),
    );
  };

  const toggleSection = (type: SectionType) => {
    setSections((prev) =>
      prev.map((s) => (s.type === type ? { ...s, enabled: !s.enabled } : s)),
    );
  };

  const toggleCollapse = (type: SectionType) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  // ── Derived data ──
  const activeProjects = projectsData?.org_active_projects || [];
  const inactiveProjects = projectsData?.org_inactive_projects || [];
  const weeklyActivity = timekeepingData?.weekly_activity || [];
  const weeklyCategoryHours = timekeepingData?.weekly_category_hours || [];
  const weeklyCategoryNames = timekeepingData?.weekly_category_names || [];

  // ── Render sections ──
  const renderSectionContent = (section: ReportSection) => {
    if (!section.enabled) return null;

    switch (section.type) {
      case "cover":
        return (
          <div className="space-y-3">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-kaart-orange rounded-lg flex items-center justify-center text-white font-bold text-xl">
                K
              </div>
              <div>
                <p className="text-lg font-bold">{title}</p>
                <p className="text-sm text-muted-foreground">
                  {startDate} to {endDate}
                </p>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Team Name</label>
              <input
                type="text"
                value={(section.data.teamName as string) || ""}
                onChange={(e) =>
                  updateSection("cover", { teamName: e.target.value })
                }
                className="w-full mt-1 px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-kaart-orange"
              />
            </div>
          </div>
        );

      case "summary":
        return (
          <div>
            <label className="text-xs text-muted-foreground">
              Summary (reimbursement notices, quarterly goals, atlas check
              updates)
            </label>
            <textarea
              value={(section.data.content as string) || ""}
              onChange={(e) =>
                updateSection("summary", { content: e.target.value })
              }
              rows={6}
              className="w-full mt-1 px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-kaart-orange resize-y"
              placeholder="Enter summary content..."
            />
          </div>
        );

      case "team_activity_charts": {
        const comparison = timekeepingData?.comparison?.summary;
        const currentSummary = timekeepingData?.summary;
        return (
          <div className="space-y-4">
            {/* Comparison summary stats */}
            {compareEnabled && comparison && currentSummary && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  {
                    label: "Total Hours",
                    current: currentSummary.total_hours,
                    prior: comparison.total_hours,
                  },
                  {
                    label: "Changesets",
                    current: currentSummary.total_changesets,
                    prior: comparison.total_changesets,
                  },
                  {
                    label: "Changes",
                    current: currentSummary.total_changes,
                    prior: comparison.total_changes,
                  },
                  {
                    label: "Active Users",
                    current: currentSummary.active_users,
                    prior: comparison.active_users,
                  },
                ].map(({ label, current, prior }) => {
                  const delta =
                    prior > 0 ? ((current - prior) / prior) * 100 : null;
                  return (
                    <div
                      key={label}
                      className="border border-border rounded-lg p-3 text-center"
                    >
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="text-lg font-bold">
                        {typeof current === "number" ? (
                          <Val>
                            {formatNumber(Math.round(current * 10) / 10)}
                          </Val>
                        ) : (
                          current
                        )}
                      </p>
                      {delta !== null && (
                        <p
                          className={`text-xs font-medium ${delta >= 0 ? "text-green-600" : "text-red-600"}`}
                        >
                          {delta >= 0 ? "\u25B2" : "\u25BC"}{" "}
                          {Math.abs(delta).toFixed(1)}% vs prior
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {tkLoading && !tkFetched ? (
              <div className="flex items-center justify-center h-32">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-kaart-orange" />
              </div>
            ) : (
              <>
                {/* Weekly Team Activity */}
                {weeklyActivity.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold mb-2">
                      Weekly Team Activity
                    </p>
                    <div style={{ width: "100%", height: 250 }}>
                      <ResponsiveContainer>
                        <ComposedChart data={weeklyActivity}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="week" tick={{ fontSize: 10 }} />
                          <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
                          <YAxis
                            yAxisId="right"
                            orientation="right"
                            tick={{ fontSize: 10 }}
                          />
                          <Tooltip contentStyle={{ fontSize: 11 }} />
                          <Legend wrapperStyle={{ fontSize: 10 }} />
                          <Bar
                            yAxisId="left"
                            dataKey="hours"
                            name="Hours"
                            fill={COLORS.hours}
                            barSize={20}
                          />
                          <Line
                            yAxisId="right"
                            type="monotone"
                            dataKey="changes_per_hour"
                            name="Changes/Hr"
                            stroke={COLORS.mapped}
                            strokeWidth={2}
                            dot={false}
                          />
                          <Line
                            yAxisId="right"
                            type="monotone"
                            dataKey="changes_per_changeset"
                            name="Changes/Changeset"
                            stroke={COLORS.validated}
                            strokeWidth={2}
                            dot={false}
                          />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {/* Weekly Task Hours */}
                {weeklyCategoryHours.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold mb-2">
                      Weekly Task Hours
                    </p>
                    <div style={{ width: "100%", height: 250 }}>
                      <ResponsiveContainer>
                        <BarChart data={weeklyCategoryHours}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="week" tick={{ fontSize: 10 }} />
                          <YAxis tick={{ fontSize: 10 }} />
                          <Tooltip contentStyle={{ fontSize: 11 }} />
                          <Legend wrapperStyle={{ fontSize: 10 }} />
                          {weeklyCategoryNames.map((name, i) => (
                            <Bar
                              key={name}
                              dataKey={name}
                              name={name}
                              fill={
                                WEEKLY_TASK_COLORS[
                                  i % WEEKLY_TASK_COLORS.length
                                ]
                              }
                              stackId="a"
                            />
                          ))}
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {/* Community Outreach Trends placeholder */}
                <div className="border border-dashed border-yellow-400 rounded-lg p-4 bg-yellow-50/50">
                  <p className="text-xs font-semibold text-yellow-700">
                    Community Outreach Trends
                  </p>
                  <p className="text-xs text-yellow-600 mt-1">
                    Community data not yet available in Mikro
                  </p>
                </div>

                {weeklyActivity.length === 0 &&
                  weeklyCategoryHours.length === 0 &&
                  tkFetched && (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No timekeeping data for this date range
                    </p>
                  )}
              </>
            )}
          </div>
        );
      }

      case "primary_activity":
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-muted-foreground">
                Management Activity
              </label>
              <textarea
                value={(section.data.management as string) || ""}
                onChange={(e) =>
                  updateSection("primary_activity", {
                    management: e.target.value,
                  })
                }
                rows={5}
                className="w-full mt-1 px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-kaart-orange resize-y"
                placeholder="Enter management activity..."
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">
                QC / Regional Lead Activity
              </label>
              <textarea
                value={(section.data.qcRegionalLead as string) || ""}
                onChange={(e) =>
                  updateSection("primary_activity", {
                    qcRegionalLead: e.target.value,
                  })
                }
                rows={5}
                className="w-full mt-1 px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-kaart-orange resize-y"
                placeholder="Enter QC / Regional Lead activity..."
              />
            </div>
          </div>
        );

      case "element_analysis":
        return (
          <div>
            {elemLoading && !elemFetched ? (
              <div className="flex items-center justify-center h-32">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-kaart-orange" />
              </div>
            ) : elementCategories.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {elementCategories
                  .filter((c) => c.type === "standard")
                  .map((cat) => (
                    <MiniActivityChart
                      key={cat.title}
                      title={cat.title}
                      data={
                        cat.data as {
                          day: string;
                          deleted: number;
                          added: number;
                          modified: number;
                        }[]
                      }
                    />
                  ))}
              </div>
            ) : elemFetched ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No element analysis data for this date range
              </p>
            ) : null}
          </div>
        );

      case "active_projects":
        return (
          <div className="space-y-4">
            {/* Project summary */}
            <div className="flex gap-4 text-sm">
              <span>
                <strong>{activeProjects.length}</strong> active
              </span>
              <span>
                <strong>{inactiveProjects.length}</strong> inactive/completed
              </span>
            </div>

            {/* Project list */}
            {activeProjects.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr>
                      <th className="border border-border px-2 py-1 text-left text-xs font-medium text-muted-foreground bg-muted">
                        Project
                      </th>
                      <th className="border border-border px-2 py-1 text-center text-xs font-medium text-muted-foreground bg-muted">
                        Tasks
                      </th>
                      <th className="border border-border px-2 py-1 text-center text-xs font-medium text-muted-foreground bg-muted">
                        % Mapped
                      </th>
                      <th className="border border-border px-2 py-1 text-center text-xs font-medium text-muted-foreground bg-muted">
                        % Validated
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeProjects.map((p) => {
                      const pctMapped = p.total_tasks
                        ? Math.min(
                            Math.round(
                              ((p.total_mapped || 0) / p.total_tasks) * 100,
                            ),
                            100,
                          )
                        : 0;
                      const pctValidated = p.total_tasks
                        ? Math.min(
                            Math.round(
                              ((p.total_validated || 0) / p.total_tasks) * 100,
                            ),
                            100,
                          )
                        : 0;
                      return (
                        <tr key={p.id}>
                          <td className="border border-border px-2 py-1">
                            <a
                              href={p.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline"
                            >
                              {p.name}
                            </a>
                          </td>
                          <td className="border border-border px-2 py-1 text-center">
                            <Val>{formatNumber(p.total_tasks)}</Val>
                          </td>
                          <td className="border border-border px-2 py-1 text-center">
                            {pctMapped}%
                          </td>
                          <td className="border border-border px-2 py-1 text-center">
                            {pctValidated}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Impact / notes */}
            <div>
              <label className="text-xs text-muted-foreground">
                Impact / Status Notes
              </label>
              <textarea
                value={(section.data.statusNotes as string) || ""}
                onChange={(e) =>
                  updateSection("active_projects", {
                    statusNotes: e.target.value,
                  })
                }
                rows={3}
                className="w-full mt-1 px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-kaart-orange resize-y"
                placeholder="Project impact notes..."
              />
            </div>
          </div>
        );

      case "community_outreach":
        return (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted-foreground">
                Location, User/Org, Event, Date, Status, Attendees, Notes
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSyncSheet}
                  disabled={syncLoading}
                  className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-700 hover:bg-blue-200 transition-colors disabled:opacity-50"
                >
                  {syncLoading ? "Syncing..." : "Sync Sheet"}
                </button>
                <button
                  onClick={() => handlePullCommunityData("community_outreach")}
                  className="text-xs px-2 py-1 rounded bg-green-100 text-green-700 hover:bg-green-200 transition-colors"
                >
                  Pull from Sheet
                </button>
              </div>
            </div>
            <EditableTable
              columns={[
                { key: "location", label: "Location" },
                { key: "userOrg", label: "User/Org" },
                { key: "event", label: "Event" },
                { key: "date", label: "Date" },
                { key: "status", label: "Status" },
                { key: "attendees", label: "Attendees" },
                { key: "notes", label: "Notes" },
              ]}
              rows={(section.data.rows as ManualTableRow[]) || []}
              onChange={(rows) => updateSection("community_outreach", { rows })}
            />
          </div>
        );

      case "community_discussions":
        return (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted-foreground">
                Location, User/Org, Interaction, Date, Channel/Link, Status, Key
                Participants, Notes
              </p>
              <button
                onClick={() => handlePullCommunityData("community_discussions")}
                className="text-xs px-2 py-1 rounded bg-green-100 text-green-700 hover:bg-green-200 transition-colors"
              >
                Pull from Sheet
              </button>
            </div>
            <EditableTable
              columns={[
                { key: "location", label: "Location" },
                { key: "userOrg", label: "User/Org" },
                { key: "interaction", label: "Interaction" },
                { key: "date", label: "Date" },
                { key: "channelLink", label: "Channel/Link" },
                { key: "status", label: "Status" },
                { key: "keyParticipants", label: "Key Participants" },
                { key: "notes", label: "Notes" },
              ]}
              rows={(section.data.rows as ManualTableRow[]) || []}
              onChange={(rows) =>
                updateSection("community_discussions", { rows })
              }
            />
          </div>
        );

      case "investigations":
        return (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted-foreground">Investigations</p>
              <button
                onClick={() => handlePullCommunityData("investigations")}
                className="text-xs px-2 py-1 rounded bg-green-100 text-green-700 hover:bg-green-200 transition-colors"
              >
                Pull from Sheet
              </button>
            </div>
            <EditableTable
              columns={[
                { key: "location", label: "Location" },
                { key: "userOrg", label: "User/Org" },
                { key: "interaction", label: "Interaction" },
                { key: "date", label: "Date" },
                { key: "channelLink", label: "Channel/Link" },
                { key: "status", label: "Status" },
                { key: "keyParticipants", label: "Key Participants" },
                { key: "notes", label: "Notes" },
              ]}
              rows={(section.data.rows as ManualTableRow[]) || []}
              onChange={(rows) => updateSection("investigations", { rows })}
            />
          </div>
        );

      case "drive_project":
        return (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Summary</label>
              <textarea
                value={(section.data.summary as string) || ""}
                onChange={(e) =>
                  updateSection("drive_project", { summary: e.target.value })
                }
                rows={3}
                className="w-full mt-1 px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-kaart-orange resize-y"
                placeholder="Drive project summary..."
              />
            </div>
            <EditableTable
              columns={[
                { key: "location", label: "Travel Location" },
                { key: "project", label: "Active Editing Project" },
                { key: "status", label: "Status" },
                { key: "notes", label: "Notes" },
              ]}
              rows={(section.data.rows as ManualTableRow[]) || []}
              onChange={(rows) => updateSection("drive_project", { rows })}
            />
          </div>
        );

      default:
        return null;
    }
  };

  // ── Render ─────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/reports")}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            &larr; Reports
          </button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Weekly Report Builder
            </h1>
            <p className="text-sm text-muted-foreground">
              {draftId ? `Draft #${draftId}` : "New Report"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowDraftsList(!showDraftsList)}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
          >
            {showDraftsList ? "Hide Drafts" : "Load Draft"}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 rounded-lg bg-kaart-orange text-white text-sm font-medium hover:bg-kaart-orange-dark transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Draft"}
          </button>
          <button
            disabled
            title="PDF export coming in Phase 2"
            className="px-4 py-1.5 rounded-lg bg-muted text-muted-foreground text-sm font-medium cursor-not-allowed opacity-50"
          >
            Export PDF
          </button>
        </div>
      </div>

      {/* Drafts List */}
      {showDraftsList && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Saved Drafts</CardTitle>
          </CardHeader>
          <CardContent>
            {draftsData?.drafts && draftsData.drafts.length > 0 ? (
              <div className="space-y-2">
                {draftsData.drafts.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center justify-between p-2 rounded-lg border border-border hover:bg-muted/50"
                  >
                    <div>
                      <p className="text-sm font-medium">{d.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {d.start_date} to {d.end_date} &middot; Updated{" "}
                        <Val>
                          {d.updated_at
                            ? new Date(d.updated_at).toLocaleDateString()
                            : null}
                        </Val>
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          hydrateDraft(d);
                          setShowDraftsList(false);
                          toast.success("Draft loaded");
                        }}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        Load
                      </button>
                      <button
                        onClick={() => handleDelete(d.id)}
                        className="text-xs text-red-500 hover:underline"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No saved drafts</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Controls */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-48">
              <label className="text-xs text-muted-foreground">
                Report Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full mt-1 px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-kaart-orange"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">
                Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full mt-1 px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-kaart-orange"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full mt-1 px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-kaart-orange"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Team</label>
              <select
                value={selectedTeamId ?? ""}
                onChange={(e) =>
                  setSelectedTeamId(
                    e.target.value ? Number(e.target.value) : null,
                  )
                }
                className="w-full mt-1 px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-kaart-orange"
              >
                <option value="">All Teams</option>
                {teamsData?.teams?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={fetchAutoData}
              disabled={tkLoading || elemLoading}
              className="px-3 py-1.5 rounded-lg bg-muted text-sm font-medium hover:bg-muted/80 transition-colors disabled:opacity-50"
            >
              {tkLoading || elemLoading ? "Fetching..." : "Refresh Data"}
            </button>
          </div>
          {/* Resolved-range caption — explicit statement of the date
              window the report covers. Mirrors the caption on
              /time and /reports for consistency. */}
          {(() => {
            const range = formatDateRangeShort(startDate, endDate, {
              emptyLabel: "",
            });
            if (!range) return null;
            return (
              <div className="text-xs text-muted-foreground">
                Report covers{" "}
                <span className="font-medium text-foreground">{range}</span>
              </div>
            );
          })()}
          {/* Compare to last report toggle */}
          {prevDraft && (
            <div className="flex items-center gap-2 pt-1 border-t border-border">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={compareEnabled}
                  onChange={(e) => setCompareEnabled(e.target.checked)}
                  className="rounded border-border"
                />
                <span className="text-xs text-muted-foreground">
                  Compare to last report: <strong>{prevDraft.title}</strong> (
                  {prevDraft.start_date} to {prevDraft.end_date})
                </span>
              </label>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sections */}
      {sections.map((section) => (
        <Card key={section.type}>
          <CardContent className="p-4 space-y-3">
            <SectionHeader
              section={section}
              onToggle={() => toggleSection(section.type)}
              collapsed={collapsedSections.has(section.type)}
              onCollapseToggle={() => toggleCollapse(section.type)}
            />
            {!collapsedSections.has(section.type) && section.enabled && (
              <div className="pt-2 border-t border-border">
                {renderSectionContent(section)}
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      {/* Bottom bar */}
      <div className="flex justify-end gap-2 pb-8">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-kaart-orange text-white text-sm font-medium hover:bg-kaart-orange-dark transition-colors disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Draft"}
        </button>
        <button
          disabled
          title="PDF export coming in Phase 2"
          className="px-4 py-2 rounded-lg bg-muted text-muted-foreground text-sm font-medium cursor-not-allowed opacity-50"
        >
          Export PDF
        </button>
      </div>
    </div>
  );
}
