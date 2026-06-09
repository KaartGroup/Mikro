"use client";

import { useMemo } from "react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { WEEKLY_TASK_COLORS } from "@/lib/chartColors";
import type { ElementAnalysisCategory } from "@/types";

interface OsmClassificationPieChartProps {
  categories: ElementAnalysisCategory[];
}

function categoryTotal(cat: ElementAnalysisCategory): number {
  if (cat.type === "hpr") {
    return cat.data.reduce(
      (s, d) => s + d.upgraded + d.downgraded + d.links + d.construction,
      0,
    );
  }
  return cat.data.reduce((s, d) => s + d.added + d.modified + d.deleted, 0);
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { name: string; value: number; payload: { pct: number } }[];
}) {
  if (!active || !payload?.length) return null;
  const { name, value, payload: p } = payload[0];
  return (
    <div className="bg-white border border-gray-200 rounded shadow-sm px-3 py-2 text-xs">
      <p className="font-medium text-gray-800">{name}</p>
      <p className="text-gray-600">
        {value.toLocaleString()} edits ({p.pct.toFixed(1)}%)
      </p>
    </div>
  );
}

export function OsmClassificationPieChart({
  categories,
}: OsmClassificationPieChartProps) {
  const data = useMemo(() => {
    const rows = categories
      .map((cat) => ({ name: cat.title, value: categoryTotal(cat) }))
      .filter((r) => r.value > 0);
    const total = rows.reduce((s, r) => s + r.value, 0);
    return rows.map((r) => ({ ...r, pct: total > 0 ? (r.value / total) * 100 : 0 }));
  }, [categories]);

  if (data.length === 0) {
    return (
      <Card className="h-full">
        <CardHeader className="px-4 pt-4 pb-0">
          <CardTitle className="text-base">OSM Edit Classification</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground text-center py-8">
            No element data for this period.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full flex flex-col" data-chart-export="OSM Edit Classification">
      <CardHeader className="px-4 pt-4 pb-0">
        <CardTitle className="text-base">OSM Edit Classification</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-2 flex-1 min-h-0">
        <div className="w-full h-full min-h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="45%"
                innerRadius="45%"
                outerRadius="70%"
                paddingAngle={2}
              >
                {data.map((_, i) => (
                  <Cell
                    key={i}
                    fill={WEEKLY_TASK_COLORS[i % WEEKLY_TASK_COLORS.length]}
                    stroke="#fff"
                    strokeWidth={1}
                  />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
              <Legend
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: 11 }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
