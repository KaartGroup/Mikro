import { Card, CardContent } from "@/components/ui";

export function StatCard({
  label,
  value,
  sub,
  compareValue,
}: {
  label: string;
  value: string | number;
  sub?: string;
  compareValue?: number | null;
}) {
  const numValue = typeof value === "string" ? parseFloat(value.replace(/,/g, "")) : value;
  const delta =
    compareValue != null && compareValue > 0
      ? ((numValue - compareValue) / compareValue) * 100
      : null;

  return (
    <Card>
      <CardContent className="p-4 text-center">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold mt-1">{value}</p>
        {delta != null && (
          <p
            className={`text-xs font-medium mt-1 ${delta >= 0 ? "text-green-600" : "text-red-600"}`}
          >
            {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
            <span className="text-muted-foreground font-normal ml-1">vs prior</span>
          </p>
        )}
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}
