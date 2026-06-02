"use client";

import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent } from "@/components/ui";
import { COLORS, HPR_COLORS } from "@/lib/chartColors";
import type { ElementAnalysisCategory } from "@/types";

interface ElementActivityChartProps {
  categories: ElementAnalysisCategory[];
  granularity: "weekly" | "daily";
}

function weekStart(day: string): string {
  const d = new Date(day + "T00:00:00");
  const diff = -d.getDay();
  d.setDate(d.getDate() + diff);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

type StandardEntry = {
  date: string;
  added: number;
  modified: number;
  deleted: number;
  total: number;
};
type HprEntry = {
  date: string;
  upgraded: number;
  downgraded: number;
  links: number;
  construction: number;
  total: number;
};
type ChartItem =
  | { type: "standard"; title: string; entries: StandardEntry[] }
  | { type: "hpr"; title: string; entries: HprEntry[] };

function buildStandardEntries(
  data: { day: string; added: number; modified: number; deleted: number }[],
  granularity: "weekly" | "daily",
): StandardEntry[] {
  let rows: StandardEntry[];
  if (granularity === "daily") {
    rows = data
      .map((d) => ({
        date: d.day,
        added: d.added,
        modified: d.modified,
        deleted: d.deleted,
        total: 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  } else {
    const weekMap: Record<string, StandardEntry> = {};
    for (const d of data) {
      const ws = weekStart(d.day);
      if (!weekMap[ws])
        weekMap[ws] = { date: ws, added: 0, modified: 0, deleted: 0, total: 0 };
      weekMap[ws].added += d.added;
      weekMap[ws].modified += d.modified;
      weekMap[ws].deleted += d.deleted;
    }
    rows = Object.values(weekMap).sort((a, b) => a.date.localeCompare(b.date));
  }
  rows.forEach((r) => {
    r.total = r.added + r.modified + r.deleted;
  });
  return rows;
}

function buildHprEntries(
  data: {
    day: string;
    upgraded: number;
    downgraded: number;
    links: number;
    construction: number;
  }[],
  granularity: "weekly" | "daily",
): HprEntry[] {
  let rows: HprEntry[];
  if (granularity === "daily") {
    rows = data
      .map((d) => ({
        date: d.day,
        upgraded: d.upgraded,
        downgraded: d.downgraded,
        links: d.links,
        construction: d.construction,
        total: 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  } else {
    const weekMap: Record<string, HprEntry> = {};
    for (const d of data) {
      const ws = weekStart(d.day);
      if (!weekMap[ws])
        weekMap[ws] = {
          date: ws,
          upgraded: 0,
          downgraded: 0,
          links: 0,
          construction: 0,
          total: 0,
        };
      weekMap[ws].upgraded += d.upgraded;
      weekMap[ws].downgraded += d.downgraded;
      weekMap[ws].links += d.links;
      weekMap[ws].construction += d.construction;
    }
    rows = Object.values(weekMap).sort((a, b) => a.date.localeCompare(b.date));
  }
  rows.forEach((r) => {
    r.total = r.upgraded + r.downgraded + r.links + r.construction;
  });
  return rows;
}

const BAR_STROKE = { stroke: "#000000", strokeWidth: 0.5 };

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name: string; value: number; fill: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded shadow-sm px-2 py-1.5 text-xs">
      <p className="font-medium mb-1 text-gray-700">{label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-1.5">
          <span
            className="inline-block w-2.5 h-2.5 rounded-sm border border-black flex-shrink-0"
            style={{ backgroundColor: entry.fill }}
          />
          <span className="text-gray-600">{entry.name}:</span>
          <span className="font-medium text-gray-800">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

function totalLabel(entries: { total: number }[]) {
  return (props: {
    x?: number;
    y?: number;
    width?: number;
    index?: number;
  }) => {
    const { x = 0, y = 0, width = 0, index = 0 } = props;
    const total = entries[index]?.total;
    if (!total) return null;
    return (
      <text
        x={x + width / 2}
        y={y - 3}
        textAnchor="middle"
        fontSize={8}
        fill="#374151"
      >
        {total}
      </text>
    );
  };
}

export function ElementActivityChart({
  categories,
  granularity,
}: ElementActivityChartProps) {
  const chartItems = useMemo(
    (): ChartItem[] =>
      categories
        .filter((c) => c.data.length > 0)
        .map((cat) =>
          cat.type === "hpr"
            ? {
                type: "hpr",
                title: cat.title,
                entries: buildHprEntries(cat.data, granularity),
              }
            : {
                type: "standard",
                title: cat.title,
                entries: buildStandardEntries(cat.data, granularity),
              },
        ),
    [categories, granularity],
  );

  if (chartItems.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
        No data for the selected range
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {chartItems.map((item) => (
        <Card key={item.title} data-chart-export={item.title}>
          <CardContent className="p-3">
            <p className="text-xs font-semibold text-foreground mb-2">
              {item.title}
            </p>
            <div style={{ width: "100%", height: 140 }}>
              <ResponsiveContainer>
                <BarChart
                  data={item.entries}
                  barSize={12}
                  margin={{ top: 14, right: 4, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 9 }} width={35} />
                  <Tooltip content={<ChartTooltip />} />
                  {item.type === "hpr" ? (
                    <>
                      <Bar
                        dataKey="downgraded"
                        name="Downgraded"
                        fill={HPR_COLORS.downgraded}
                        stackId="a"
                        {...BAR_STROKE}
                      />
                      <Bar
                        dataKey="construction"
                        name="Construction"
                        fill={HPR_COLORS.construction}
                        stackId="a"
                        {...BAR_STROKE}
                      />
                      <Bar
                        dataKey="links"
                        name="Links"
                        fill={HPR_COLORS.links}
                        stackId="a"
                        {...BAR_STROKE}
                      />
                      <Bar
                        dataKey="upgraded"
                        name="Upgraded"
                        fill={HPR_COLORS.upgraded}
                        stackId="a"
                        {...BAR_STROKE}
                        label={totalLabel(item.entries) as unknown as object}
                      />
                    </>
                  ) : (
                    <>
                      <Bar
                        dataKey="modified"
                        name="Modified"
                        fill={COLORS.modified}
                        stackId="a"
                        {...BAR_STROKE}
                      />
                      <Bar
                        dataKey="added"
                        name="Added"
                        fill={COLORS.added}
                        stackId="a"
                        {...BAR_STROKE}
                      />
                      <Bar
                        dataKey="deleted"
                        name="Deleted"
                        fill={COLORS.deleted}
                        stackId="a"
                        {...BAR_STROKE}
                        label={totalLabel(item.entries) as unknown as object}
                      />
                    </>
                  )}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
