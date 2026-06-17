import { Button, Select } from "@/components/ui";

interface TablePaginatorProps {
  page: number;
  totalItems: number;
  pageSize: number;
  /** Optional resource label appended to the summary, e.g. "projects". */
  itemLabel?: string;
  /** Disable all controls (e.g. while a server page request is in flight). */
  disabled?: boolean;
  /**
   * Preferred API. When provided, the paginator renders the full control set —
   * First « · Prev · page dropdown (Jump To) · Next · Last » — and derives every
   * action from this single callback.
   */
  onPageChange?: (page: number) => void;
  /**
   * Legacy API. When `onPageChange` is omitted, the paginator falls back to a
   * Prev/Next-only layout driven by these two callbacks (unchanged behavior for
   * existing consumers).
   */
  onPrev?: () => void;
  onNext?: () => void;
}

export function TablePaginator({
  page,
  totalItems,
  pageSize,
  itemLabel,
  disabled = false,
  onPageChange,
  onPrev,
  onNext,
}: TablePaginatorProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalItems);
  const isFirst = page <= 1;
  const isLast = page >= totalPages;

  const summary = (
    <span>
      Showing {start}–{end} of {totalItems}
      {itemLabel ? ` ${itemLabel}` : ""}
    </span>
  );

  // Legacy Prev/Next-only layout — used by consumers that don't pass
  // `onPageChange`. Matches the original component exactly.
  if (!onPageChange) {
    return (
      <div className="flex items-center justify-between mt-3 text-sm text-muted-foreground">
        {summary}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={isFirst || disabled}
            onClick={onPrev}
          >
            Previous
          </Button>
          <span className="flex items-center px-2">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={isLast || disabled}
            onClick={onNext}
          >
            Next
          </Button>
        </div>
      </div>
    );
  }

  const pageOptions = Array.from({ length: totalPages }, (_, i) => ({
    value: String(i + 1),
    label: `Page ${i + 1}`,
  }));

  return (
    <div className="flex items-center justify-between mt-3 text-sm text-muted-foreground">
      {summary}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          aria-label="First page"
          title="First page"
          disabled={isFirst || disabled}
          onClick={() => onPageChange(1)}
        >
          «
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={isFirst || disabled}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </Button>
        {/* Jump To — searchable so typing a number filters a long page list. */}
        <Select
          className="w-32"
          options={pageOptions}
          value={String(page)}
          onChange={(v) => onPageChange(Number(v))}
          disabled={disabled}
          searchable
        />
        <Button
          variant="outline"
          size="sm"
          disabled={isLast || disabled}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-label="Last page"
          title="Last page"
          disabled={isLast || disabled}
          onClick={() => onPageChange(totalPages)}
        >
          »
        </Button>
      </div>
    </div>
  );
}
