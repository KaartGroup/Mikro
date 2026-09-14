"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Input,
} from "@/components/ui";
import { formatNumber } from "@/lib/utils";
import {
  exportElementAsImage,
  todayIso,
  type ChartImageFormat,
} from "@/lib/chartExport";
import {
  useFetchBurndown,
  useRecalculateBurndownRate,
  useApplyBurndownRate,
  type BurndownChartData,
  type BurndownPriority,
} from "@/hooks/useApi";

interface BurndownChartProps {
  priority: BurndownPriority;
}

type ApplicableSource = "historical_average" | "manual";

function fmtDate(date: string) {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function sourceLabel(source: BurndownChartData["appliedRateSource"]) {
  if (source === "historical_average") return "Historical Average";
  if (source === "manual") return "Manual";
  return "Default — insufficient data";
}

/** Merge the planned/actual series into one date-keyed dataset for recharts. */
function mergeSeries(chart: BurndownChartData) {
  const byDate = new Map<
    string,
    { date: string; actual?: number; planned?: number }
  >();
  for (const point of chart.actualSeries) {
    byDate.set(point.date, {
      ...(byDate.get(point.date) ?? { date: point.date }),
      actual: point.remaining,
    });
  }
  for (const point of chart.plannedSeries) {
    byDate.set(point.date, {
      ...(byDate.get(point.date) ?? { date: point.date }),
      planned: point.remaining,
    });
  }
  return Array.from(byDate.values()).sort((a, b) =>
    a.date.localeCompare(b.date),
  );
}

export function BurndownChart({ priority }: BurndownChartProps) {
  const { mutate: fetchBurndown } = useFetchBurndown();
  const { mutate: recalculateRate, loading: recalculating } =
    useRecalculateBurndownRate();
  const { mutate: applyRate, loading: applying } = useApplyBurndownRate();

  const cardRef = useRef<HTMLDivElement>(null);
  // Only the chart + stat strip get captured for image export — the rate
  // controls and the download button itself are UI chrome, not report
  // content, and shouldn't end up baked into the picture.
  const captureRef = useRef<HTMLDivElement>(null);
  const downloadMenuRef = useRef<HTMLDivElement>(null);

  const [chart, setChart] = useState<BurndownChartData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<ChartImageFormat | null>(null);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);

  const [manualRateInput, setManualRateInput] = useState("");
  const [pendingSource, setPendingSource] =
    useState<ApplicableSource>("manual");
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchBurndown({})
      .then((res) => {
        if (cancelled) return;
        const found = res?.charts?.find((c) => c.priority === priority) ?? null;
        setChart(found);
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(
            err instanceof Error ? err.message : "Failed to load burndown data",
          );
        }
      });
    return () => {
      cancelled = true;
    };
    // fetchBurndown is a non-stable mutation hook; run once per block instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priority]);

  // Seed the editable fields from the server once, on first load. After that
  // the user's in-progress edits/toggle choice are authoritative until they
  // hit Apply — a background Recalculate must never clobber them.
  useEffect(() => {
    if (chart && !initialized) {
      setManualRateInput(String(chart.manualRate ?? 300));
      setPendingSource(
        chart.appliedRateSource === "historical_average"
          ? "historical_average"
          : "manual",
      );
      setInitialized(true);
    }
  }, [chart, initialized]);

  const data = useMemo(() => (chart ? mergeSeries(chart) : []), [chart]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        downloadMenuRef.current &&
        !downloadMenuRef.current.contains(e.target as Node)
      ) {
        setDownloadMenuOpen(false);
      }
    }
    if (downloadMenuOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [downloadMenuOpen]);

  const handleRecalculate = async () => {
    setActionError(null);
    try {
      const res = await recalculateRate({ priority });
      if (res?.chart) setChart(res.chart);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to recalculate rate",
      );
    }
  };

  const handleApply = async () => {
    setActionError(null);
    const body: Record<string, unknown> = { priority, source: pendingSource };
    if (pendingSource === "manual") {
      const parsed = parseFloat(manualRateInput);
      if (Number.isNaN(parsed) || parsed < 0) {
        setActionError("Enter a manual rate of 0 or greater.");
        return;
      }
      body.manualRate = parsed;
    }
    try {
      const res = await applyRate(body);
      if (res?.chart) setChart(res.chart);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to apply rate",
      );
    }
  };

  const handleDownload = async (format: ChartImageFormat) => {
    setDownloadMenuOpen(false);
    if (!captureRef.current) return;
    setExportError(null);
    setExporting(format);
    try {
      const ext = format === "jpeg" ? "jpg" : "png";
      await exportElementAsImage(
        captureRef.current,
        format,
        `${priority.toLowerCase()}-priority-burndown-${todayIso()}.${ext}`,
      );
    } catch (err) {
      setExportError(
        err instanceof Error ? err.message : "Failed to export chart image",
      );
    } finally {
      setExporting(null);
    }
  };

  if (loadError) {
    return (
      <Card data-chart-export={`${priority} Priority Burndown`}>
        <CardContent className="p-4">
          <p className="text-sm text-red-600">{loadError}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card ref={cardRef} data-chart-export={`${priority} Priority Burndown`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>{priority} Priority Burndown</CardTitle>
        {chart && (
          <div className="relative" ref={downloadMenuRef}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDownloadMenuOpen((v) => !v)}
              isLoading={exporting !== null}
              disabled={exporting !== null}
            >
              Download ▾
            </Button>
            {downloadMenuOpen && (
              <div className="absolute right-0 mt-1 w-36 rounded-lg border border-border bg-card shadow-lg z-50 overflow-hidden">
                <button
                  type="button"
                  onClick={() => handleDownload("png")}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors"
                >
                  PNG
                </button>
                <button
                  type="button"
                  onClick={() => handleDownload("jpeg")}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors"
                >
                  JPEG
                </button>
              </div>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {!chart ? (
          <div className="h-[220px] flex items-center justify-center">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-kaart-orange" />
          </div>
        ) : (
          <>
            {exportError && (
              <p className="text-sm text-red-600">{exportError}</p>
            )}
            <div ref={captureRef} className="space-y-4 bg-card">
              <div
                className="resize-y overflow-hidden rounded-md border border-dashed border-border"
                style={{
                  width: "100%",
                  height: 220,
                  minHeight: 160,
                  maxHeight: 640,
                }}
                title="Drag the bottom-right corner to resize"
              >
                <ResponsiveContainer>
                  <LineChart
                    data={data}
                    margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
                  >
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10 }}
                      tickFormatter={fmtDate}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v: number) => formatNumber(v).text}
                    />
                    <Tooltip
                      contentStyle={{ fontSize: 11, padding: "4px 8px" }}
                      labelFormatter={(label) => fmtDate(String(label))}
                      formatter={(v, name) => [
                        v == null ? "" : formatNumber(Number(v)).text,
                        name === "actual" ? "Actual" : "Planned",
                      ]}
                    />
                    <Legend
                      formatter={(name: string) =>
                        name === "actual" ? "Actual" : "Planned"
                      }
                    />
                    <Line
                      type="monotone"
                      dataKey="actual"
                      stroke="#f97316"
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                    />
                    <Line
                      type="monotone"
                      dataKey="planned"
                      stroke="#64748b"
                      strokeWidth={2}
                      strokeDasharray="4 4"
                      dot={false}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-border">
                <div className="flex flex-col">
                  <span className="text-[10px] text-muted-foreground leading-tight">
                    Calculated Rate
                  </span>
                  <span className="text-sm font-medium text-foreground tabular-nums">
                    {chart.calculatedRate == null
                      ? "Not available"
                      : `${formatNumber(chart.calculatedRate).text}/wk`}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] text-muted-foreground leading-tight">
                    Applied Rate
                  </span>
                  <span className="text-sm font-medium text-foreground tabular-nums">
                    {formatNumber(chart.appliedRate).text}/wk
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {sourceLabel(chart.appliedRateSource)}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] text-muted-foreground leading-tight">
                    Remaining Tasks
                  </span>
                  <span className="text-sm font-medium text-foreground tabular-nums">
                    {
                      formatNumber(
                        data.length
                          ? (data[data.length - 1]?.actual ??
                              chart.startingTaskCount)
                          : chart.startingTaskCount,
                      ).text
                    }
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] text-muted-foreground leading-tight">
                    Projected Completion
                  </span>
                  <span className="text-sm font-medium text-foreground tabular-nums">
                    {chart.projectedCompletionDate
                      ? fmtDate(chart.projectedCompletionDate)
                      : "—"}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-nowrap items-end gap-3 overflow-x-auto pt-2 border-t border-border">
              <div className="flex flex-col gap-1 shrink-0">
                <span className="text-xs text-muted-foreground">
                  Rate source
                </span>
                <div className="inline-flex rounded-md border border-input overflow-hidden">
                  {(
                    [
                      { key: "historical_average", label: "Calculated" },
                      { key: "manual", label: "Manual" },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setPendingSource(opt.key)}
                      className={
                        "px-3 py-1.5 text-sm " +
                        (pendingSource === opt.key
                          ? "bg-primary text-primary-foreground"
                          : "bg-background text-foreground hover:bg-accent")
                      }
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <Input
                type="number"
                label="Manual rate (tasks/wk)"
                value={manualRateInput}
                onChange={(e) => setManualRateInput(e.target.value)}
                disabled={pendingSource !== "manual"}
                className="w-28 shrink-0"
                min={0}
              />

              <Button
                type="button"
                variant="outline"
                onClick={handleRecalculate}
                isLoading={recalculating}
                className="shrink-0"
              >
                Recalculate
              </Button>
              <Button
                type="button"
                onClick={handleApply}
                isLoading={applying}
                className="shrink-0"
              >
                Apply
              </Button>
            </div>

            {actionError && (
              <p className="text-sm text-red-600">{actionError}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
