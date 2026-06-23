"use client";

import { useState, useEffect } from "react";
import {
  Modal,
  Button,
  Input,
  // Select, // advanced options hidden — re-enable when advanced section is restored
  useToastActions,
} from "@/components/ui";
import {
  useSubmitProjectProposal,
  useResubmitProjectProposal,
} from "@/hooks";
import type { ProjectProposal, SubmitProposalBody } from "@/types";

// const PRIORITY_OPTIONS = [
//   { value: "Low", label: "Low" },
//   { value: "Medium", label: "Medium" },
//   { value: "High", label: "High" },
//   { value: "Critical", label: "Critical" },
// ];

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
  // Advanced options hidden — payment/config fields are admin-only:
  // const [advancedOpen, setAdvancedOpen] = useState(false);
  // const [mappingRate, setMappingRate] = useState("");
  // const [validationRate, setValidationRate] = useState("");
  // const [visibility, setVisibility] = useState(true);
  // const [community, setCommunity] = useState(false);
  // const [paymentsEnabled, setPaymentsEnabled] = useState(false);
  // const [priority, setPriority] = useState("Medium");

  const [areaError, setAreaError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isResubmit = !!resubmitProposal;

  // Populate fields when editing an existing proposal
  useEffect(() => {
    if (open && resubmitProposal) {
      setUrl(resubmitProposal.url ?? "");
      setProposedName(resubmitProposal.proposed_name ?? "");
      setAreaDescription(resubmitProposal.area_description ?? "");
      // advanced fields omitted — restored by admin on review
    } else if (open && !resubmitProposal) {
      // Reset for a fresh submission
      setUrl("");
      setProposedName("");
      setAreaDescription("");
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
    // Advanced fields omitted — set by admins during review:
    // body.mapping_rate, body.validation_rate, body.visibility,
    // body.community, body.payments_enabled, body.priority
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

        {/* Advanced options section hidden — payment/config fields are admin-only.
            Restore when user-facing advanced options are approved.
        <div className="border border-border rounded-md">
          ...
        </div> */}
      </div>
    </Modal>
  );
}

// ToggleRow hidden with advanced section — restore when advanced options are re-enabled.
// function ToggleRow({ label, description, checked, onChange }: {
//   label: string; description: string; checked: boolean; onChange: (v: boolean) => void;
// }) { ... }
