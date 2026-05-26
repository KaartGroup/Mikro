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

interface TrendOverviewProps {
  title: string;
  data: Array<{ date: string; value: number }>;
  compareData?: Array<{ date: string; value: number }>;
  color?: string;
  unit?: string;
  loading?: boolean;
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
  compareData,
}: TrendOverviewProps) {
  const total = data.reduce((s, d) => s + d.value, 0);

  // σ bands derived from comparison data only — hidden when no comparison is active
  const cmpValues = compareData?.map((d) => d.value) ?? [];
  const cmpAvg = cmpValues.length > 0 ? cmpValues.reduce((s, v) => s + v, 0) / cmpValues.length : 0;
  const cmpVariance =
    cmpValues.length > 0
      ? cmpValues.reduce((s, v) => s + (v - cmpAvg) ** 2, 0) / cmpValues.length
      : 0;
  const cmpStdDev = Math.sqrt(cmpVariance);
  const upper = cmpAvg + cmpStdDev;
  const lower = cmpAvg - cmpStdDev;
  const hasCompare = cmpValues.length > 0 && cmpStdDev > 0;

  const cmpTotal = cmpValues.reduce((s, v) => s + v, 0);
  const delta =
    hasCompare && cmpTotal > 0
      ? ((total - cmpTotal) / cmpTotal) * 100
      : null;

  return (
    <Card className="flex-1" data-chart-export={title}>
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
              <LineChart data={data} margin={{ top: 4, right: 24, left: -32, bottom: 0 }}>
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
                  formatter={(v: number | undefined) => {
                    if (v == null) return ["", title];
                    const formatted = `${formatNumber(v).text}${unit ? " " + unit : ""}`;
                    const note = v > upper ? " · above avg" : v < lower ? " · below avg" : "";
                    return [formatted + note, title];
                  }}
                />
                {hasCompare && cmpAvg > 0 && (
                  <ReferenceLine y={cmpAvg} stroke={color} strokeDasharray="3 3" strokeOpacity={0.35} />
                )}
                {hasCompare && (
                  <ReferenceLine
                    y={upper}
                    stroke="#16a34a"
                    strokeDasharray="2 2"
                    strokeOpacity={0.6}
                    label={{ value: "+1σ", position: "right", fontSize: 8, fill: "#16a34a" }}
                  />
                )}
                {hasCompare && lower > 0 && (
                  <ReferenceLine
                    y={lower}
                    stroke="#dc2626"
                    strokeDasharray="2 2"
                    strokeOpacity={0.6}
                    label={{ value: "-1σ", position: "right", fontSize: 8, fill: "#dc2626" }}
                  />
                )}
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke={color}
                  strokeWidth={2}
                  dot={(props: { cx?: number; cy?: number; value?: number; index?: number }) => {
                    const { cx, cy, value, index } = props;
                    if (cx == null || cy == null || value == null) return <circle key={index} r={0} />;
                    const fill =
                      value > upper ? "#16a34a" : value < lower ? "#dc2626" : color;
                    const r = value > upper || value < lower ? 3.5 : 2.5;
                    return <circle key={index} cx={cx} cy={cy} r={r} fill={fill} strokeWidth={0} />;
                  }}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {hasCompare && (
          <div className="flex items-center gap-3 mt-2 pt-2 border-t border-border">
            <div className="flex flex-col">
              <span className="text-[10px] text-muted-foreground leading-tight">Cmp avg</span>
              <span className="text-xs font-medium text-foreground tabular-nums">
                {formatNumber(cmpAvg).text}{unit ? ` ${unit}` : ""}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] text-muted-foreground leading-tight">σ</span>
              <span className="text-xs font-medium text-foreground tabular-nums">
                ±{formatNumber(cmpStdDev).text}{unit ? ` ${unit}` : ""}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] text-green-600 leading-tight">+1σ</span>
              <span className="text-xs font-medium text-green-600 tabular-nums">
                {formatNumber(upper).text}{unit ? ` ${unit}` : ""}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] text-red-500 leading-tight">−1σ</span>
              <span className="text-xs font-medium text-red-500 tabular-nums">
                {formatNumber(Math.max(lower, 0)).text}{unit ? ` ${unit}` : ""}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
