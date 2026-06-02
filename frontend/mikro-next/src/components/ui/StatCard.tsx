import { Card, CardContent } from "./Card";
import { Val } from "./Val";
import { StatCardLink } from "./StatCardLink";
import type { FormattedValue } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: FormattedValue | string | number;
  sub?: string;
  /**
   * Optional link target. When provided, a small corner link icon is
   * rendered in the upper-right that navigates to the page which best
   * details this stat. Matches the affordance used on the admin
   * dashboard stat cards (UI4, 2026-04 meeting).
   */
  href?: string;
  /** Accessible label for the corner link. Defaults to "View <label> details". */
  linkLabel?: string;
}

export function StatCard({
  label,
  value,
  sub,
  href,
  linkLabel,
}: StatCardProps) {
  return (
    <Card>
      <CardContent className="p-4 relative">
        {href && (
          <div className="absolute top-2 right-2">
            <StatCardLink
              href={href}
              label={linkLabel ?? `View ${label} details`}
            />
          </div>
        )}
        <div className="text-center">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold mt-1">
            {typeof value === "object" && "isPlaceholder" in value ? (
              <Val>{value}</Val>
            ) : (
              value
            )}
          </p>
          {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
