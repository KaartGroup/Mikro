"use client";

import { useMemo } from "react";
import { Select } from "@/components/ui";
import { useFetchCountries } from "@/hooks/useApi";

interface RegionFilterProps {
  /** Selected country id, or null for "All regions". */
  value: number | null;
  /** Called with the new selection (null when "All regions" is picked). */
  onChange: (countryId: number | null) => void;
  /** Optional class for the wrapper. */
  className?: string;
}

const ALL_REGIONS_VALUE = "__all__";

/**
 * Single-select country dropdown for admin pages. Default is
 * "All regions" — the page sees its full org-wide data. Picking a
 * specific country narrows the page to that country.
 *
 * SSOT: shared across /admin/projects, /admin/dashboard, /admin/users.
 * Each consuming page tracks its own selected country in local state
 * and threads it into its data fetch as `country_id`.
 */
export function RegionFilter({
  value,
  onChange,
  className,
}: RegionFilterProps) {
  const { data } = useFetchCountries();

  const options = useMemo(() => {
    const countries = (data?.countries ?? [])
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
    return [
      { value: ALL_REGIONS_VALUE, label: "All regions" },
      ...countries.map((c) => ({ value: String(c.id), label: c.name })),
    ];
  }, [data]);

  const selected = value == null ? ALL_REGIONS_VALUE : String(value);

  return (
    <Select
      label="Region"
      options={options}
      value={selected}
      onChange={(v) => onChange(v === ALL_REGIONS_VALUE ? null : Number(v))}
      searchable
      className={className}
    />
  );
}
