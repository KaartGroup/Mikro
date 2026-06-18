"use client";

import { useState, useEffect } from "react";
import { Modal, Button, Input, Select, useToastActions } from "@/components/ui";
import { useModifyUserRole } from "@/hooks/useApi";
import { roleLabel } from "@/types";
import type { UserProfileData } from "@/types";

interface EditUserPayload {
  first_name: string;
  last_name: string;
  email: string;
  osm_username: string;
  mapillary_username: string | null;
  role: string;
  timezone: string | null;
  country_id: number | null;
  micropayments_visible: boolean;
  hourly_rate?: number | null;
  hourly_rate_start_date?: string | null;
  compensation_model: string | null;
}

interface EditUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  user: UserProfileData | null;
  canEditRole: boolean;
  viewerRole: string | undefined;
  countryOptions: { value: string; label: string }[];
  /** Called after the user is successfully saved, e.g. to refresh the profile. */
  onSaved?: () => void;
}

export function EditUserModal({
  isOpen,
  onClose,
  userId,
  user,
  canEditRole,
  viewerRole,
  countryOptions,
  onSaved,
}: EditUserModalProps) {
  const toast = useToastActions();
  const { mutate: modifyUser, loading } = useModifyUserRole();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [osmUsername, setOsmUsername] = useState("");
  const [mapillaryUsername, setMapillaryUsername] = useState("");
  const [role, setRole] = useState("user");
  const [timezone, setTimezone] = useState("");
  const [countryId, setCountryId] = useState("");
  const [paymentsVisible, setPaymentsVisible] = useState(false);
  const [hourlyRate, setHourlyRate] = useState("");
  const [hourlyRateStartDate, setHourlyRateStartDate] = useState("");
  const [compModel, setCompModel] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !user) return;
    setFirstName(user.first_name || "");
    setLastName(user.last_name || "");
    setEmail(user.email || "");
    setOsmUsername(user.osm_username || "");
    setMapillaryUsername(user.mapillary_username || "");
    setRole(user.role || "user");
    setTimezone(user.timezone || "");
    setCountryId(user.country_id ? String(user.country_id) : "");
    setPaymentsVisible(user.micropayments_visible ?? false);
    setHourlyRate(user.hourly_rate?.toString() ?? "");
    setHourlyRateStartDate(user.hourly_rate_start_date || "");
    const validCompModels = new Set<string>([
      "per_task",
      "hourly",
      "project_based",
    ]);
    setCompModel(
      user.compensation_model && validCompModels.has(user.compensation_model)
        ? user.compensation_model
        : "",
    );
  }, [isOpen, user]);

  const handleSave = async () => {
    const payload: EditUserPayload = {
      first_name: firstName,
      last_name: lastName,
      email,
      osm_username: osmUsername,
      mapillary_username: mapillaryUsername || null,
      role,
      timezone: timezone || null,
      country_id: countryId ? Number(countryId) : null,
      micropayments_visible: paymentsVisible,
      compensation_model: compModel || null,
    };

    const shouldSendHourlyRate =
      compModel !== "project_based" && hourlyRate !== "";

    if (shouldSendHourlyRate) {
      if (!hourlyRateStartDate) {
        setValidationError(
          "Effective from date is required when setting an hourly rate.",
        );
        return;
      }
      payload.hourly_rate = parseFloat(hourlyRate);
      payload.hourly_rate_start_date = hourlyRateStartDate;
    }

    setValidationError(null);
    try {
      await modifyUser({ user_id: userId, ...payload });
      toast.success("User updated");
      onClose();
      onSaved?.();
    } catch {
      toast.error("Failed to update user");
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Edit User"
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={loading}>
            {loading ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="First Name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="First name"
          />
          <Input
            label="Last Name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="Last name"
          />
        </div>
        <Input
          label="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="user@example.com"
        />
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="OSM Username"
            value={osmUsername}
            onChange={(e) => setOsmUsername(e.target.value)}
            placeholder="osm_username"
          />
          <Input
            label="Mapillary Username"
            value={mapillaryUsername}
            onChange={(e) => setMapillaryUsername(e.target.value)}
            placeholder="mapillary_username"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          {canEditRole ? (
            <Select
              label="Role"
              value={role}
              onChange={setRole}
              options={[
                { value: "user", label: roleLabel("user") },
                { value: "validator", label: roleLabel("validator") },
                { value: "team_admin", label: roleLabel("team_admin") },
                { value: "admin", label: roleLabel("admin") },
                ...(viewerRole === "super_admin"
                  ? [
                      {
                        value: "super_admin",
                        label: roleLabel("super_admin"),
                      },
                    ]
                  : []),
              ]}
            />
          ) : (
            <div>
              <label className="block text-sm font-medium mb-1">Role</label>
              <div className="w-full px-3 py-2 border border-input rounded-lg bg-muted text-sm text-muted-foreground">
                {roleLabel(role)}
                <span className="ml-2 text-xs italic">(read-only)</span>
              </div>
            </div>
          )}
          <Select
            label="Timezone"
            value={timezone}
            onChange={setTimezone}
            options={(() => {
              try {
                return Intl.supportedValuesOf("timeZone").map((tz) => ({
                  value: tz,
                  label: tz,
                }));
              } catch {
                return [];
              }
            })()}
            placeholder="Select timezone"
          />
        </div>
        <Select
          label="Country"
          value={countryId}
          onChange={setCountryId}
          options={countryOptions}
          placeholder="Select country"
        />
        <div className="flex items-center justify-between p-3 border border-border rounded-lg">
          <div>
            <p className="text-sm font-medium">Show Micropayments</p>
            <p className="text-xs text-muted-foreground">
              User can see micropayment rates, earnings, and request payouts
            </p>
          </div>
          <div
            onClick={() => setPaymentsVisible(!paymentsVisible)}
            className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
              paymentsVisible ? "bg-green-500" : "bg-muted"
            }`}
          >
            <div
              className={`w-5 h-5 rounded-full bg-white shadow absolute top-0.5 transition-transform ${
                paymentsVisible ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">
            Compensation Model
          </label>
          <select
            className="w-full px-3 py-2 border border-input rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            value={compModel}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
              setCompModel(e.target.value)
            }
          >
            <option value="">Unspecified (legacy)</option>
            <option value="per_task">Per-task (micro-paid)</option>
            <option value="hourly">Hourly</option>
            <option value="project_based">Project-based</option>
          </select>
          <p className="mt-1 text-xs text-muted-foreground">
            Unspecified behaves as before (per-task, or hourly if a rate is
            set). Project-based totals from adjustments only.
          </p>
        </div>
        {(compModel === "hourly" ||
          compModel === "" ||
          compModel === "per_task") && (
          <div>
            <label className="block text-sm font-medium mb-1">
              Hourly Rate
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              className="w-full px-3 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
              value={hourlyRate}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setHourlyRate(e.target.value);
                if (validationError) setValidationError(null);
              }}
              placeholder="Not set"
            />
            {hourlyRate && (
              <div className="mt-2">
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Effective from
                </label>
                <input
                  type="date"
                  className="w-full px-3 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring text-sm"
                  value={hourlyRateStartDate}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    setHourlyRateStartDate(e.target.value);
                    if (validationError) setValidationError(null);
                  }}
                />
                {validationError && !hourlyRateStartDate ? (
                  <p className="mt-2 text-sm text-destructive">
                    {validationError}
                  </p>
                ) : null}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
