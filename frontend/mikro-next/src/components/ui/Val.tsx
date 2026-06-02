import { cn } from "@/lib/utils";
import type { FormattedValue } from "@/lib/utils";

interface ValProps {
  children: FormattedValue | string | null | undefined;
  fallback?: string;
  className?: string;
}

/**
 * Renders a value with visual distinction for placeholders.
 *
 * Accepts either a FormattedValue (from formatNumber/formatCurrency/formatString)
 * or a raw string. Placeholder values render dimmed and italic so users can
 * distinguish real data from frontend fallbacks.
 *
 * @example
 * // With formatNumber/formatCurrency:
 * <Val>{formatNumber(stats?.mapped_tasks)}</Val>
 * <Val>{formatCurrency(payable?.total)}</Val>
 *
 * // With raw strings:
 * <Val fallback="Unknown">{project.difficulty}</Val>
 * <Val>{user.osm_username}</Val>
 */
export function Val({ children, fallback = "\u2014", className }: ValProps) {
  // FormattedValue object from formatNumber/formatCurrency/formatString
  if (children && typeof children === "object" && "isPlaceholder" in children) {
    const { text, isPlaceholder } = children;
    return (
      <span
        className={cn(
          isPlaceholder && "text-muted-foreground/50 italic",
          className,
        )}
        title={isPlaceholder ? "No data available" : undefined}
      >
        {text}
      </span>
    );
  }

  // Raw string shorthand
  const isPlaceholder =
    children == null || (typeof children === "string" && !children.trim());
  return (
    <span
      className={cn(
        isPlaceholder && "text-muted-foreground/50 italic",
        className,
      )}
      title={isPlaceholder ? "No data available" : undefined}
    >
      {isPlaceholder ? fallback : children}
    </span>
  );
}
