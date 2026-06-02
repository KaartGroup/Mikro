"use client";

import { useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { COMMUNITY_OUTREACH_COLORS } from "@/lib/chartColors";
import { chartNumberFmt, chartTooltipFmt } from "./reportUtils";
import type { TimekeepingStatsResponse } from "@/types";

interface CommunityOutreachCardProps {
  data: TimekeepingStatsResponse;
  granularity: "weekly" | "daily";
}

export function CommunityOutreachCard({
  data,
  granularity,
}: CommunityOutreachCardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const catData =
    granularity === "daily"
      ? data.daily_category_hours
      : data.weekly_category_hours;
  const dataKey = granularity === "daily" ? "day" : "week";

  const communityCategories = (data.weekly_category_names ?? []).filter((cat) =>
    cat.includes("community"),
  );

  return (
    <Card className="w-full">
      <CardHeader className="px-3 pt-3 pb-0 flex flex-row items-center justify-between">
        <CardTitle className="text-base">Community Outreach Trends</CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 pt-2">
        {catData?.length > 0 && communityCategories.length > 0 ? (
          <div ref={containerRef} style={{ width: "100%", height: 280 }}>
            <ResponsiveContainer>
              <BarChart
                data={catData.map((row) => ({
                  ...row,
                  [dataKey]: new Date(
                    String(row[dataKey]) + "T00:00:00",
                  ).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  }),
                }))}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey={dataKey} tick={{ fontSize: 10 }} />
                <YAxis
                  tick={{ fontSize: 10 }}
                  tickFormatter={chartNumberFmt}
                  label={{
                    value: "Hours",
                    angle: -90,
                    position: "insideLeft",
                    style: { fontSize: 10 },
                  }}
                />
                <Tooltip
                  contentStyle={{ fontSize: 11 }}
                  formatter={chartTooltipFmt}
                />
                <Legend wrapperStyle={{ fontSize: 9 }} iconSize={8} />
                {communityCategories.map((cat) => (
                  <Bar
                    key={cat}
                    dataKey={cat}
                    stackId="a"
                    fill={COMMUNITY_OUTREACH_COLORS[cat] ?? "#9ca3af"}
                    stroke="#ffffff"
                    strokeWidth={0.5}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-8">
            No community activity for this period.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
