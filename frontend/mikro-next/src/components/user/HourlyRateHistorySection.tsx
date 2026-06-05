"use client";

/**
 * Admin panel section showing a user's hourly rate history.
 *
 * Displays all time-bounded rate entries for a user, highlights the
 * currently-active one, and lets admins add or delete entries.
 * Delete is guarded server-side (cannot delete if a paid cycle overlaps).
 *
 * Usage: drop <HourlyRateHistorySection userId={user.id} /> into the
 * admin user detail page wherever the rate history tab lives.
 */

import { useEffect, useState, useCallback } from "react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  Input,
  Skeleton,
  useToastActions,
} from "@/components/ui";
import {
  useFetchHourlyRates,
  useCreateHourlyRate,
  useDeleteHourlyRate,
} from "@/hooks";
import type { HourlyRateEntry } from "@/types";

// ─── Helpers ──────────────────────────────────────────────────────────

function formatDate(s: string | null | undefined): string {
  if (!s) return "Open";
  const d = new Date(s + "T00:00:00"); // avoid UTC shift
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatRate(r: number): string {
  return r.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }) + "/hr";
}

function isActiveEntry(entry: HourlyRateEntry): boolean {
  const today = new Date().toISOString().slice(0, 10);
  const started = entry.start_date <= today;
  const notEnded = !entry.end_date || entry.end_date >= today;
  return started && notEnded;
}

// ─── Add rate form ────────────────────────────────────────────────────

interface AddRateFormProps {
  userId: string;
  onAdded: () => void;
  onCancel: () => void;
}

function AddRateForm({ userId, onAdded, onCancel }: AddRateFormProps) {
  const toast = useToastActions();
  const { mutate: createRate, loading } = useCreateHourlyRate();
  const [rate, setRate] = useState("");
  const [startDate, setStartDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [endDate, setEndDate] = useState("");
  const [notes, setNotes] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setFieldError(null);
      const rateNum = parseFloat(rate);
      if (isNaN(rateNum) || rateNum < 0) {
        setFieldError("Rate must be a non-negative number.");
        return;
      }
      if (!startDate) {
        setFieldError("Start date is required.");
        return;
      }
      if (endDate && endDate < startDate) {
        setFieldError("End date must be on or after start date.");
        return;
      }
      try {
        await createRate({
          user_id: userId,
          rate: rateNum,
          start_date: startDate,
          end_date: endDate || null,
          notes: notes.trim() || null,
        });
        toast.success("Rate entry added.");
        onAdded();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to add rate.";
        setFieldError(msg);
      }
    },
    [userId, rate, startDate, endDate, notes, createRate, toast, onAdded],
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-3 pt-2">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            Hourly Rate ($)
          </label>
          <Input
            type="number"
            min="0"
            step="0.01"
            placeholder="e.g. 25.00"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            Start Date
          </label>
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            End Date{" "}
            <span className="text-muted-foreground font-normal">(optional)</span>
          </label>
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            Notes{" "}
            <span className="text-muted-foreground font-normal">(optional)</span>
          </label>
          <Input
            type="text"
            placeholder="e.g. Annual review increase"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>
      {fieldError && (
        <p className="text-xs text-destructive">{fieldError}</p>
      )}
      <div className="flex gap-2 justify-end pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={loading}>
          {loading ? "Saving…" : "Add Rate"}
        </Button>
      </div>
    </form>
  );
}

// ─── Main section ─────────────────────────────────────────────────────

interface Props {
  userId: string;
}

export function HourlyRateHistorySection({ userId }: Props) {
  const toast = useToastActions();
  const { fetch: fetchRates, loading: fetching } = useFetchHourlyRates();
  const { deleteRate, loading: deleting } = useDeleteHourlyRate();
  const [entries, setEntries] = useState<HourlyRateEntry[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchRates(userId);
      setEntries(res.rates);
    } catch {
      // error is surfaced by the hook
    }
  }, [fetchRates, userId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = useCallback(
    async (entry: HourlyRateEntry) => {
      setDeletingId(entry.id);
      try {
        await deleteRate(entry.id, userId);
        toast.success("Rate entry deleted.");
        load();
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Could not delete rate entry.";
        toast.error(msg);
      } finally {
        setDeletingId(null);
      }
    },
    [deleteRate, userId, toast, load],
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base">Hourly Rate History</CardTitle>
        {!showForm && (
          <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>
            + Add Rate
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {showForm && (
          <AddRateForm
            userId={userId}
            onAdded={() => {
              setShowForm(false);
              load();
            }}
            onCancel={() => setShowForm(false)}
          />
        )}

        {fetching && !entries.length ? (
          <div className="space-y-2 pt-2">
            {[...Array(2)].map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground pt-2">
            No rate history. Add a rate entry above.
          </p>
        ) : (
          <div className="mt-3 divide-y divide-border">
            {entries.map((entry) => {
              const active = isActiveEntry(entry);
              return (
                <div
                  key={entry.id}
                  className="flex items-center justify-between py-2.5"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-medium text-sm">
                      {formatRate(entry.rate)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(entry.start_date)}
                      {" – "}
                      {entry.end_date ? formatDate(entry.end_date) : "Present"}
                    </span>
                    {active && (
                      <Badge variant="success" className="text-xs">
                        Active
                      </Badge>
                    )}
                    {entry.notes && (
                      <span
                        className="text-xs text-muted-foreground truncate max-w-[180px]"
                        title={entry.notes}
                      >
                        {entry.notes}
                      </span>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    disabled={deleting && deletingId === entry.id}
                    onClick={() => handleDelete(entry)}
                  >
                    {deleting && deletingId === entry.id ? "…" : "Delete"}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
