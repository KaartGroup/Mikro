"use client";

import { useState, useEffect } from "react";
import {
  Modal,
  Button,
  Input,
  Select,
  useToastActions,
} from "@/components/ui";
import {
  useSubmitProjectProposal,
  useResubmitProjectProposal,
} from "@/hooks";
import type { ProjectProposal, SubmitProposalBody } from "@/types";

const PRIORITY_OPTIONS = [
  { value: "Low", label: "Low" },
  { value: "Medium", label: "Medium" },
  { value: "High", label: "High" },
  { value: "Critical", label: "Critical" },
];

interface ProposeProjectModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  /** When provided, the modal acts as an "Edit & Resubmit" form. */
  resubmitProposal?: ProjectProposal;
}

export function ProposeProjectModal({
  open,
  onClose,
  onSuccess,
  resubmitProposal,
}: ProposeProjectModalProps) {
  const toast = useToastActions();
  const { mutate: submitProposal } = useSubmitProjectProposal();
  const { mutate: resubmitMutate } = useResubmitProjectProposal();

  // Form state
  const [url, setUrl] = useState("");
  const [proposedName, setProposedName] = useState("");
  const [areaDescription, setAreaDescription] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [mappingRate, setMappingRate] = useState("");
  const [validationRate, setValidationRate] = useState("");
  const [visibility, setVisibility] = useState(true);
  const [community, setCommunity] = useState(false);
  const [paymentsEnabled, setPaymentsEnabled] = useState(false);
  const [priority, setPriority] = useState("Medium");

  const [areaError, setAreaError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isResubmit = !!resubmitProposal;

  // Populate fields when editing an existing proposal
  useEffect(() => {
    if (open && resubmitProposal) {
      setUrl(resubmitProposal.url ?? "");
      setProposedName(resubmitProposal.proposed_name ?? "");
      setAreaDescription(resubmitProposal.area_description ?? "");
      setMappingRate(
        resubmitProposal.mapping_rate != null
          ? String(resubmitProposal.mapping_rate)
          : "",
      );
      setValidationRate(
        resubmitProposal.validation_rate != null
          ? String(resubmitProposal.validation_rate)
          : "",
      );
      setVisibility(resubmitProposal.visibility);
      setCommunity(resubmitProposal.community);
      setPaymentsEnabled(resubmitProposal.payments_enabled);
      setPriority(resubmitProposal.priority ?? "Medium");
      setAdvancedOpen(false);
    } else if (open && !resubmitProposal) {
      // Reset for a fresh submission
      setUrl("");
      setProposedName("");
      setAreaDescription("");
      setMappingRate("");
      setValidationRate("");
      setVisibility(true);
      setCommunity(false);
      setPaymentsEnabled(false);
      setPriority("Medium");
      setAdvancedOpen(false);
    }
    setAreaError("");
  }, [open, resubmitProposal]);

  const validate = (): boolean => {
    if (!url.trim() && !areaDescription.trim()) {
      setAreaError(
        "Area description & justification is required when no URL is provided.",
      );
      return false;
    }
    setAreaError("");
    return true;
  };

  const buildBody = (): SubmitProposalBody => {
    const body: SubmitProposalBody = {};
    if (url.trim()) body.url = url.trim();
    if (proposedName.trim()) body.proposed_name = proposedName.trim();
    if (areaDescription.trim()) body.area_description = areaDescription.trim();
    const mr = parseFloat(mappingRate);
    if (!isNaN(mr)) body.mapping_rate = mr;
    const vr = parseFloat(validationRate);
    if (!isNaN(vr)) body.validation_rate = vr;
    body.visibility = visibility;
    body.community = community;
    body.payments_enabled = paymentsEnabled;
    body.priority = priority;
    return body;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    try {
      if (isResubmit && resubmitProposal) {
        await resubmitMutate({
          proposal_id: resubmitProposal.id,
          ...(buildBody() as Record<string, unknown>),
        });
        toast.success("Proposal resubmitted successfully.");
      } else {
        await submitProposal(buildBody() as Record<string, unknown>);
        toast.success("Proposal submitted.");
      }
      onSuccess();
      onClose();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to submit proposal";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={isResubmit ? "Edit & Resubmit Proposal" : "Propose a Project"}
      description={
        isResubmit
          ? "Update your proposal and resubmit it for review."
          : "Request a new project to be added to Mikro."
      }
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            disabled={submitting}
            isLoading={submitting}
          >
            {isResubmit ? "Resubmit" : "Submit Proposal"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* URL field */}
        <div>
          <label className="mb-1.5 block text-sm font-medium">
            TM4 / MapRoulette URL{" "}
            <span className="text-muted-foreground font-normal">(optional)</span>
          </label>
          <Input
            type="url"
            placeholder="https://tasks.kaart.com/projects/123"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            Have a Tasking Manager or MapRoulette project ready? Paste its link
            and it will be provisioned automatically once approved. Leave blank
            if you&apos;d like to describe an area for an admin to set up.
          </p>
        </div>

        {/* Proposed name */}
        <div>
          <label className="mb-1.5 block text-sm font-medium">
            Proposed project name{" "}
            <span className="text-muted-foreground font-normal">(optional)</span>
          </label>
          <Input
            type="text"
            placeholder="e.g. Downtown Portland Buildings"
            value={proposedName}
            onChange={(e) => setProposedName(e.target.value)}
          />
        </div>

        {/* Area description */}
        <div>
          <label className="mb-1.5 block text-sm font-medium">
            Area description &amp; justification{" "}
            {!url.trim() && <span className="text-red-500">*</span>}
            {url.trim() && (
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
            )}
          </label>
          <textarea
            className={`w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring ${
              areaError ? "border-destructive focus:ring-destructive" : "border-border"
            }`}
            rows={4}
            placeholder="Describe the geographic area, the type of mapping needed, and why this project should be prioritized."
            value={areaDescription}
            onChange={(e) => {
              setAreaDescription(e.target.value);
              if (areaError && e.target.value.trim()) setAreaError("");
            }}
          />
          {areaError && (
            <p className="mt-1 text-sm text-destructive">{areaError}</p>
          )}
        </div>

        {/* Advanced section */}
        <div className="border border-border rounded-md">
          <button
            type="button"
            className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-foreground hover:bg-accent/50 transition-colors rounded-md"
            onClick={() => setAdvancedOpen((prev) => !prev)}
          >
            <span>Advanced options</span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`transition-transform ${advancedOpen ? "rotate-180" : ""}`}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {advancedOpen && (
            <div className="px-4 pb-4 pt-1 space-y-4 border-t border-border">
              {/* Rates */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium">
                    Mapping rate ($/task)
                  </label>
                  <Input
                    type="number"
                    min="0"
                    step="0.001"
                    placeholder="e.g. 0.025"
                    value={mappingRate}
                    onChange={(e) => setMappingRate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">
                    Validation rate ($/task)
                  </label>
                  <Input
                    type="number"
                    min="0"
                    step="0.001"
                    placeholder="e.g. 0.015"
                    value={validationRate}
                    onChange={(e) => setValidationRate(e.target.value)}
                  />
                </div>
              </div>

              {/* Priority */}
              <Select
                label="Priority"
                options={PRIORITY_OPTIONS}
                value={priority}
                onChange={setPriority}
              />

              {/* Toggles */}
              <div className="space-y-3">
                <ToggleRow
                  label="Visible to mappers"
                  description="Project appears in mapper project lists."
                  checked={visibility}
                  onChange={setVisibility}
                />
                <ToggleRow
                  label="Community project"
                  description="Visible to community (non-Kaart) mappers."
                  checked={community}
                  onChange={setCommunity}
                />
                <ToggleRow
                  label="Payments enabled"
                  description="Mappers earn compensation for tasks on this project."
                  checked={paymentsEnabled}
                  onChange={setPaymentsEnabled}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${
          checked ? "bg-kaart-orange" : "bg-muted"
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}
