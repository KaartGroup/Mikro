"use client";

import { Card, CardContent, CardHeader, CardTitle, Val } from "@/components/ui";
import { ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { formatNumber } from "@/lib/utils";
import { COLORS } from "@/lib/chartColors";

interface ProjectProgressDonutProps {
  overallProgress: { totalTasks: number; totalMapped: number; pct: number } | null;
  activeProjects: number;
}

export function ProjectProgressDonut({ overallProgress, activeProjects }: ProjectProgressDonutProps) {
  const donutData = overallProgress
    ? [
        { name: "Completed", value: overallProgress.pct },
        { name: "Remaining", value: 100 - overallProgress.pct },
      ]
    : [];

  return (
    <Card>
      <CardHeader className="pb-0">
        <CardTitle className="text-base">Project Progress</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center">
        <div style={{ width: 180, height: 180, position: "relative" }}>
          <ResponsiveContainer>
            <PieChart>
              <Pie
                data={donutData}
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={80}
                startAngle={90}
                endAngle={-270}
                dataKey="value"
                strokeWidth={0}
              >
                <Cell fill={COLORS.mapped} />
                <Cell fill="#e5e7eb" />
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-bold text-foreground">
              {overallProgress?.pct ?? 0}%
            </span>
            <span className="text-xs text-muted-foreground">Completed</span>
          </div>
        </div>
        <div className="text-center mt-2 space-y-1">
          <p className="text-sm text-muted-foreground">
            <Val>{formatNumber(overallProgress?.totalMapped)}</Val> /{" "}
            <Val>{formatNumber(overallProgress?.totalTasks)}</Val> tasks
          </p>
          <p className="text-sm font-medium">
            <Val>{formatNumber(activeProjects)}</Val> active projects
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
