"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Select,
  Spinner,
  useToastActions,
} from "@/components/ui";
import {
  useAddAvailabilityException,
  useDeleteAvailabilityException,
  useMyAvailability,
} from "@/hooks";
import {
  MINUTES_IN_DAY,
  SLOT_MINUTES,
  addDaysToKey,
  browserTimeZone,
  formatDateKey,
  minuteLabel,
  minuteLabel12h,
  renderZone,
  todayKey,
} from "@/lib/availability";
import type { AvailabilityException, AvailabilityExceptionKind } from "@/types";

/** The backend caps a single read at 90 days; a quarter ahead is the useful
 *  window for PTO without ever hitting that ceiling. */
const WINDOW_DAYS = 89;

const KIND_OPTIONS = [
  { value: "unavailable", label: "Time off — not available" },
  { value: "available", label: "Extra hours — also available" },
];

const timeOptions = Array.from(
  { length: MINUTES_IN_DAY / SLOT_MINUTES + 1 },
  (_, i) => {
    const minute = i * SLOT_MINUTES;
    return { value: String(minute), label: minuteLabel(minute) };
  },
);

interface Props {
  /** Bumped by the parent to force a re-read after the grid is saved. */
  refreshToken?: number;
}

export function AvailabilityExceptions({ refreshToken }: Props) {
  const toast = useToastActions();
  const { mutate: load, loading } = useMyAvailability();
  const { mutate: add, loading: adding } = useAddAvailabilityException();
  const { mutate: remove } = useDeleteAvailabilityException();

  const [exceptions, setExceptions] = useState<AvailabilityException[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Empty until the mount effect reads the browser zone — the first fetch
  // waits for it rather than firing once against a placeholder range and
  // again against the real one.
  const [viewerZone, setViewerZone] = useState("");
  const [date, setDate] = useState("");
  const [kind, setKind] = useState<AvailabilityExceptionKind>("unavailable");
  const [wholeDay, setWholeDay] = useState(true);
  const [startMinute, setStartMinute] = useState(String(9 * 60));
  const [endMinute, setEndMinute] = useState(String(17 * 60));
  const [note, setNote] = useState("");

  // The browser zone is only readable on the client; deriving it during
  // render would desync SSR markup from the first client paint.
  useEffect(() => {
    const zone = browserTimeZone();
    setViewerZone(zone);
    setDate((current) => current || todayKey(zone));
  }, []);

  const range = useMemo(() => {
    if (!viewerZone) return null;
    const start = todayKey(renderZone(viewerZone));
    return { start_date: start, end_date: addDaysToKey(start, WINDOW_DAYS) };
  }, [viewerZone]);

  const refresh = useCallback(async () => {
    if (!range) return;
    try {
      const res = await load(range);
      setExceptions(res?.availability?.exceptions ?? []);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoaded(true);
    }
  }, [load, range]);

  useEffect(() => {
    refresh();
  }, [refresh, refreshToken]);

  const invalidRange = !wholeDay && Number(startMinute) >= Number(endMinute);

  const onAdd = async () => {
    if (!date) {
      toast.error("Pick a date first");
      return;
    }
    if (invalidRange) {
      toast.error("The end time must be after the start time");
      return;
    }
    try {
      await add({
        date,
        kind,
        note: note.trim() || undefined,
        ...(wholeDay
          ? {}
          : {
              start_minute: Number(startMinute),
              end_minute: Number(endMinute),
            }),
      });
      toast.success(
        kind === "unavailable"
          ? `Time off added for ${formatDateKey(date)}`
          : `Extra hours added for ${formatDateKey(date)}`,
      );
      setNote("");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add");
    }
  };

  const onDelete = async (exception: AvailabilityException) => {
    setDeletingId(exception.id);
    try {
      await remove({ exception_id: exception.id });
      setExceptions((prev) => prev.filter((e) => e.id !== exception.id));
      toast.success("Exception removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove");
    } finally {
      setDeletingId(null);
    }
  };

  const sorted = useMemo(
    () =>
      [...exceptions].sort((a, b) =>
        (a.date ?? "").localeCompare(b.date ?? ""),
      ),
    [exceptions],
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Add an exception</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            One-off changes to your weekly hours — time off, or extra hours on a
            day you don&apos;t normally work. These override the grid for that
            date only.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Date</label>
              <Input
                type="date"
                value={date}
                min={range?.start_date}
                max={range?.end_date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div>
              <Select
                label="Type"
                options={KIND_OPTIONS}
                value={kind}
                onChange={(v) => setKind(v as AvailabilityExceptionKind)}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-sm font-medium mb-1.5 block">
                Note{" "}
                <span className="font-normal text-muted-foreground">
                  (optional — only you and org admins can see this)
                </span>
              </label>
              <Input
                value={note}
                maxLength={200}
                placeholder="Vacation, appointment, holiday…"
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={wholeDay}
                onChange={(e) => setWholeDay(e.target.checked)}
                className="h-4 w-4 accent-[var(--kaart-orange)]"
              />
              Whole day
            </label>

            {!wholeDay && (
              <>
                <div className="w-32">
                  <Select
                    label="From"
                    options={timeOptions}
                    value={startMinute}
                    onChange={setStartMinute}
                  />
                </div>
                <div className="w-32">
                  <Select
                    label="To"
                    options={timeOptions}
                    value={endMinute}
                    onChange={setEndMinute}
                  />
                </div>
              </>
            )}

            <Button
              onClick={onAdd}
              isLoading={adding}
              disabled={!date || invalidRange}
              className="ml-auto"
            >
              Add exception
            </Button>
          </div>

          {invalidRange && (
            <p className="text-sm text-destructive">
              The end time must be after the start time.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">
            Upcoming exceptions
            {sorted.length > 0 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                next {WINDOW_DAYS + 1} days
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading && !loaded ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : loadError ? (
            <div className="py-6 text-center space-y-3">
              <p className="text-sm text-muted-foreground">{loadError}</p>
              <Button variant="outline" onClick={refresh}>
                Try again
              </Button>
            </div>
          ) : sorted.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No exceptions coming up. Your weekly grid applies as-is.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {sorted.map((exception) => {
                const partial =
                  exception.start_minute !== null &&
                  exception.end_minute !== null;
                return (
                  <li
                    key={exception.id}
                    className="flex items-center gap-3 py-3"
                  >
                    <Badge
                      variant={
                        exception.kind === "unavailable"
                          ? "destructive"
                          : "success"
                      }
                    >
                      {exception.kind === "unavailable" ? "Off" : "Extra"}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">
                        {exception.date ? formatDateKey(exception.date) : "—"}
                        <span className="ml-2 font-normal text-muted-foreground">
                          {partial
                            ? `${minuteLabel12h(exception.start_minute!)} – ${minuteLabel12h(
                                exception.end_minute!,
                              )}`
                            : "all day"}
                        </span>
                      </div>
                      {exception.note && (
                        <div className="truncate text-xs text-muted-foreground">
                          {exception.note}
                        </div>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      isLoading={deletingId === exception.id}
                      onClick={() => onDelete(exception)}
                    >
                      Remove
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
