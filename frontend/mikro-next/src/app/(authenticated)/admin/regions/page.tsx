"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Modal,
  ConfirmDialog,
  Input,
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  Val,
} from "@/components/ui";
import { useToastActions } from "@/components/ui";
import { formatNumber } from "@/lib/utils";

interface Country {
  id: number;
  name: string;
  iso_code: string;
  default_timezone: string;
  user_count: number;
}

interface Region {
  id: number;
  name: string;
  countries: Country[];
}

export default function AdminRegionsPage() {
  const toast = useToastActions();

  // Data state
  const [regions, setRegions] = useState<Region[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedRegion, setSelectedRegion] = useState<Region | null>(null);

  // Region modal state
  const [showCreateRegionModal, setShowCreateRegionModal] = useState(false);
  const [editingRegion, setEditingRegion] = useState<Region | null>(null);
  const [deleteRegionTarget, setDeleteRegionTarget] = useState<Region | null>(
    null,
  );
  const [regionName, setRegionName] = useState("");
  const [regionSaving, setRegionSaving] = useState(false);

  // Country modal state
  const [showCreateCountryModal, setShowCreateCountryModal] = useState(false);
  const [editingCountry, setEditingCountry] = useState<Country | null>(null);
  const [deleteCountryTarget, setDeleteCountryTarget] =
    useState<Country | null>(null);
  const [countryName, setCountryName] = useState("");
  const [countryIsoCode, setCountryIsoCode] = useState("");
  const [countryTimezone, setCountryTimezone] = useState("");
  const [countrySaving, setCountrySaving] = useState(false);

  // Pagination for countries table
  const ROWS_PER_PAGE = 20;
  const [countryPage, setCountryPage] = useState(1);

  // Seed / Purge state
  const [seeding, setSeeding] = useState(false);
  const [showPurgeModal, setShowPurgeModal] = useState(false);
  const [purging, setPurging] = useState(false);

  const fetchRegions = useCallback(async () => {
    try {
      const response = await fetch("/backend/region/fetch_regions", {
        method: "POST",
      });
      if (response.ok) {
        const data = await response.json();
        setRegions(data.regions || []);
      }
    } catch (error) {
      console.error("Failed to fetch regions:", error);
      toast.error("Failed to fetch regions");
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchRegions();
  }, [fetchRegions]);

  // When regions update, keep selectedRegion in sync
  useEffect(() => {
    setSelectedRegion((prev) => {
      if (!prev) return prev;
      const updated = regions.find((r) => r.id === prev.id);
      return updated ?? null;
    });
  }, [regions]);

  // Reset country page when selected region changes
  useEffect(() => {
    setCountryPage(1);
  }, [selectedRegion?.id]);

  // Seed defaults
  const handleSeedDefaults = async () => {
    setSeeding(true);
    try {
      const response = await fetch("/backend/region/seed_defaults", {
        method: "POST",
      });
      const data = await response.json();
      if (response.ok && data.status === 200) {
        toast.success(
          data.message ||
            `Seeded ${data.created_regions ?? 0} regions and ${data.created_countries ?? 0} countries`,
        );
        fetchRegions();
      } else {
        toast.error(data.message || "Failed to seed defaults");
      }
    } catch (error) {
      console.error("Failed to seed defaults:", error);
      toast.error("Failed to seed defaults");
    } finally {
      setSeeding(false);
    }
  };

  const handlePurgeRegions = async () => {
    setPurging(true);
    try {
      const response = await fetch("/backend/region/purge_all_regions", {
        method: "POST",
      });
      const data = await response.json();
      if (response.ok && data.status === 200) {
        toast.success(data.message || "All regions purged");
        setSelectedRegion(null);
        setShowPurgeModal(false);
        fetchRegions();
      } else {
        toast.error(data.message || "Failed to purge regions");
      }
    } catch (error) {
      console.error("Failed to purge regions:", error);
      toast.error("Failed to purge regions");
    } finally {
      setPurging(false);
    }
  };

  // Region CRUD
  const openCreateRegionModal = () => {
    setRegionName("");
    setShowCreateRegionModal(true);
  };

  const openEditRegionModal = (region: Region) => {
    setEditingRegion(region);
    setRegionName(region.name);
  };

  const handleCreateRegion = async () => {
    if (!regionName.trim()) {
      toast.error("Region name is required");
      return;
    }
    setRegionSaving(true);
    try {
      const response = await fetch("/backend/region/create_region", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: regionName.trim() }),
      });
      const data = await response.json();
      if (response.ok && data.status === 200) {
        toast.success("Region created");
        setShowCreateRegionModal(false);
        fetchRegions();
      } else {
        toast.error(data.message || "Failed to create region");
      }
    } catch (error) {
      console.error("Failed to create region:", error);
      toast.error("Failed to create region");
    } finally {
      setRegionSaving(false);
    }
  };

  const handleUpdateRegion = async () => {
    if (!editingRegion) return;
    if (!regionName.trim()) {
      toast.error("Region name is required");
      return;
    }
    setRegionSaving(true);
    try {
      const response = await fetch("/backend/region/update_region", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          regionId: editingRegion.id,
          name: regionName.trim(),
        }),
      });
      const data = await response.json();
      if (response.ok && data.status === 200) {
        toast.success("Region updated");
        setEditingRegion(null);
        fetchRegions();
      } else {
        toast.error(data.message || "Failed to update region");
      }
    } catch (error) {
      console.error("Failed to update region:", error);
      toast.error("Failed to update region");
    } finally {
      setRegionSaving(false);
    }
  };

  const handleDeleteRegion = async () => {
    if (!deleteRegionTarget) return;
    try {
      const response = await fetch("/backend/region/delete_region", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regionId: deleteRegionTarget.id }),
      });
      const data = await response.json();
      if (response.ok && data.status === 200) {
        toast.success("Region deleted");
        setDeleteRegionTarget(null);
        if (selectedRegion?.id === deleteRegionTarget.id) {
          setSelectedRegion(null);
        }
        fetchRegions();
      } else {
        toast.error(data.message || "Failed to delete region");
      }
    } catch (error) {
      console.error("Failed to delete region:", error);
      toast.error("Failed to delete region");
    }
  };

  // Country CRUD
  const openCreateCountryModal = () => {
    setCountryName("");
    setCountryIsoCode("");
    setCountryTimezone("");
    setShowCreateCountryModal(true);
  };

  const openEditCountryModal = (country: Country) => {
    setEditingCountry(country);
    setCountryName(country.name);
    setCountryIsoCode(country.iso_code);
    setCountryTimezone(country.default_timezone);
  };

  const handleCreateCountry = async () => {
    if (!selectedRegion) return;
    if (!countryName.trim()) {
      toast.error("Country name is required");
      return;
    }
    if (!countryIsoCode.trim()) {
      toast.error("ISO code is required");
      return;
    }
    setCountrySaving(true);
    try {
      const response = await fetch("/backend/region/create_country", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: countryName.trim(),
          isoCode: countryIsoCode.trim().toUpperCase(),
          regionId: selectedRegion.id,
          defaultTimezone: countryTimezone.trim() || "",
        }),
      });
      const data = await response.json();
      if (response.ok && data.status === 200) {
        toast.success("Country created");
        setShowCreateCountryModal(false);
        fetchRegions();
      } else {
        toast.error(data.message || "Failed to create country");
      }
    } catch (error) {
      console.error("Failed to create country:", error);
      toast.error("Failed to create country");
    } finally {
      setCountrySaving(false);
    }
  };

  const handleUpdateCountry = async () => {
    if (!editingCountry || !selectedRegion) return;
    if (!countryName.trim()) {
      toast.error("Country name is required");
      return;
    }
    if (!countryIsoCode.trim()) {
      toast.error("ISO code is required");
      return;
    }
    setCountrySaving(true);
    try {
      const response = await fetch("/backend/region/update_country", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          countryId: editingCountry.id,
          name: countryName.trim(),
          isoCode: countryIsoCode.trim().toUpperCase(),
          regionId: selectedRegion.id,
          defaultTimezone: countryTimezone.trim() || "",
        }),
      });
      const data = await response.json();
      if (response.ok && data.status === 200) {
        toast.success("Country updated");
        setEditingCountry(null);
        fetchRegions();
      } else {
        toast.error(data.message || "Failed to update country");
      }
    } catch (error) {
      console.error("Failed to update country:", error);
      toast.error("Failed to update country");
    } finally {
      setCountrySaving(false);
    }
  };

  const handleDeleteCountry = async () => {
    if (!deleteCountryTarget) return;
    try {
      const response = await fetch("/backend/region/delete_country", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ countryId: deleteCountryTarget.id }),
      });
      const data = await response.json();
      if (response.ok && data.status === 200) {
        toast.success("Country deleted");
        setDeleteCountryTarget(null);
        fetchRegions();
      } else {
        toast.error(data.message || "Failed to delete country");
      }
    } catch (error) {
      console.error("Failed to delete country:", error);
      toast.error("Failed to delete country");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-kaart-orange" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Regions</h1>
          <p className="text-muted-foreground">Manage regions and countries</p>
        </div>
        <Button
          onClick={handleSeedDefaults}
          isLoading={seeding}
          variant="outline"
        >
          Seed Defaults
        </Button>
      </div>

      {/* Two-panel layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left panel: Regions list */}
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold">Regions</h2>
            <Button size="sm" onClick={openCreateRegionModal}>
              Create Region
            </Button>
          </div>

          {regions.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No regions yet. Create one or seed defaults to get started.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {regions.map((region) => (
                <Card
                  key={region.id}
                  className={`cursor-pointer transition-colors hover:border-kaart-orange/50 ${
                    selectedRegion?.id === region.id
                      ? "border-kaart-orange bg-kaart-orange/5"
                      : ""
                  }`}
                  onClick={() => setSelectedRegion(region)}
                >
                  <CardContent className="py-3 px-4 flex items-center justify-between">
                    <div>
                      <p className="font-medium">{region.name}</p>
                      <p className="text-sm text-muted-foreground">
                        <Val>{formatNumber(region.countries.length)}</Val>{" "}
                        {region.countries.length === 1
                          ? "country"
                          : "countries"}
                      </p>
                    </div>
                    <div
                      className="flex gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openEditRegionModal(region)}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => setDeleteRegionTarget(region)}
                      >
                        Delete
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Right panel: Countries in selected region */}
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold">
              {selectedRegion
                ? `Countries in ${selectedRegion.name}`
                : "Countries"}
            </h2>
            {selectedRegion && (
              <Button size="sm" onClick={openCreateCountryModal}>
                Add Country
              </Button>
            )}
          </div>

          {!selectedRegion ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Select a region to view its countries
              </CardContent>
            </Card>
          ) : selectedRegion.countries.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No countries in this region. Add one to get started.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>ISO Code</TableHead>
                      <TableHead>Timezone</TableHead>
                      <TableHead className="text-center">Users</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedRegion.countries
                      .slice(
                        (countryPage - 1) * ROWS_PER_PAGE,
                        countryPage * ROWS_PER_PAGE,
                      )
                      .map((country) => (
                        <TableRow key={country.id}>
                          <TableCell className="font-medium">
                            {country.name}
                          </TableCell>
                          <TableCell>{country.iso_code}</TableCell>
                          <TableCell className="text-muted-foreground">
                            <Val>{country.default_timezone}</Val>
                          </TableCell>
                          <TableCell className="text-center">
                            <Val>{formatNumber(country.user_count)}</Val>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openEditCountryModal(country)}
                              >
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => setDeleteCountryTarget(country)}
                              >
                                Delete
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
                {selectedRegion.countries.length > ROWS_PER_PAGE && (
                  <div className="flex items-center justify-between px-4 py-3 text-sm text-muted-foreground">
                    <span>
                      Showing {(countryPage - 1) * ROWS_PER_PAGE + 1}-
                      {Math.min(
                        countryPage * ROWS_PER_PAGE,
                        selectedRegion.countries.length,
                      )}{" "}
                      of {selectedRegion.countries.length}
                    </span>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={countryPage === 1}
                        onClick={() => setCountryPage((p) => p - 1)}
                      >
                        Previous
                      </Button>
                      <span className="flex items-center px-2">
                        Page {countryPage} of{" "}
                        {Math.ceil(
                          selectedRegion.countries.length / ROWS_PER_PAGE,
                        )}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={
                          countryPage ===
                          Math.ceil(
                            selectedRegion.countries.length / ROWS_PER_PAGE,
                          )
                        }
                        onClick={() => setCountryPage((p) => p + 1)}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Create Region Modal */}
      <Modal
        isOpen={showCreateRegionModal}
        onClose={() => setShowCreateRegionModal(false)}
        title="Create Region"
        description="Add a new region to organize countries"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setShowCreateRegionModal(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleCreateRegion} isLoading={regionSaving}>
              Create Region
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Region Name"
            placeholder="e.g. East Africa"
            value={regionName}
            onChange={(e) => setRegionName(e.target.value)}
          />
        </div>
      </Modal>

      {/* Edit Region Modal */}
      <Modal
        isOpen={!!editingRegion}
        onClose={() => setEditingRegion(null)}
        title="Edit Region"
        description={`Editing "${editingRegion?.name}"`}
        footer={
          <>
            <Button variant="outline" onClick={() => setEditingRegion(null)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateRegion} isLoading={regionSaving}>
              Save Changes
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Region Name"
            value={regionName}
            onChange={(e) => setRegionName(e.target.value)}
          />
        </div>
      </Modal>

      {/* Delete Region Confirmation */}
      <ConfirmDialog
        isOpen={!!deleteRegionTarget}
        onClose={() => setDeleteRegionTarget(null)}
        onConfirm={handleDeleteRegion}
        title="Delete Region"
        message={`Are you sure you want to delete "${deleteRegionTarget?.name}"? All countries in this region will also be removed.`}
        confirmText="Delete"
        variant="destructive"
      />

      {/* Create Country Modal */}
      <Modal
        isOpen={showCreateCountryModal}
        onClose={() => setShowCreateCountryModal(false)}
        title="Add Country"
        description={`Add a country to ${selectedRegion?.name}`}
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setShowCreateCountryModal(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleCreateCountry} isLoading={countrySaving}>
              Add Country
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Country Name"
            placeholder="e.g. Kenya"
            value={countryName}
            onChange={(e) => setCountryName(e.target.value)}
          />
          <Input
            label="ISO Code"
            placeholder="e.g. KE"
            value={countryIsoCode}
            onChange={(e) => setCountryIsoCode(e.target.value)}
          />
          <Input
            label="Default Timezone"
            placeholder="e.g. Africa/Nairobi"
            value={countryTimezone}
            onChange={(e) => setCountryTimezone(e.target.value)}
          />
        </div>
      </Modal>

      {/* Edit Country Modal */}
      <Modal
        isOpen={!!editingCountry}
        onClose={() => setEditingCountry(null)}
        title="Edit Country"
        description={`Editing "${editingCountry?.name}"`}
        footer={
          <>
            <Button variant="outline" onClick={() => setEditingCountry(null)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateCountry} isLoading={countrySaving}>
              Save Changes
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Country Name"
            value={countryName}
            onChange={(e) => setCountryName(e.target.value)}
          />
          <Input
            label="ISO Code"
            value={countryIsoCode}
            onChange={(e) => setCountryIsoCode(e.target.value)}
          />
          <Input
            label="Default Timezone"
            value={countryTimezone}
            onChange={(e) => setCountryTimezone(e.target.value)}
          />
        </div>
      </Modal>

      {/* Delete Country Confirmation */}
      <ConfirmDialog
        isOpen={!!deleteCountryTarget}
        onClose={() => setDeleteCountryTarget(null)}
        onConfirm={handleDeleteCountry}
        title="Delete Country"
        message={`Are you sure you want to delete "${deleteCountryTarget?.name}"? Users assigned to this country will be unassigned.`}
        confirmText="Delete"
        variant="destructive"
      />

      {/* Purge Confirmation */}
      <ConfirmDialog
        isOpen={showPurgeModal}
        onClose={() => setShowPurgeModal(false)}
        onConfirm={handlePurgeRegions}
        title="Purge All Regions"
        message="This will DELETE all regions, countries, and all user/project/training location assignments. Users will have their country unset. This action cannot be undone!"
        confirmText="Purge All"
        variant="destructive"
        isLoading={purging}
      />

      {/* Dev/purge tools hidden per management request 2026-05-19 —
          restore by removing the `false && (` / `)}` guard. */}
      {false && (
        <Card className="mt-8 border-dashed border-yellow-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-yellow-600">
              Dev Tools (Remove before production)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Button
              variant="destructive"
              onClick={() => setShowPurgeModal(true)}
              isLoading={purging}
            >
              Purge All Regions & Countries
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
