"use client";

import { useState, useMemo, useCallback } from "react";

interface ActiveFilter {
  key: string;
  values: string[];
}

export function useFilters() {
  const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>([]);

  const filtersBody = useMemo(() => {
    const result: Record<string, string[]> = {};
    for (const f of activeFilters) {
      if (f.values.length > 0) {
        result[f.key] = f.values;
      }
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }, [activeFilters]);

  const clearFilters = useCallback(() => setActiveFilters([]), []);

  return { activeFilters, setActiveFilters, filtersBody, clearFilters };
}
