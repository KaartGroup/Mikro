import { Card, CardContent, CardHeader, Skeleton } from "@/components/ui";

const GRID_CLASS: Record<2 | 3 | 4, string> = {
  2: "grid gap-4 md:grid-cols-2",
  3: "grid gap-4 md:grid-cols-3",
  4: "grid gap-4 md:grid-cols-2 lg:grid-cols-4",
};

interface DashboardLoadingSkeletonProps {
  count?: number;
  columns?: 2 | 3 | 4;
}

export function DashboardLoadingSkeleton({
  count = 4,
  columns = 4,
}: DashboardLoadingSkeletonProps) {
  return (
    <div className="space-y-6">
      <div className={GRID_CLASS[columns]}>
        {Array.from({ length: count }, (_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
