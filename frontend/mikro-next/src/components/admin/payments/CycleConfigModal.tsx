"use client";

import { useEffect, useState } from "react";
import { Modal, Button, Input, Select, useToastActions } from "@/components/ui";
import { useFetchPayrollConfig, useSavePayrollConfig } from "@/hooks";

type Cadence = "monthly" | "semi_monthly" | "bi_weekly";

interface CycleConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after a successful save so the picker can refresh presets. */
  onSaved?: () => void;
}

const CADENCE_OPTIONS = [
  { value: "monthly", label: "Monthly" },
  { value: "semi_monthly", label: "Semi-monthly (1st & 16th)" },
  { value: "bi_weekly", label: "Bi-weekly (every 14 days)" },
];

export function CycleConfigModal({
  isOpen,
  onClose,
  onSaved,
}: CycleConfigModalProps) {
  const toast = useToastActions();
  const { mutate: fetchConfig, loading: loadingCfg } = useFetchPayrollConfig();
  const { mutate: saveConfig, loading: saving } = useSavePayrollConfig();

  const [cadence, setCadence] = useState<Cadence>("monthly");
  const [anchorDay, setAnchorDay] = useState("1");
  const [anchorDate, setAnchorDate] = useState("");
  const [isDefault, setIsDefault] = useState(true);

  useEffect(() => {
    if (!isOpen) return;
    fetchConfig({})
      .then((res) => {
        const c = res.config;
        setCadence(c.cadence);
        setAnchorDay(c.anchor_day != null ? String(c.anchor_day) : "1");
        setAnchorDate(c.anchor_date ?? "");
        setIsDefault(res.is_default);
      })
      .catch(() => toast.error("Failed to load payroll config"));
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSave = async () => {
    const payload: Record<string, unknown> = { cadence };
    if (cadence === "monthly") {
      const d = parseInt(anchorDay, 10);
      if (isNaN(d) || d < 1 || d > 28) {
        toast.error("Anchor day must be 1–28");
        return;
      }
      payload.anchor_day = d;
    } else if (cadence === "bi_weekly") {
      if (!anchorDate) {
        toast.error("Pick a bi-weekly anchor (period start) date");
        return;
      }
      payload.anchor_date = anchorDate;
    }
    try {
      await saveConfig(payload);
      toast.success("Payroll cadence saved");
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Configure payroll cycle"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onSave} isLoading={saving}>
            Save cadence
          </Button>
        </>
      }
    >
      {loadingCfg ? (
        <div className="p-6 text-center text-sm text-muted-foreground">
          Loading…
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Sets the default period and the picker&apos;s presets for this
            org. Admins can still pick a custom range any time.
            {isDefault && (
              <span className="ml-1 italic">
                (No cadence saved yet — showing the monthly default.)
              </span>
            )}
          </p>
          <Select
            label="Cadence"
            value={cadence}
            onChange={(v) => setCadence(v as Cadence)}
            options={CADENCE_OPTIONS}
          />
          {cadence === "monthly" && (
            <Input
              label="Anchor day of month (1–28)"
              type="number"
              min="1"
              max="28"
              value={anchorDay}
              onChange={(e) => setAnchorDay(e.target.value)}
            />
          )}
          {cadence === "bi_weekly" && (
            <Input
              label="Anchor date (a period start)"
              type="date"
              value={anchorDate}
              onChange={(e) => setAnchorDate(e.target.value)}
            />
          )}
          {cadence === "semi_monthly" && (
            <p className="text-xs text-muted-foreground">
              Periods are fixed: 1st–15th and 16th–end of month. No anchor
              needed.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
