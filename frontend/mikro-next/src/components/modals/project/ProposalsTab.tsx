"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Button,
  Badge,
  Skeleton,
  Select,
  Input,
  useToastActions,
} from "@/components/ui";
import {
  useProjectProposalsQueue,
  useApproveProjectProposal,
  useProvisionProjectProposal,
  useRequestChangesProjectProposal,
  useDeferProjectProposal,
  useDenyProjectProposal,
} from "@/hooks";
import type {
  ProjectProposal,
  ProjectProposalStatus,
} from "@/types";
import { formatDate } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────

type FilterStatus = "all" | ProjectProposalStatus;

// ── Helpers ────────────────────────────────────────────────────────────────

const STATUS_FILTER_OPTIONS: { value: FilterStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "changes_requested", label: "Changes Requested" },
  { value: "approved", label: "Approved (awaiting prov.)" },
  { value: "provisioned", label: "Provisioned" },
  { value: "deferred", label: "Deferred" },
  { value: "denied", label: "Denied" },
];

function statusBadge(status: ProjectProposalStatus) {
  switch (status) {
    case "pending":
      return (
        <Badge className="bg-yellow-500 text-white text-[10px]">Pending</Badge>
      );
    case "changes_requested":
      return (
        <Badge className="bg-orange-500 text-white text-[10px]">
          Changes Requested
        </Badge>
      );
    case "approved":
      return (
        <Badge className="bg-blue-500 text-white text-[10px]">Approved</Badge>
      );
    case "provisioned":
      return (
        <Badge variant="success" className="text-[10px]">
          Provisioned
        </Badge>
      );
    case "denied":
      return (
        <Badge variant="destructive" className="text-[10px]">
          Denied
        </Badge>
      );
    case "deferred":
      return (
        <Badge variant="secondary" className="text-[10px]">
          Deferred
        </Badge>
      );
    case "withdrawn":
      return (
        <Badge variant="secondary" className="text-[10px]">
          Withdrawn
        </Badge>
      );
  }
}

// ── Provision form state ───────────────────────────────────────────────────

interface ProvisionForm {
  url: string;
  mapping_rate: string;
  validation_rate: string;
  visibility: boolean;
  payments_enabled: boolean;
}

function emptyProvisionForm(): ProvisionForm {
  return {
    url: "",
    mapping_rate: "",
    validation_rate: "",
    visibility: true,
    payments_enabled: true,
  };
}

// ── Row detail / action panel ──────────────────────────────────────────────

interface ActionPanelProps {
  proposal: ProjectProposal;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}

function ActionPanel({ proposal, onClose, onRefresh }: ActionPanelProps) {
  const toast = useToastActions();

  const { mutate: approve, loading: approving } = useApproveProjectProposal();
  const { mutate: provision, loading: provisioning } =
    useProvisionProjectProposal();
  const { mutate: requestChanges, loading: requestingChanges } =
    useRequestChangesProjectProposal();
  const { mutate: defer, loading: deferring } = useDeferProjectProposal();
  const { mutate: deny, loading: denying } = useDenyProjectProposal();

  // Note/form state
  const [reviewerNote, setReviewerNote] = useState("");
  const [noteMode, setNoteMode] = useState<
    "request_changes" | "deny" | "defer" | null
  >(null);
  const [provisionMode, setProvisionMode] = useState(false);
  const [provisionForm, setProvisionForm] = useState<ProvisionForm>(
    emptyProvisionForm(),
  );

  const isBusy = approving || provisioning || requestingChanges || deferring || denying;

  const resetForms = () => {
    setNoteMode(null);
    setReviewerNote("");
    setProvisionMode(false);
    setProvisionForm(emptyProvisionForm());
  };

  const handleApprove = async () => {
    try {
      await approve({ proposal_id: proposal.id });
      toast.success("Proposal approved.");
      resetForms();
      await onRefresh();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to approve");
    }
  };

  const handleProvision = async () => {
    if (!provisionForm.url.trim()) {
      toast.error("URL is required to provision.");
      return;
    }
    const body: Record<string, unknown> = {
      proposal_id: proposal.id,
      url: provisionForm.url.trim(),
      visibility: provisionForm.visibility,
      payments_enabled: provisionForm.payments_enabled,
    };
    if (provisionForm.mapping_rate.trim())
      body.mapping_rate = Number(provisionForm.mapping_rate);
    if (provisionForm.validation_rate.trim())
      body.validation_rate = Number(provisionForm.validation_rate);
    try {
      await provision(body);
      toast.success("Proposal provisioned.");
      resetForms();
      await onRefresh();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to provision");
    }
  };

  const handleNoteSubmit = async () => {
    if (!noteMode) return;
    if ((noteMode === "request_changes" || noteMode === "deny") && !reviewerNote.trim()) {
      toast.error("A reviewer note is required.");
      return;
    }
    try {
      if (noteMode === "request_changes") {
        await requestChanges({
          proposal_id: proposal.id,
          reviewer_note: reviewerNote,
        });
        toast.success("Changes requested.");
      } else if (noteMode === "deny") {
        await deny({
          proposal_id: proposal.id,
          reviewer_note: reviewerNote,
        });
        toast.success("Proposal denied.");
      } else if (noteMode === "defer") {
        await defer({
          proposal_id: proposal.id,
          reviewer_note: reviewerNote || undefined,
        });
        toast.success("Proposal deferred.");
      }
      resetForms();
      await onRefresh();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    }
  };

  const hasUrl = Boolean(proposal.url);

  // Which action buttons to show per status
  const showApprove =
    proposal.status === "pending" ||
    proposal.status === "changes_requested" ||
    proposal.status === "deferred";
  const showProvisionBtn =
    proposal.status === "pending" && !hasUrl
      ? false
      : proposal.status === "approved" && !hasUrl;
  const showApproveAndProvision = proposal.status === "pending" && hasUrl;
  const showRequestChanges = proposal.status === "pending";
  const showDefer = proposal.status === "pending";
  const showDeny =
    proposal.status === "pending" ||
    proposal.status === "approved" ||
    proposal.status === "changes_requested" ||
    proposal.status === "deferred";
  const noActions =
    proposal.status === "provisioned" ||
    proposal.status === "denied" ||
    proposal.status === "withdrawn";

  return (
    <div className="mt-2 rounded-md border border-border bg-muted/30 p-4 space-y-4">
      {/* Detail fields */}
      <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
        <div>
          <span className="text-muted-foreground">Submitter:</span>{" "}
          <span className="font-medium">{proposal.user_name ?? proposal.user_id}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Status:</span>{" "}
          {statusBadge(proposal.status)}
        </div>
        <div>
          <span className="text-muted-foreground">Submitted:</span>{" "}
          {formatDate(proposal.submitted_at)}
        </div>
        {proposal.reviewed_at && (
          <div>
            <span className="text-muted-foreground">Reviewed:</span>{" "}
            {formatDate(proposal.reviewed_at)}
          </div>
        )}
        {proposal.source && (
          <div>
            <span className="text-muted-foreground">Source:</span>{" "}
            <span className="uppercase">{proposal.source}</span>
          </div>
        )}
        {proposal.priority && (
          <div>
            <span className="text-muted-foreground">Priority:</span>{" "}
            {proposal.priority}
          </div>
        )}
        <div>
          <span className="text-muted-foreground">Visibility:</span>{" "}
          {proposal.visibility ? "Public" : "Private"}
        </div>
        <div>
          <span className="text-muted-foreground">Community:</span>{" "}
          {proposal.community ? "Yes" : "No"}
        </div>
        <div>
          <span className="text-muted-foreground">Payments:</span>{" "}
          {proposal.payments_enabled ? "Enabled" : "Disabled"}
        </div>
        {proposal.mapping_rate !== null && (
          <div>
            <span className="text-muted-foreground">Mapping rate:</span>{" "}
            ${proposal.mapping_rate}/task
          </div>
        )}
        {proposal.validation_rate !== null && (
          <div>
            <span className="text-muted-foreground">Validation rate:</span>{" "}
            ${proposal.validation_rate}/task
          </div>
        )}
        {proposal.url && (
          <div className="col-span-2">
            <span className="text-muted-foreground">URL:</span>{" "}
            <a
              href={proposal.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 underline break-all hover:text-blue-800"
            >
              {proposal.url}
            </a>
          </div>
        )}
        {proposal.short_name && (
          <div>
            <span className="text-muted-foreground">Short name:</span>{" "}
            {proposal.short_name}
          </div>
        )}
      </div>

      {proposal.area_description && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">
            Area description
          </p>
          <p className="text-sm whitespace-pre-wrap">{proposal.area_description}</p>
        </div>
      )}

      {proposal.reviewer_note && (
        <div className="rounded border border-amber-300 bg-amber-50 p-2 dark:border-amber-700 dark:bg-amber-950/40">
          <p className="text-xs font-medium text-amber-800 dark:text-amber-200 mb-0.5">
            Reviewer note
          </p>
          <p className="text-xs italic text-amber-700 dark:text-amber-300">
            &ldquo;{proposal.reviewer_note}&rdquo;
          </p>
        </div>
      )}

      {/* Provision form */}
      {provisionMode && (
        <div className="space-y-3 rounded border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950/30">
          <p className="text-sm font-medium">Provision project</p>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              TM4 / MapRoulette URL <span className="text-destructive">*</span>
            </label>
            <Input
              value={provisionForm.url}
              onChange={(e) =>
                setProvisionForm((f) => ({ ...f, url: e.target.value }))
              }
              placeholder="https://tasks.kaart.com/projects/1234"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Mapping rate ($/task)
              </label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={provisionForm.mapping_rate}
                onChange={(e) =>
                  setProvisionForm((f) => ({
                    ...f,
                    mapping_rate: e.target.value,
                  }))
                }
                placeholder="e.g. 0.05"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Validation rate ($/task)
              </label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={provisionForm.validation_rate}
                onChange={(e) =>
                  setProvisionForm((f) => ({
                    ...f,
                    validation_rate: e.target.value,
                  }))
                }
                placeholder="e.g. 0.07"
              />
            </div>
          </div>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={provisionForm.visibility}
                onChange={(e) =>
                  setProvisionForm((f) => ({
                    ...f,
                    visibility: e.target.checked,
                  }))
                }
                className="rounded"
              />
              Public visibility
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={provisionForm.payments_enabled}
                onChange={(e) =>
                  setProvisionForm((f) => ({
                    ...f,
                    payments_enabled: e.target.checked,
                  }))
                }
                className="rounded"
              />
              Payments enabled
            </label>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleProvision}
              isLoading={provisioning}
              disabled={isBusy}
            >
              Provision
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setProvisionMode(false)}
              disabled={isBusy}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Note form */}
      {noteMode && (
        <div className="space-y-2 rounded border border-border p-3">
          <p className="text-sm font-medium capitalize">
            {noteMode === "request_changes"
              ? "Request Changes"
              : noteMode === "deny"
              ? "Deny Proposal"
              : "Defer Proposal"}
          </p>
          <textarea
            value={reviewerNote}
            onChange={(e) => setReviewerNote(e.target.value)}
            placeholder={
              noteMode === "defer"
                ? "Optional note for the submitter..."
                : "Required: explain what needs to change..."
            }
            rows={3}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={noteMode === "deny" ? "destructive" : "primary"}
              onClick={handleNoteSubmit}
              isLoading={requestingChanges || denying || deferring}
              disabled={isBusy}
            >
              Confirm
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setNoteMode(null);
                setReviewerNote("");
              }}
              disabled={isBusy}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Action buttons */}
      {!noActions && !provisionMode && !noteMode && (
        <div className="flex flex-wrap gap-2">
          {(showApprove || showApproveAndProvision) && (
            <Button
              size="sm"
              onClick={handleApprove}
              isLoading={approving}
              disabled={isBusy}
            >
              {showApproveAndProvision ? "Approve & Provision" : "Approve"}
            </Button>
          )}
          {showProvisionBtn && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setProvisionMode(true)}
              disabled={isBusy}
            >
              Provision
            </Button>
          )}
          {showRequestChanges && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setNoteMode("request_changes")}
              disabled={isBusy}
            >
              Request Changes
            </Button>
          )}
          {showDefer && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setNoteMode("defer")}
              disabled={isBusy}
            >
              Defer
            </Button>
          )}
          {showDeny && (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setNoteMode("deny")}
              disabled={isBusy}
            >
              Deny
            </Button>
          )}
        </div>
      )}

      <div className="flex justify-end">
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function ProposalsTab({ isActive }: { isActive: boolean }) {
  const toast = useToastActions();
  const { mutate: fetchQueue, loading: fetching } = useProjectProposalsQueue();

  const [proposals, setProposals] = useState<ProjectProposal[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const loadQueue = useCallback(async () => {
    try {
      const body: Record<string, string> = {};
      if (statusFilter !== "all") body.status = statusFilter;
      const resp = await fetchQueue(body);
      setProposals(resp?.proposals ?? []);
    } catch (err) {
      setProposals([]);
      const message = err instanceof Error ? err.message : "Failed to load proposals";
      toast.error(message);
    }
  }, [fetchQueue, statusFilter, toast]);

  // Load when tab becomes active or filter changes.
  useEffect(() => {
    if (isActive) {
      setProposals(null);
      loadQueue();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, statusFilter]);

  // Re-fetch without wiping the list (post-mutation refresh).
  const handleRefresh = useCallback(async () => {
    await loadQueue();
  }, [loadQueue]);

  const handleRowClick = (id: number) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const isEmpty = !fetching && proposals !== null && proposals.length === 0;

  return (
    <div className="space-y-4 p-4">
      {/* Filter bar */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">
          Filter by status:
        </label>
        <Select
          options={STATUS_FILTER_OPTIONS}
          value={statusFilter}
          onChange={(v) => {
            setStatusFilter(v as FilterStatus);
            setExpandedId(null);
          }}
          className="w-56"
        />
      </div>

      {/* Content */}
      {fetching && proposals === null ? (
        <div className="space-y-3">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : isEmpty ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No proposals match this filter.
        </p>
      ) : (
        <div className="space-y-2">
          {(proposals ?? []).map((proposal) => {
            const isExpanded = expandedId === proposal.id;
            const hasUrl = Boolean(proposal.url);
            const displayName =
              proposal.proposed_name || proposal.short_name || `Proposal #${proposal.id}`;

            return (
              <div
                key={proposal.id}
                className="rounded-md border border-border bg-card"
              >
                {/* Row header — always visible, clickable to expand */}
                <button
                  type="button"
                  className="w-full flex items-start justify-between gap-3 p-3 text-left hover:bg-accent/30 transition-colors rounded-md"
                  onClick={() => handleRowClick(proposal.id)}
                  aria-expanded={isExpanded}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-0.5">
                      <span className="font-medium truncate">{displayName}</span>
                      {statusBadge(proposal.status)}
                      {hasUrl ? (
                        <Badge className="bg-blue-100 text-blue-700 border border-blue-200 text-[10px] dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800">
                          Auto-provision on approve
                        </Badge>
                      ) : (
                        <Badge className="bg-amber-100 text-amber-700 border border-amber-200 text-[10px] dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800">
                          Set up in TM4/MR first
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                      <span>
                        {proposal.user_name ?? proposal.user_id}
                      </span>
                      {proposal.area_description && (
                        <span className="truncate max-w-xs">
                          {proposal.area_description}
                        </span>
                      )}
                      <span>Submitted {formatDate(proposal.submitted_at)}</span>
                      {proposal.url && (
                        <a
                          href={proposal.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Link
                        </a>
                      )}
                    </div>
                  </div>
                  <span className="flex-shrink-0 text-muted-foreground text-xs mt-1">
                    {isExpanded ? "▲" : "▼"}
                  </span>
                </button>

                {/* Expanded detail + actions */}
                {isExpanded && (
                  <div className="px-3 pb-3">
                    <ActionPanel
                      proposal={proposal}
                      onClose={() => setExpandedId(null)}
                      onRefresh={handleRefresh}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
