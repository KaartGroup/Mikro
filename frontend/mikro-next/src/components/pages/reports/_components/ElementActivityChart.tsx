"use client";

import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Card, CardContent } from "@/components/ui";
import { COLORS } from "@/lib/chartColors";
import type { ElementAnalysisCategory } from "@/types";

interface ElementActivityChartProps {
  categories: ElementAnalysisCategory[];
  granularity: "weekly" | "daily";
}

function weekStart(day: string): string {
  const d = new Date(day + "T00:00:00");
  const diff = -d.getDay(); // roll back to Sunday (getDay() === 0 stays put)
  d.setDate(d.getDate() + diff);
  // Use local date parts — toISOString() converts to UTC and shifts the date
  // backward by 1 day for UTC+ users.
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

type ChartEntry = { date: string; added: number; modified: number; deleted: number };

function buildEntries(data: ElementAnalysisCategory["data"], granularity: "weekly" | "daily"): ChartEntry[] {
  if (granularity === "daily") {
    return data
      .map((d) => ({ date: d.day, added: d.added, modified: d.modified, deleted: d.deleted }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  const weekMap: Record<string, ChartEntry> = {};
  for (const d of data) {
    const ws = weekStart(d.day);
    if (!weekMap[ws]) weekMap[ws] = { date: ws, added: 0, modified: 0, deleted: 0 };
    weekMap[ws].added += d.added;
    weekMap[ws].modified += d.modified;
    weekMap[ws].deleted += d.deleted;
  }
  return Object.values(weekMap).sort((a, b) => a.date.localeCompare(b.date));
}

export function ElementActivityChart({ categories, granularity }: ElementActivityChartProps) {
  const activeCategories = useMemo(
    () => categories.filter((c) => c.data.length > 0),
    [categories],
  );

  const categoryData = useMemo(
    () => activeCategories.map((cat) => ({ title: cat.title, entries: buildEntries(cat.data, granularity) })),
    [activeCategories, granularity],
  );

  if (categoryData.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
        No data for the selected range
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {categoryData.map(({ title, entries }) => (
        <Card key={title} data-chart-export={title}>
          <CardContent className="p-3">
            <p className="text-xs font-semibold text-foreground mb-2">{title}</p>
            <div style={{ width: "100%", height: 140 }}>
              <ResponsiveContainer>
                <BarChart data={entries} barSize={12}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 9 }} width={35} />
                  <Tooltip contentStyle={{ fontSize: 11 }} />
                  <Bar dataKey="deleted" name="Deleted" fill={COLORS.deleted} stackId="a" />
                  <Bar dataKey="added" name="Added" fill={COLORS.added} stackId="a" />
                  <Bar dataKey="modified" name="Modified" fill={COLORS.modified} stackId="a" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
