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
import { COMMUNITY_OUTREACH_COLORS } from "@/lib/chartColors";
import { ChartExportButton } from "@/components/admin/ChartExportButton";
import { chartNumberFmt, chartTooltipFmt, MOCK_COMMUNITY_OUTREACH } from "./reportUtils";

export function CommunityOutreachCard() {
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <Card className="border-2 border-dashed border-yellow-400 relative">
      <div className="absolute top-2 right-2 z-10">
        <span className="bg-yellow-400 text-yellow-900 text-xs font-bold px-2 py-1 rounded uppercase tracking-wider">
          Sample Data
        </span>
      </div>
      <CardHeader className="pb-0 flex flex-row items-center justify-between">
        <CardTitle className="text-base">Community Outreach Trends</CardTitle>
        <ChartExportButton
          containerRef={containerRef}
          filename="timekeeping-community-outreach"
        />
      </CardHeader>
      <CardContent>
        <div ref={containerRef} style={{ width: "100%", height: 280 }}>
          <ResponsiveContainer>
            <ComposedChart data={MOCK_COMMUNITY_OUTREACH}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="week" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={chartNumberFmt} />
              <Tooltip contentStyle={{ fontSize: 11 }} formatter={chartTooltipFmt} />
              <Legend wrapperStyle={{ fontSize: 9 }} iconSize={8} />
              {Object.entries(COMMUNITY_OUTREACH_COLORS).map(([cat, color]) => (
                <Bar key={cat} dataKey={cat} stackId="a" fill={color} />
              ))}
              <Line
                dataKey="newParticipants"
                name="# of New Participants"
                stroke="#1f2937"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
              <Line
                dataKey="returnParticipants"
                name="# of Retained Participants"
                stroke="#ef4444"
                strokeWidth={2}
                dot={{ r: 3 }}
                strokeDasharray="5 5"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="text-xs text-yellow-700 font-medium text-center mt-2 bg-yellow-50 rounded py-1">
          This chart uses sample data — not connected to a real data source yet
        </p>
      </CardContent>
    </Card>
  );
}
