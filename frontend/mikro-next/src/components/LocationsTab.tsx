"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  Button,
  Input,
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  Spinner,
} from "@/components/ui";
import {
  useFetchProjectLocations,
  useAssignProjectLocations,
  useUnassignProjectLocation,
  useFetchTrainingLocations,
  useAssignTrainingLocations,
  useUnassignTrainingLocation,
  type LocationsResponse,
} from "@/hooks/useApi";

// ─── Types ──────────────────────────────────────────────────

interface LocationsTabProps {
  resourceId: number | string;
  resourceType: "project" | "training";
  onClose?: () => void;
}

interface AssignedCountry {
  id: number;
  name: string;
  iso_code: string | null;
  region_name: string | null;
}

interface AvailableCountry {
  id: number;
  name: string;
  iso_code: string | null;
  region_id: number | null;
}

interface Region {
  id: number;
  name: string;
}

// ─── Hook selector ──────────────────────────────────────────

function useLocationHooks(resourceType: "project" | "training") {
  const projectFetch = useFetchProjectLocations();
  const projectAssign = useAssignProjectLocations();
  const projectUnassign = useUnassignProjectLocation();

  const trainingFetch = useFetchTrainingLocations();
  const trainingAssign = useAssignTrainingLocations();
  const trainingUnassign = useUnassignTrainingLocation();

  if (resourceType === "training") {
    return {
      fetchLocations: trainingFetch,
      assignLocations: trainingAssign,
      unassignLocation: trainingUnassign,
    };
  }
  return {
    fetchLocations: projectFetch,
    assignLocations: projectAssign,
    unassignLocation: projectUnassign,
  };
}

// ─── Component ──────────────────────────────────────────────

export default function LocationsTab({
  resourceId,
  resourceType,
  onClose,
}: LocationsTabProps) {
  const { fetchLocations, assignLocations, unassignLocation } =
    useLocationHooks(resourceType);

  const [assignedCountries, setAssignedCountries] = useState<AssignedCountry[]>(
    [],
  );
  const [allCountries, setAllCountries] = useState<AvailableCountry[]>([]);
  const [allRegions, setAllRegions] = useState<Region[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // ── Fetch locations on mount ────────────────────────────

  const loadLocations = useCallback(async () => {
    try {
      const result = await fetchLocations.mutate({
        resourceId: Number(resourceId),
      });
      setAssignedCountries(result.assigned_countries || []);
      setAllCountries(result.all_countries || []);
      setAllRegions(result.all_regions || []);
    } catch {
      // error is surfaced via fetchLocations.error
    } finally {
      setInitialLoading(false);
    }
  }, [resourceId, fetchLocations.mutate]);

  useEffect(() => {
    loadLocations();
    // Only run on mount / when resourceId changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceId]);

  // ── Close dropdown on outside click ─────────────────────

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // ── Derived data ────────────────────────────────────────

  const assignedIds = useMemo(
    () => new Set(assignedCountries.map((c) => c.id)),
    [assignedCountries],
  );

  const unassignedCountries = useMemo(
    () => allCountries.filter((c) => !assignedIds.has(c.id)),
    [allCountries, assignedIds],
  );

  const filteredCountries = useMemo(() => {
    if (!searchQuery.trim()) return unassignedCountries;
    const q = searchQuery.toLowerCase();
    return unassignedCountries.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.iso_code && c.iso_code.toLowerCase().includes(q)),
    );
  }, [unassignedCountries, searchQuery]);

  // ── Region name lookup for unassigned countries ─────────

  const regionMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const r of allRegions) {
      map.set(r.id, r.name);
    }
    return map;
  }, [allRegions]);

  // ── Handlers ────────────────────────────────────────────

  const handleAssignCountry = useCallback(
    async (countryId: number) => {
      try {
        await assignLocations.mutate({
          resourceId: Number(resourceId),
          countryIds: [countryId],
          regionIds: [],
        });
        await loadLocations();
        setSearchQuery("");
        setDropdownOpen(false);
      } catch {
        // error surfaced via assignLocations.error
      }
    },
    [resourceId, assignLocations.mutate, loadLocations],
  );

  const handleAssignRegion = useCallback(
    async (regionId: number) => {
      try {
        await assignLocations.mutate({
          resourceId: Number(resourceId),
          countryIds: [],
          regionIds: [regionId],
        });
        await loadLocations();
      } catch {
        // error surfaced via assignLocations.error
      }
    },
    [resourceId, assignLocations.mutate, loadLocations],
  );

  const handleUnassignCountry = useCallback(
    async (countryId: number) => {
      try {
        await unassignLocation.mutate({
          resourceId: Number(resourceId),
          countryId,
        });
        await loadLocations();
      } catch {
        // error surfaced via unassignLocation.error
      }
    },
    [resourceId, unassignLocation.mutate, loadLocations],
  );

  // ── Error display ───────────────────────────────────────

  const errorMessage =
    fetchLocations.error || assignLocations.error || unassignLocation.error;

  // ── Loading state ───────────────────────────────────────

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Spinner size="md" />
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────

  return (
    <div className="p-4 space-y-4">
      {/* Error banner */}
      {errorMessage && (
        <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
          {errorMessage}
        </div>
      )}

      {/* Region quick-assign buttons */}
      {allRegions.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Assign by region</p>
          <div className="flex flex-wrap gap-2">
            {allRegions.map((region) => (
              <Button
                key={region.id}
                variant="outline"
                size="sm"
                disabled={assignLocations.loading}
                onClick={() => handleAssignRegion(region.id)}
              >
                {region.name}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Country selector */}
      <div className="space-y-2">
        <p className="text-sm font-medium">Add individual country</p>
        <div className="relative" ref={dropdownRef}>
          <Input
            placeholder="Search countries..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setDropdownOpen(true);
            }}
            onFocus={() => setDropdownOpen(true)}
          />
          {dropdownOpen && filteredCountries.length > 0 && (
            <div className="absolute z-50 mt-1 max-h-48 w-full overflow-auto rounded-md border border-input bg-background shadow-md">
              {filteredCountries.slice(0, 50).map((country) => (
                <button
                  key={country.id}
                  type="button"
                  className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
                  onClick={() => handleAssignCountry(country.id)}
                  disabled={assignLocations.loading}
                >
                  <span>{country.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {country.iso_code || ""}
                    {country.region_id
                      ? ` · ${regionMap.get(country.region_id) || ""}`
                      : ""}
                  </span>
                </button>
              ))}
              {filteredCountries.length > 50 && (
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  {filteredCountries.length - 50} more — refine your search
                </div>
              )}
            </div>
          )}
          {dropdownOpen &&
            searchQuery.trim() &&
            filteredCountries.length === 0 && (
              <div className="absolute z-50 mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-muted-foreground shadow-md">
                No matching countries found
              </div>
            )}
        </div>
      </div>

      {/* Assigned countries table */}
      <div className="space-y-2">
        <p className="text-sm font-medium">
          Assigned countries{" "}
          <span className="text-muted-foreground">
            ({assignedCountries.length})
          </span>
        </p>

        {assignedCountries.length === 0 ? (
          <div className="rounded-md border border-input bg-muted/30 p-4 text-center text-sm text-muted-foreground">
            No location restrictions — visible to all users
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Country</TableHead>
                <TableHead>Region</TableHead>
                <TableHead className="w-[80px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignedCountries.map((country) => (
                <TableRow key={country.id}>
                  <TableCell className="text-sm">
                    {country.name}
                    {country.iso_code && (
                      <span className="ml-1 text-muted-foreground">
                        ({country.iso_code})
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {country.region_name || "—"}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={unassignLocation.loading}
                      onClick={() => handleUnassignCountry(country.id)}
                    >
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Optional close button */}
      {onClose && (
        <div className="flex justify-end pt-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      )}
    </div>
  );
}
