"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  MultiSelect,
  type MultiSelectOption,
} from "@/components/ui/MultiSelect";
import { FilterChip } from "./FilterChip";

interface FilterDimension {
  key: string;
  label: string;
  options: MultiSelectOption[];
}

interface ActiveFilter {
  key: string;
  values: string[];
}

interface FilterBarProps {
  dimensions: FilterDimension[];
  activeFilters: ActiveFilter[];
  onChange: (filters: ActiveFilter[]) => void;
  loading?: boolean;
}

export function FilterBar({
  dimensions,
  activeFilters,
  onChange,
  loading = false,
}: FilterBarProps) {
  // Which dimension's MultiSelect is currently open
  const [editingDimension, setEditingDimension] = useState<string | null>(null);
  // Whether the "Add Filter" dropdown is open
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  const addMenuRef = useRef<HTMLDivElement>(null);
  const multiSelectRef = useRef<HTMLDivElement>(null);

  // Dimensions that already have an active filter
  const usedKeys = new Set(activeFilters.map((f) => f.key));

  // Available dimensions to add
  const availableDimensions = dimensions.filter((d) => !usedKeys.has(d.key));

  // Close add-menu on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        addMenuRef.current &&
        !addMenuRef.current.contains(event.target as Node)
      ) {
        setAddMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Close editing MultiSelect on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        multiSelectRef.current &&
        !multiSelectRef.current.contains(event.target as Node)
      ) {
        // Remove the filter if no values were selected
        if (editingDimension) {
          const filter = activeFilters.find((f) => f.key === editingDimension);
          if (filter && filter.values.length === 0) {
            onChange(activeFilters.filter((f) => f.key !== editingDimension));
          }
        }
        setEditingDimension(null);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [editingDimension, activeFilters, onChange]);

  const handleAddDimension = (dimensionKey: string) => {
    setAddMenuOpen(false);
    // Add an empty filter for this dimension
    onChange([...activeFilters, { key: dimensionKey, values: [] }]);
    setEditingDimension(dimensionKey);
  };

  const handleRemoveFilter = useCallback(
    (key: string) => {
      onChange(activeFilters.filter((f) => f.key !== key));
      if (editingDimension === key) {
        setEditingDimension(null);
      }
    },
    [activeFilters, onChange, editingDimension],
  );

  const handleFilterValuesChange = useCallback(
    (key: string, values: string[]) => {
      onChange(
        activeFilters.map((f) => (f.key === key ? { ...f, values } : f)),
      );
    },
    [activeFilters, onChange],
  );

  const handleChipClick = (key: string) => {
    setEditingDimension(editingDimension === key ? null : key);
  };

  // Find dimension config for a given key
  const getDimension = (key: string) => dimensions.find((d) => d.key === key);

  // Resolve selected values to labels for a filter chip
  const getSelectedLabels = (filter: ActiveFilter): string[] => {
    const dim = getDimension(filter.key);
    if (!dim) return filter.values;
    return filter.values
      .map((v) => dim.options.find((o) => o.value === v)?.label ?? v)
      .filter(Boolean);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Active filter chips */}
      {activeFilters.map((filter) => {
        const dim = getDimension(filter.key);
        if (!dim) return null;

        return (
          <div key={filter.key} className="relative">
            <FilterChip
              dimensionLabel={dim.label}
              selectedLabels={getSelectedLabels(filter)}
              onRemove={() => handleRemoveFilter(filter.key)}
              onClick={() => handleChipClick(filter.key)}
            />

            {/* Inline MultiSelect dropdown when editing */}
            {editingDimension === filter.key && (
              <div
                ref={multiSelectRef}
                className="absolute left-0 top-full z-50 mt-1 w-64"
              >
                <MultiSelect
                  options={dim.options}
                  value={filter.values}
                  onChange={(values) =>
                    handleFilterValuesChange(filter.key, values)
                  }
                  placeholder={`Select ${dim.label.toLowerCase()}...`}
                  searchable
                  autoOpen
                  className="w-full"
                />
              </div>
            )}
          </div>
        );
      })}

      {/* Add Filter button */}
      {availableDimensions.length > 0 && (
        <div ref={addMenuRef} className="relative">
          <button
            type="button"
            onClick={() => setAddMenuOpen(!addMenuOpen)}
            disabled={loading}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border border-dashed border-input px-3 py-1 text-sm text-muted-foreground",
              "transition-colors hover:border-foreground/30 hover:text-foreground",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Filter
          </button>

          {/* Dimension picker dropdown */}
          {addMenuOpen && (
            <div className="absolute left-0 top-full z-50 mt-1 min-w-40 rounded-lg border border-input bg-background shadow-md">
              <div className="py-1">
                {availableDimensions.map((dim) => (
                  <button
                    key={dim.key}
                    type="button"
                    onClick={() => handleAddDimension(dim.key)}
                    className={cn(
                      "flex w-full items-center px-3 py-2 text-sm",
                      "hover:bg-accent hover:text-accent-foreground",
                    )}
                  >
                    {dim.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Loading indicator */}
      {loading && (
        <span className="text-xs text-muted-foreground">Loading...</span>
      )}
    </div>
  );
}
