import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import type { ActivityDataPoint } from "@/types";

interface ActivityChartProps {
  activityData: ActivityDataPoint[];
  activityLoading: boolean;
  dateLabel: string;
}

export function ActivityChart({
  activityData,
  activityLoading,
  dateLabel,
}: ActivityChartProps) {
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Activity Overview</CardTitle>
      </CardHeader>
      <CardContent>
        {activityLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-kaart-orange" />
            Loading activity data...
          </div>
        ) : activityData.length > 0 ? (
          <div style={{ width: "100%", height: 300 }}>
            <ResponsiveContainer>
              <ComposedChart data={activityData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12 }}
                  tickFormatter={(v: string) =>
                    new Date(v + "T00:00:00").toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })
                  }
                />
                <YAxis yAxisId="left" tick={{ fontSize: 12 }} />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 12 }}
                />
                <Tooltip
                  labelFormatter={(v) =>
                    new Date(String(v) + "T00:00:00").toLocaleDateString(
                      "en-US",
                      { month: "short", day: "numeric", year: "numeric" },
                    )
                  }
                />
                <Legend />
                <Bar
                  yAxisId="left"
                  dataKey="tasksMapped"
                  name="Tasks Mapped"
                  fill="#f97316"
                  stackId="tasks"
                />
                <Bar
                  yAxisId="left"
                  dataKey="tasksValidated"
                  name="Tasks Validated"
                  fill="#3b82f6"
                  stackId="tasks"
                />
                <Line
                  yAxisId="right"
                  dataKey="hoursWorked"
                  name="Hours Worked"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : (
          dateLabel && (
            <p className="text-sm text-muted-foreground text-center py-4">
              No activity data for this period.
            </p>
          )
        )}
      </CardContent>
    </Card>
  );
}
