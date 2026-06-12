"use client";

import { useState, useCallback } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useToastActions } from "@/components/ui";

export interface EventProposal {
  id: number;
  user_id: string;
  title: string;
  event_type: string;
  event_format: string;
  start_date: string;
  end_date: string;
  city_region: string;
  venue_name: string;
  description: string;
  attendees: number;
  currency: string;
  needs_travel: boolean;
  estimated_transport_cost: number | null;
  budget_categories: string[];
  budget_amounts: Record<string, string>;
  other_expense_amount: number | null;
  cost_justification: string;
  expected_outcomes: string;
  status: string;
  submitted_at: string;
  reviewer_note: string | null;
}

interface ReviewEventProposalModalProps {
  proposal: EventProposal;
  onClose: () => void;
  onReviewed: () => void;
}

const BUDGET_LABELS: Record<string, string> = {
  accommodation: "Accommodation",
  equipment: "Equipment / Supplies",
  food: "Food & Refreshments",
  fuel: "Fuel / Transportation",
  mobile_data: "Mobile Data",
  printing: "Printing / Promo",
  venue: "Venue",
};

function formatEventType(raw: string) {
  return raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function totalBudget(proposal: EventProposal) {
  const catTotal = proposal.budget_categories.reduce((sum, cat) => {
    const n = parseFloat(proposal.budget_amounts[cat] || "0");
    return sum + (isNaN(n) ? 0 : n);
  }, 0);
  return catTotal + (proposal.other_expense_amount ?? 0);
}

export function ReviewEventProposalModal({
  proposal,
  onClose,
  onReviewed,
}: ReviewEventProposalModalProps) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const toast = useToastActions();

  const submit = useCallback(
    async (status: "approved" | "rejected") => {
      setSaving(true);
      try {
        const res = await fetch("/backend/event/update_status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            proposal_id: proposal.id,
            status,
            reviewer_note: note.trim() || null,
          }),
        });
        const data = await res.json();
        if (data.status !== 200) {
          toast.error(data.message || "Failed to update proposal");
          return;
        }
        toast.success(
          status === "approved" ? "Proposal approved" : "Proposal rejected",
        );
        onReviewed();
        onClose();
      } catch {
        toast.error("Network error. Please try again.");
      } finally {
        setSaving(false);
      }
    },
    [note, proposal.id, toast, onReviewed, onClose],
  );

  const total = totalBudget(proposal);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-background shadow-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background px-6 py-4">
          <h2 className="text-base font-semibold">{proposal.title}</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        </div>

        <div className="space-y-5 p-6">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">
              {formatEventType(proposal.event_type)}
            </Badge>
            <Badge variant="outline">
              {formatEventType(proposal.event_format)}
            </Badge>
            <Badge variant="outline">
              {formatDate(proposal.start_date)}
              {proposal.start_date !== proposal.end_date &&
                ` – ${formatDate(proposal.end_date)}`}
            </Badge>
            <Badge variant="outline">{proposal.attendees} attendees</Badge>
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Location
            </p>
            <p className="mt-0.5 text-sm">
              {proposal.venue_name}, {proposal.city_region}
            </p>
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Description
            </p>
            <p className="mt-0.5 whitespace-pre-wrap text-sm">
              {proposal.description}
            </p>
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Expected Outcomes
            </p>
            <p className="mt-0.5 whitespace-pre-wrap text-sm">
              {proposal.expected_outcomes}
            </p>
          </div>

          {proposal.needs_travel && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Travel
              </p>
              <p className="mt-0.5 text-sm">
                Estimated transport:{" "}
                <span className="font-medium">
                  {proposal.currency}{" "}
                  {proposal.estimated_transport_cost?.toFixed(2) ?? "—"}
                </span>
              </p>
            </div>
          )}

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Budget Breakdown
            </p>
            {proposal.budget_categories.length === 0 &&
            !proposal.other_expense_amount ? (
              <p className="mt-0.5 text-sm text-muted-foreground">
                No line items provided
              </p>
            ) : (
              <div className="mt-1.5 space-y-1">
                {proposal.budget_categories.map((cat) => (
                  <div key={cat} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      {BUDGET_LABELS[cat] ?? cat}
                    </span>
                    <span className="font-medium tabular-nums">
                      {proposal.currency}{" "}
                      {parseFloat(
                        proposal.budget_amounts[cat] || "0",
                      ).toFixed(2)}
                    </span>
                  </div>
                ))}
                {!!proposal.other_expense_amount && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Other</span>
                    <span className="font-medium tabular-nums">
                      {proposal.currency}{" "}
                      {proposal.other_expense_amount.toFixed(2)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between border-t border-border pt-1 text-sm font-semibold">
                  <span>Total</span>
                  <span>
                    {proposal.currency} {total.toFixed(2)}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Cost Justification
            </p>
            <p className="mt-0.5 whitespace-pre-wrap text-sm">
              {proposal.cost_justification}
            </p>
          </div>

          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Reviewer Note (optional)
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Leave a note for the submitter…"
              className="mt-1.5 flex w-full resize-none rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </div>
        </div>

        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-background px-6 py-4">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => submit("rejected")}
            disabled={saving}
          >
            Reject
          </Button>
          <Button
            variant="primary"
            onClick={() => submit("approved")}
            disabled={saving}
          >
            Approve
          </Button>
        </div>
      </div>
    </div>
  );
}
