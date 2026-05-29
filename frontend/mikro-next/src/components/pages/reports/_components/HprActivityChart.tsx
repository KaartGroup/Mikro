"use client";

import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Card, CardContent } from "@/components/ui";
import { HPR_COLORS } from "@/lib/chartColors";
import type { HprAnalysisCategory } from "@/types";

interface HprActivityChartProps {
  category: HprAnalysisCategory;
  granularity: "weekly" | "daily";
}

function weekStart(day: string): string {
  const d = new Date(day + "T00:00:00");
  d.setDate(d.getDate() - d.getDay());
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

type ChartEntry = { date: string; upgraded: number; downgraded: number; links: number; construction: number };

function buildEntries(data: HprAnalysisCategory["data"], granularity: "weekly" | "daily"): ChartEntry[] {
  if (granularity === "daily") {
    return data
      .map((d) => ({ date: d.day, upgraded: d.upgraded, downgraded: d.downgraded, links: d.links, construction: d.construction }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  const weekMap: Record<string, ChartEntry> = {};
  for (const d of data) {
    const ws = weekStart(d.day);
    if (!weekMap[ws]) weekMap[ws] = { date: ws, upgraded: 0, downgraded: 0, links: 0, construction: 0 };
    weekMap[ws].upgraded += d.upgraded;
    weekMap[ws].downgraded += d.downgraded;
    weekMap[ws].links += d.links;
    weekMap[ws].construction += d.construction;
  }
  return Object.values(weekMap).sort((a, b) => a.date.localeCompare(b.date));
}

export function HprActivityChart({ category, granularity }: HprActivityChartProps) {
  const entries = useMemo(() => buildEntries(category.data, granularity), [category.data, granularity]);

  return (
    <Card data-chart-export={category.title}>
      <CardContent className="p-3">
        <p className="text-xs font-semibold text-foreground mb-2">{category.title}</p>
        <div style={{ width: "100%", height: 140 }}>
          <ResponsiveContainer>
            <BarChart data={entries} barSize={12}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 9 }} width={35} />
              <Tooltip contentStyle={{ fontSize: 11 }} />
              <Bar dataKey="downgraded" name="Downgraded" fill={HPR_COLORS.downgraded} stackId="a" />
              <Bar dataKey="construction" name="Construction" fill={HPR_COLORS.construction} stackId="a" />
              <Bar dataKey="links" name="Links" fill={HPR_COLORS.links} stackId="a" />
              <Bar dataKey="upgraded" name="Upgraded" fill={HPR_COLORS.upgraded} stackId="a" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
