"use client";

import { useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import {
  ComposedChart,
  Line,
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
}

export function TeamActivityCard({ data, granularity }: TeamActivityCardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activityData = granularity === "daily" ? data.daily_activity : data.weekly_activity;
  const dataKey = granularity === "daily" ? "day" : "week";

  return (
    <Card data-chart-export="Team Activity">
      <CardHeader className="pb-0 flex flex-row items-center justify-between">
        <CardTitle className="text-base">Team Activity</CardTitle>
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
                <Line
                  yAxisId="left"
                  dataKey="hours"
                  name="Hours"
                  stroke={COLORS.hours}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
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
