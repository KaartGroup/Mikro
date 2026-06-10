"use client";

import { useEffect, useState } from "react";
import { Modal, Button, Input, useToastActions } from "@/components/ui";

interface Region {
  id: number;
  name: string;
}

interface CreateCountryModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The region to add the country to; the modal is only openable when a region is selected. */
  selectedRegion: Region | null;
  /** Called after a country is successfully created, e.g. to refresh the list. */
  onCreated?: () => void;
}

export function CreateCountryModal({
  isOpen,
  onClose,
  selectedRegion,
  onCreated,
}: CreateCountryModalProps) {
  const toast = useToastActions();
  const [countryName, setCountryName] = useState("");
  const [countryIsoCode, setCountryIsoCode] = useState("");
  const [countryTimezone, setCountryTimezone] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Reset fields whenever the modal (re)opens.
  useEffect(() => {
    if (isOpen) {
      setCountryName("");
      setCountryIsoCode("");
      setCountryTimezone("");
    }
  }, [isOpen]);

  const handleSubmit = async () => {
    if (!selectedRegion) return;
    if (!countryName.trim()) {
      toast.error("Country name is required");
      return;
    }
    if (!countryIsoCode.trim()) {
      toast.error("ISO code is required");
      return;
    }
    setIsSaving(true);
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
        onClose();
        onCreated?.();
      } else {
        toast.error(data.message || "Failed to create country");
      }
    } catch (error) {
      console.error("Failed to create country:", error);
      toast.error("Failed to create country");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add Country"
      description={`Add a country to ${selectedRegion?.name ?? ""}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} isLoading={isSaving}>
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
  );
}
