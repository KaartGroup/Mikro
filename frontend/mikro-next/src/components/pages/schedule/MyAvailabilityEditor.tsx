"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Spinner,
  useToastActions,
} from "@/components/ui";
import { useMyAvailability, useSetMyAvailability } from "@/hooks";
import { ROUTES } from "@/lib/routes";
import {
  DAY_LABELS,
  DAY_LABELS_FULL,
  SLOTS_PER_DAY,
  SLOT_MINUTES,
  blocksToSlots,
  hoursByDay,
  minuteLabel,
  slotKey,
  slotsToBlocks,
  weeklyHours,
} from "@/lib/availability";
import { timeZoneLabel } from "@/lib/timeTracking";
import type { AvailabilityKind, UserAvailability } from "@/types";

/** Rows rendered on the grid. Nights are collapsed behind a toggle — a
 *  full 24h × 7 grid at 30min is 336 cells of mostly-empty space. */
const DAY_START_SLOT = 12; // 06:00
const DAY_END_SLOT = 44; // 22:00

type Painted = Map<string, AvailabilityKind>;

interface Props {
  /** Called after a successful save so sibling tabs can re-read. */
  onSaved?: () => void;
}

export function MyAvailabilityEditor({ onSaved }: Props) {
  const toast = useToastActions();
  const { mutate: load, loading } = useMyAvailability();
  const { mutate: save, loading: saving } = useSetMyAvailability();

  const [availability, setAvailability] = useState<UserAvailability | null>(
    null,
  );
  const [painted, setPainted] = useState<Painted>(new Map());
  const [saved, setSaved] = useState<Painted>(new Map());
  const [isDefault, setIsDefault] = useState(false);
  const [brush, setBrush] = useState<AvailabilityKind>("available");
  const [showNights, setShowNights] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Drag state. A ref rather than state: pointer handlers fire faster than
  // React re-renders, and a stale closure would drop cells mid-drag.
  const dragMode = useRef<"paint" | "erase" | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await load({});
      const payload = res?.availability;
      if (!payload) return;
      setAvailability(payload);
      const source = payload.blocks.length
        ? payload.blocks
        : (payload.suggested_blocks ?? []);
      const next = blocksToSlots(source);
      setPainted(next);
      // The suggestion is not saved server-side, so an untouched grid must
      // still read as dirty — otherwise Save is disabled on exactly the
      // screen where a new user needs it.
      setSaved(payload.blocks.length ? new Map(next) : new Map());
      setIsDefault(Boolean(payload.is_default));
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load");
    }
  }, [load]);

  useEffect(() => {
    // `refresh` is async: every setState in it runs after an await, in the
    // response callback rather than synchronously in the effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  // End a drag no matter where the pointer is released.
  useEffect(() => {
    const stop = () => {
      dragMode.current = null;
    };
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, []);

  const slotRange = useMemo(() => {
    const start = showNights ? 0 : DAY_START_SLOT;
    const end = showNights ? SLOTS_PER_DAY : DAY_END_SLOT;
    return Array.from({ length: end - start }, (_, i) => start + i);
  }, [showNights]);

  const dirty = useMemo(() => {
    if (painted.size !== saved.size) return true;
    for (const [key, kind] of painted) {
      if (saved.get(key) !== kind) return true;
    }
    return false;
  }, [painted, saved]);

  const applyCell = useCallback(
    (day: number, slot: number, mode: "paint" | "erase") => {
      setPainted((prev) => {
        const key = slotKey(day, slot);
        const current = prev.get(key);
        if (mode === "erase" ? current === undefined : current === brush) {
          return prev;
        }
        const next = new Map(prev);
        if (mode === "erase") next.delete(key);
        else next.set(key, brush);
        return next;
      });
    },
    [brush],
  );

  const startDrag = (day: number, slot: number) => {
    // Painting over a cell that already holds the brush kind erases it, so
    // one gesture both adds and removes without a separate eraser tool.
    const mode = painted.get(slotKey(day, slot)) === brush ? "erase" : "paint";
    dragMode.current = mode;
    applyCell(day, slot, mode);
  };

  const enterCell = (day: number, slot: number) => {
    if (dragMode.current) applyCell(day, slot, dragMode.current);
  };

  /** Slots covering 09:00–17:00, the shape both bulk actions fill with. */
  const NINE_TO_FIVE = {
    first: (9 * 60) / SLOT_MINUTES,
    last: (17 * 60) / SLOT_MINUTES,
  };

  const setWholeDay = (day: number, fill: boolean) => {
    setPainted((prev) => {
      const next = new Map(prev);
      for (let slot = 0; slot < SLOTS_PER_DAY; slot++) {
        const key = slotKey(day, slot);
        if (!fill) next.delete(key);
        else if (slot >= NINE_TO_FIVE.first && slot < NINE_TO_FIVE.last) {
          next.set(key, brush);
        }
      }
      return next;
    });
  };

  const applyWeekdayPreset = () => {
    const next = new Map<string, AvailabilityKind>();
    for (let day = 0; day < 5; day++) {
      for (let slot = NINE_TO_FIVE.first; slot < NINE_TO_FIVE.last; slot++) {
        next.set(slotKey(day, slot), "available");
      }
    }
    setPainted(next);
  };

  const onSave = async () => {
    try {
      const blocks = slotsToBlocks(painted);
      await save({ blocks });
      setSaved(new Map(painted));
      setIsDefault(false);
      toast.success(
        blocks.length
          ? `Availability saved — ${weeklyHours(painted)}h/week`
          : "Availability cleared",
      );
      onSaved?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    }
  };

  const perDay = hoursByDay(painted);
  const zone = availability?.timezone;

  if (loading && !availability) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner />
      </div>
    );
  }

  if (loadError && !availability) {
    return (
      <Card>
        <CardContent className="py-8 text-center space-y-3">
          <p className="text-sm text-muted-foreground">
            Couldn&apos;t load your availability: {loadError}
          </p>
          <Button variant="outline" onClick={refresh}>
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {!availability?.has_timezone && (
        <Card className="border-yellow-500/40 bg-yellow-500/5">
          <CardContent className="py-4 text-sm">
            <span className="font-medium">
              No timezone set on your account.
            </span>{" "}
            Your hours will be read as UTC until you set one, so teammates will
            see them at the wrong local time.{" "}
            <Link href={ROUTES.account} className="underline font-medium">
              Set your timezone
            </Link>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="text-xl">My weekly hours</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Click or drag to paint the hours you normally work. Times are in{" "}
              <span className="font-medium text-foreground">
                {zone ? timeZoneLabel(zone) : "UTC (no timezone set)"}
              </span>{" "}
              — teammates see them converted to their own zone.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isDefault && <Badge variant="warning">Not saved yet</Badge>}
            {dirty && !isDefault && <Badge variant="secondary">Unsaved</Badge>}
            <Button onClick={onSave} isLoading={saving} disabled={!dirty}>
              Save
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Brush:</span>
            <Button
              size="sm"
              variant={brush === "available" ? "primary" : "outline"}
              onClick={() => setBrush("available")}
            >
              Available
            </Button>
            <Button
              size="sm"
              variant={brush === "preferred" ? "primary" : "outline"}
              onClick={() => setBrush("preferred")}
            >
              Core hours
            </Button>
            <span className="mx-2 h-4 w-px bg-border" aria-hidden />
            <Button size="sm" variant="ghost" onClick={applyWeekdayPreset}>
              Mon–Fri 9–5
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPainted(new Map())}
              disabled={painted.size === 0}
            >
              Clear all
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowNights((v) => !v)}
            >
              {showNights ? "Hide nights" : "Show all 24h"}
            </Button>
            <span className="ml-auto text-muted-foreground">
              <span className="font-medium text-foreground">
                {weeklyHours(painted)}h
              </span>{" "}
              / week
            </span>
          </div>

          <div className="overflow-x-auto">
            <div
              className="min-w-[640px] select-none"
              // Painting is a drag gesture; letting the browser scroll or
              // select text mid-drag makes it unusable on touch.
              style={{ touchAction: "none" }}
            >
              <div className="flex">
                <div className="w-14 shrink-0" />
                {DAY_LABELS.map((label, day) => (
                  <div key={label} className="flex-1 px-0.5 text-center">
                    <div className="text-xs font-medium">{label}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {perDay[day] ? `${perDay[day]}h` : "—"}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-1">
                {slotRange.map((slot) => {
                  const minute = slot * SLOT_MINUTES;
                  const onHour = minute % 60 === 0;
                  return (
                    <div key={slot} className="flex items-stretch">
                      <div className="w-14 shrink-0 pr-2 text-right">
                        {onHour && (
                          <span className="text-[10px] leading-[18px] text-muted-foreground">
                            {minuteLabel(minute)}
                          </span>
                        )}
                      </div>
                      {DAY_LABELS.map((label, day) => {
                        const kind = painted.get(slotKey(day, slot));
                        return (
                          <button
                            key={`${label}-${slot}`}
                            type="button"
                            aria-label={`${DAY_LABELS_FULL[day]} ${minuteLabel(minute)}${
                              kind ? ` — ${kind}` : ""
                            }`}
                            aria-pressed={Boolean(kind)}
                            onPointerDown={(e) => {
                              e.preventDefault();
                              startDrag(day, slot);
                            }}
                            onPointerEnter={() => enterCell(day, slot)}
                            className={[
                              "flex-1 mx-0.5 h-[18px] rounded-[2px] border transition-colors",
                              onHour
                                ? "border-t-border"
                                : "border-t-transparent",
                              kind === "preferred"
                                ? "bg-kaart-orange border-kaart-orange"
                                : kind === "available"
                                  ? "bg-kaart-orange/35 border-kaart-orange/40"
                                  : "bg-muted/40 border-transparent hover:bg-muted",
                            ].join(" ")}
                          />
                        );
                      })}
                    </div>
                  );
                })}
              </div>

              <div className="mt-2 flex">
                <div className="w-14 shrink-0" />
                {DAY_LABELS.map((label, day) => (
                  <div key={label} className="flex-1 px-0.5 text-center">
                    <button
                      type="button"
                      onClick={() => setWholeDay(day, perDay[day] === 0)}
                      className="text-[10px] text-muted-foreground hover:text-foreground underline"
                    >
                      {perDay[day] === 0 ? "fill" : "clear"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-[2px] bg-kaart-orange/35" />
              Available
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-[2px] bg-kaart-orange" />
              Core hours
            </span>
            <span>
              Core hours are the ones you&apos;d rather take meetings in.
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
