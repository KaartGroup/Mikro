"use client";

import { useMemo } from "react";
import { Select } from "@/components/ui";

interface StandaloneFilterOption {
  value: string;
  label: string;
}

interface StandaloneFilterProps {
  /** Field label rendered above the dropdown. */
  label: string;
  /** Options for this dimension. The "All …" entry is added automatically. */
  options: StandaloneFilterOption[];
  /** Selected value, or null for "All …" (no filter applied). */
  value: string | null;
  onChange: (value: string | null) => void;
  /** Custom "all" label, e.g. "All teams". Defaults to "All". */
  allLabel?: string;
  /** Disable while parent is loading data. */
  disabled?: boolean;
  className?: string;
}

const ALL_VALUE = "__all__";

/**
 * SSOT for admin filter dropdowns. One styled Select with a synthetic
 * "All …" option prepended; passes null when "All" is picked. Used on
 * /admin/projects and /admin/users to replace the multi-pill FilterBar
 * with discoverable per-dimension dropdowns.
 *
 * Options are sorted A→Z by label so the dropdowns are always
 * predictable.
 */
export function StandaloneFilter({
  label,
  options,
  value,
  onChange,
  allLabel = "All",
  disabled = false,
  className,
}: StandaloneFilterProps) {
  const selectOptions = useMemo(() => {
    const sorted = options
      .slice()
      .sort((a, b) => a.label.localeCompare(b.label));
    return [{ value: ALL_VALUE, label: allLabel }, ...sorted];
  }, [options, allLabel]);

  const selected = value ?? ALL_VALUE;

  return (
    <Select
      label={label}
      options={selectOptions}
      value={selected}
      onChange={(v) => onChange(v === ALL_VALUE ? null : v)}
      disabled={disabled}
      searchable
      className={className}
    />
  );
}
