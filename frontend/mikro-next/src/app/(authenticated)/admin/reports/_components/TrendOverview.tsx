"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { Card, CardContent } from "@/components/ui";
import { formatNumber } from "@/lib/utils";
import { useEffect } from "react";

interface TrendOverviewProps {
  title: string;
  data: Array<{ date: string; value: number }>;
  color?: string;
  unit?: string;
  loading?: boolean;
  compareEnabled?: boolean;
  compareTotal?: number | null;
}

function fmt(date: string) {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export default function TrendOverview({
  title,
  data,
  color = "#f97316",
  unit = "",
  loading = false,
  compareEnabled = false,
  compareTotal = null,
}: TrendOverviewProps) {

  useEffect(() => {
    console.log("TrendOverview data:", data);
  }, [data]);

  const total = data.reduce((s, d) => s + d.value, 0);
  const avg = data.length > 0 ? total / data.length : 0;
  const delta =
    compareEnabled && compareTotal != null && compareTotal > 0
      ? ((total - compareTotal) / compareTotal) * 100
      : null;

  return (
    <Card className="flex-1">
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-1">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          {delta != null && (
            <span
              className={`text-xs font-medium ${delta >= 0 ? "text-green-600" : "text-red-500"}`}
            >
              {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
            </span>
          )}
        </div>

        <p className="text-2xl font-bold text-foreground mb-3">
          {formatNumber(total).text}
          {unit && <span className="text-base font-normal text-muted-foreground ml-1">{unit}</span>}
        </p>

        {loading ? (
          <div className="h-[80px] flex items-center justify-center">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-kaart-orange" />
          </div>
        ) : data.length === 0 ? (
          <div className="h-[80px] flex items-center justify-center">
            <p className="text-xs text-muted-foreground">No data for this period</p>
          </div>
        ) : (
          <div style={{ width: "100%", height: 80 }}>
            <ResponsiveContainer>
              <LineChart data={data} margin={{ top: 4, right: 4, left: -32, bottom: 0 }}>
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 9 }}
                  tickFormatter={fmt}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 9 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => formatNumber(v).text}
                />
                <Tooltip
                  contentStyle={{ fontSize: 11, padding: "4px 8px" }}
                  labelFormatter={(label) => fmt(String(label))}
                  formatter={(v: number | undefined) => [
                    v != null ? `${formatNumber(v).text}${unit ? " " + unit : ""}` : "",
                    title,
                  ]}
                />
                {avg > 0 && (
                  <ReferenceLine
                    y={avg}
                    stroke={color}
                    strokeDasharray="3 3"
                    strokeOpacity={0.4}
                  />
                )}
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke={color}
                  strokeWidth={2}
                  dot={{ r: 2.5, fill: color, strokeWidth: 0 }}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
