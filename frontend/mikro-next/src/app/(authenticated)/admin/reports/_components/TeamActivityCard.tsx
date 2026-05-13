"use client";

import { useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { COLORS } from "@/lib/chartColors";
import { ChartExportButton } from "@/components/admin/ChartExportButton";
import { chartNumberFmt, chartTooltipFmt } from "./reportUtils";
import type { TimekeepingStatsResponse } from "@/types";

interface TeamActivityCardProps {
  data: TimekeepingStatsResponse;
  granularity: "weekly" | "daily";
  setGranularity: (g: "weekly" | "daily") => void;
}

export function TeamActivityCard({ data, granularity, setGranularity }: TeamActivityCardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activityData = granularity === "daily" ? data.daily_activity : data.weekly_activity;
  const dataKey = granularity === "daily" ? "day" : "week";

  return (
    <Card>
      <CardHeader className="pb-0 flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">
            {granularity === "daily" ? "Daily" : "Weekly"} Team Activity
          </CardTitle>
          <div className="flex rounded-md border border-border overflow-hidden text-xs">
            <button
              className={`px-2 py-0.5 transition-colors ${granularity === "weekly" ? "bg-kaart-orange text-white" : "bg-background text-muted-foreground hover:bg-muted"}`}
              onClick={() => setGranularity("weekly")}
            >
              Weekly
            </button>
            <button
              className={`px-2 py-0.5 transition-colors ${granularity === "daily" ? "bg-kaart-orange text-white" : "bg-background text-muted-foreground hover:bg-muted"}`}
              onClick={() => setGranularity("daily")}
            >
              Daily
            </button>
          </div>
        </div>
        <ChartExportButton containerRef={containerRef} filename="timekeeping-activity" />
      </CardHeader>
      <CardContent>
        {activityData.length > 0 ? (
          <div ref={containerRef} style={{ width: "100%", minWidth: 400, height: 280 }}>
            <ResponsiveContainer>
              <ComposedChart data={activityData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey={dataKey}
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v: string) =>
                    new Date(v + "T00:00:00").toLocaleDateString("en-US", {
                      month: "numeric",
                      day: "numeric",
                    })
                  }
                />
                <YAxis yAxisId="left" tick={{ fontSize: 10 }} tickFormatter={chartNumberFmt} />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 10 }}
                  tickFormatter={chartNumberFmt}
                />
                <Tooltip
                  labelFormatter={(v) =>
                    new Date(String(v) + "T00:00:00").toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  }
                  formatter={chartTooltipFmt}
                />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar yAxisId="left" dataKey="hours" name="Hours" fill={COLORS.hours} />
                <Line
                  yAxisId="right"
                  dataKey="changes_per_hour"
                  name="Changes/Hour"
                  stroke={COLORS.mapped}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
                <Line
                  yAxisId="right"
                  dataKey="changes_per_changeset"
                  name="Changes/Changeset"
                  stroke={COLORS.review}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-8">
            No activity data for this period.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
