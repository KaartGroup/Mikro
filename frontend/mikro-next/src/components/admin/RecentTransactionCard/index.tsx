"use client";

import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
  Badge,
  Tooltip,
  Val,
  type BadgeProps,
} from "@/components/ui";
import type { FormattedValue } from "@/lib/utils";

export interface RecentTransactionItem {
  id: number | string;
  name: string;
  subtext: string;
  amount: FormattedValue;
  amountColorClass?: string;
  badgeVariant: BadgeProps["variant"];
  badgeLabel: string;
}

export interface RecentTransactionCardProps {
  title: string;
  tooltipContent: string;
  href: string;
  loading: boolean;
  items: RecentTransactionItem[];
  maxItems?: number;
  emptyMessage?: string;
}

export function RecentTransactionCard({
  title,
  tooltipContent,
  href,
  loading,
  items,
  maxItems = 5,
  emptyMessage = "Nothing to display.",
}: RecentTransactionCardProps) {
  const visible = items.slice(0, maxItems);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <Tooltip content={tooltipContent} position="bottom">
          <CardTitle>{title}</CardTitle>
        </Tooltip>
        <Link href={href} className="text-sm text-kaart-orange hover:underline">
          View all
        </Link>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : visible.length > 0 ? (
          <div className="space-y-4">
            {visible.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between border-b border-border pb-3 last:border-0 last:pb-0"
              >
                <div>
                  <p className="font-medium">{item.name}</p>
                  <p className="text-sm text-muted-foreground">{item.subtext}</p>
                </div>
                <div className="text-right">
                  <p
                    className={`font-bold${item.amountColorClass ? ` ${item.amountColorClass}` : ""}`}
                  >
                    <Val>{item.amount}</Val>
                  </p>
                  <Badge variant={item.badgeVariant}>{item.badgeLabel}</Badge>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        )}
      </CardContent>
    </Card>
  );
}
