"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  ReviewEventProposalModal,
  type EventProposal,
  totalBudget,
} from "@/components/modals/event/ReviewEventProposalModal";

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

export function EventProposalsPanel() {
  const [proposals, setProposals] = useState<EventProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<EventProposal | null>(null);

  const fetchProposals = useCallback(async () => {
    try {
      const res = await fetch("/backend/event/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "pending" }),
      });
      const data = await res.json();
      if (data.status === 200) {
        setProposals(data.proposals);
      }
    } catch {
      // silently fail — panel stays empty
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProposals();
  }, [fetchProposals]);

  if (loading) return null;
  if (proposals.length === 0) return null;

  return (
    <>
      <Card className="border-yellow-500/40 bg-yellow-500/5">
        <CardContent className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inset-0 animate-ping rounded-full bg-yellow-500 opacity-75" />
              <span className="relative h-2.5 w-2.5 rounded-full bg-yellow-500" />
            </span>
            <h2 className="text-sm font-semibold">Pending Event Proposals</h2>
            <Badge variant="warning">{proposals.length}</Badge>
          </div>

          <div className="space-y-2">
            {proposals.map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-background p-3 text-sm"
              >
                <div className="flex min-w-[180px] flex-col">
                  <span className="font-medium">{p.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatEventType(p.event_type)} ·{" "}
                    {formatEventType(p.event_format)}
                  </span>
                </div>
                <div className="flex min-w-[140px] flex-col">
                  <span className="text-xs text-muted-foreground">
                    {p.city_region}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(p.start_date)}
                    {p.start_date !== p.end_date &&
                      ` – ${formatDate(p.end_date)}`}
                  </span>
                </div>
                <div className="text-xs font-mono tabular-nums">
                  {p.currency} {totalBudget(p).toFixed(2)}
                </div>
                <span className="text-xs text-muted-foreground">
                  {p.attendees} attendees
                </span>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setSelected(p)}
                  className="ml-auto whitespace-nowrap"
                >
                  Review
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {selected && (
        <ReviewEventProposalModal
          proposal={selected}
          onClose={() => setSelected(null)}
          onReviewed={fetchProposals}
        />
      )}
    </>
  );
}
