"use client";

import { useEffect, useState } from "react";
import { Modal, Button, Input, useToastActions } from "@/components/ui";

interface Country {
  id: number;
  name: string;
  iso_code: string;
  default_timezone: string;
}

interface Region {
  id: number;
  name: string;
}

interface EditCountryModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The country being edited; null when the modal is closed. */
  country: Country | null;
  /** The region this country belongs to (needed to send regionId on update). */
  selectedRegion: Region | null;
  /** Called after the country is successfully updated, e.g. to refresh the list. */
  onSaved?: () => void;
}

export function EditCountryModal({
  isOpen,
  onClose,
  country,
  selectedRegion,
  onSaved,
}: EditCountryModalProps) {
  const toast = useToastActions();
  const [countryName, setCountryName] = useState("");
  const [countryIsoCode, setCountryIsoCode] = useState("");
  const [countryTimezone, setCountryTimezone] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Seed / reset fields whenever the modal (re)opens.
  useEffect(() => {
    if (isOpen) {
      setCountryName(country?.name ?? "");
      setCountryIsoCode(country?.iso_code ?? "");
      setCountryTimezone(country?.default_timezone ?? "");
    }
  }, [isOpen, country]);

  const handleSubmit = async () => {
    if (!country || !selectedRegion) return;
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
      const response = await fetch("/backend/region/update_country", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          countryId: country.id,
          name: countryName.trim(),
          isoCode: countryIsoCode.trim().toUpperCase(),
          regionId: selectedRegion.id,
          defaultTimezone: countryTimezone.trim() || "",
        }),
      });
      const data = await response.json();
      if (response.ok && data.status === 200) {
        toast.success("Country updated");
        onClose();
        onSaved?.();
      } else {
        toast.error(data.message || "Failed to update country");
      }
    } catch (error) {
      console.error("Failed to update country:", error);
      toast.error("Failed to update country");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Edit Country"
      description={`Editing "${country?.name ?? ""}"`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} isLoading={isSaving}>
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
  );
}
