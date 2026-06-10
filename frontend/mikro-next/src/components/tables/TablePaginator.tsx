import { Button } from "@/components/ui";

interface TablePaginatorProps {
  page: number;
  totalItems: number;
  pageSize: number;
  onPrev: () => void;
  onNext: () => void;
}

export function TablePaginator({
  page,
  totalItems,
  pageSize,
  onPrev,
  onNext,
}: TablePaginatorProps) {
  const totalPages = Math.ceil(totalItems / pageSize);
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalItems);

  return (
    <div className="flex items-center justify-between mt-3 text-sm text-muted-foreground">
      <span>
        Showing {start}–{end} of {totalItems}
      </span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page === 1}
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
          disabled={page >= totalPages}
          onClick={onNext}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
