import { describe, it, expect } from "vitest";
import {
  MINUTES_IN_DAY,
  SLOT_MINUTES,
  addDaysToKey,
  blocksToSlots,
  dateKeyInZone,
  dateKeyRange,
  hoursByDay,
  labelToMinute,
  minuteInZone,
  minuteLabel,
  minuteLabel12h,
  slotKey,
  slotsToBlocks,
  weeklyHours,
  windowToDaySegments,
} from "../availability";
import type { AvailabilityKind } from "@/types";

const block = (
  day_of_week: number,
  start_minute: number,
  end_minute: number,
  kind: AvailabilityKind = "available",
) => ({ day_of_week, start_minute, end_minute, kind });

describe("minute labels", () => {
  it("renders 24h axis ticks zero-padded", () => {
    expect(minuteLabel(0)).toBe("00:00");
    expect(minuteLabel(570)).toBe("09:30");
    expect(minuteLabel(MINUTES_IN_DAY)).toBe("24:00");
  });

  it("renders 12h prose without a redundant :00", () => {
    expect(minuteLabel12h(0)).toBe("12 AM");
    expect(minuteLabel12h(540)).toBe("9 AM");
    expect(minuteLabel12h(570)).toBe("9:30 AM");
    expect(minuteLabel12h(720)).toBe("12 PM");
    expect(minuteLabel12h(1020)).toBe("5 PM");
  });

  it("round-trips through labelToMinute", () => {
    expect(labelToMinute("09:30")).toBe(570);
    expect(labelToMinute("24:00")).toBe(1440);
    expect(labelToMinute("nope")).toBeNull();
    expect(labelToMinute("25:00")).toBeNull();
  });
});

describe("blocksToSlots", () => {
  it("paints every slot a block covers", () => {
    const slots = blocksToSlots([block(0, 9 * 60, 11 * 60)]);
    expect(slots.size).toBe(4);
    expect(slots.get(slotKey(0, 18))).toBe("available");
    expect(slots.get(slotKey(0, 21))).toBe("available");
    expect(slots.get(slotKey(0, 22))).toBeUndefined();
  });

  it("lets preferred win where the two kinds overlap", () => {
    const slots = blocksToSlots([
      block(1, 9 * 60, 17 * 60, "available"),
      block(1, 10 * 60, 12 * 60, "preferred"),
    ]);
    expect(slots.get(slotKey(1, 20))).toBe("preferred");
    expect(slots.get(slotKey(1, 18))).toBe("available");
  });

  it("keeps preferred even when the available block is applied second", () => {
    const slots = blocksToSlots([
      block(1, 10 * 60, 12 * 60, "preferred"),
      block(1, 9 * 60, 17 * 60, "available"),
    ]);
    expect(slots.get(slotKey(1, 20))).toBe("preferred");
  });
});

describe("slotsToBlocks", () => {
  it("collapses a contiguous run into one block", () => {
    const slots = blocksToSlots([block(2, 9 * 60, 17 * 60)]);
    expect(slotsToBlocks(slots)).toEqual([
      {
        day_of_week: 2,
        start_minute: 540,
        end_minute: 1020,
        kind: "available",
      },
    ]);
  });

  it("splits a run where the kind changes", () => {
    const slots = blocksToSlots([
      block(3, 9 * 60, 17 * 60, "available"),
      block(3, 10 * 60, 12 * 60, "preferred"),
    ]);
    expect(slotsToBlocks(slots)).toEqual([
      { day_of_week: 3, start_minute: 540, end_minute: 600, kind: "available" },
      { day_of_week: 3, start_minute: 600, end_minute: 720, kind: "preferred" },
      {
        day_of_week: 3,
        start_minute: 720,
        end_minute: 1020,
        kind: "available",
      },
    ]);
  });

  it("emits a preferred run once — core hours already read as available", () => {
    const slots = blocksToSlots([block(4, 9 * 60, 11 * 60, "preferred")]);
    const blocks = slotsToBlocks(slots);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("preferred");
  });

  it("splits a gap into two blocks rather than bridging it", () => {
    const slots = blocksToSlots([
      block(0, 9 * 60, 12 * 60),
      block(0, 13 * 60, 17 * 60),
    ]);
    expect(slotsToBlocks(slots)).toEqual([
      { day_of_week: 0, start_minute: 540, end_minute: 720, kind: "available" },
      {
        day_of_week: 0,
        start_minute: 780,
        end_minute: 1020,
        kind: "available",
      },
    ]);
  });

  it("never emits a block crossing midnight (the backend rejects those)", () => {
    const slots = blocksToSlots([
      block(0, 22 * 60, MINUTES_IN_DAY),
      block(1, 0, 2 * 60),
    ]);
    const blocks = slotsToBlocks(slots);
    expect(blocks).toHaveLength(2);
    for (const b of blocks) {
      expect(b.start_minute).toBeGreaterThanOrEqual(0);
      expect(b.end_minute).toBeLessThanOrEqual(MINUTES_IN_DAY);
      expect(b.start_minute).toBeLessThan(b.end_minute);
    }
  });

  it("round-trips a painted grid", () => {
    const original = [
      block(0, 9 * 60, 17 * 60),
      block(2, 8 * 60, 12 * 60, "preferred"),
      block(4, 13 * 60, 18 * 60),
    ];
    const roundTripped = slotsToBlocks(blocksToSlots(original));
    expect(blocksToSlots(roundTripped)).toEqual(blocksToSlots(original));
  });

  it("returns nothing for an empty grid", () => {
    expect(slotsToBlocks(new Map())).toEqual([]);
  });
});

describe("totals", () => {
  it("counts each painted slot once", () => {
    const slots = blocksToSlots([
      block(0, 9 * 60, 17 * 60, "available"),
      block(0, 10 * 60, 12 * 60, "preferred"),
      block(1, 9 * 60, 13 * 60),
    ]);
    expect(weeklyHours(slots)).toBe(12);
    expect(hoursByDay(slots)[0]).toBe(8);
    expect(hoursByDay(slots)[1]).toBe(4);
    expect(hoursByDay(slots)[6]).toBe(0);
  });

  it("agrees with the slot resolution", () => {
    const slots = new Map<string, AvailabilityKind>([
      [slotKey(0, 0), "available"],
    ]);
    expect(weeklyHours(slots)).toBe(SLOT_MINUTES / 60);
  });
});

describe("date keys", () => {
  it("adds days across a month boundary", () => {
    expect(addDaysToKey("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDaysToKey("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("builds an inclusive range", () => {
    expect(dateKeyRange("2026-08-20", "2026-08-23")).toEqual([
      "2026-08-20",
      "2026-08-21",
      "2026-08-22",
      "2026-08-23",
    ]);
  });

  it("returns a single key when start equals end", () => {
    expect(dateKeyRange("2026-08-20", "2026-08-20")).toEqual(["2026-08-20"]);
  });

  it("returns nothing when the range is inverted", () => {
    expect(dateKeyRange("2026-08-23", "2026-08-20")).toEqual([]);
  });
});

describe("zoned rendering of resolved UTC windows", () => {
  it("places an instant on the right local day either side of the dateline", () => {
    const iso = "2026-08-20T02:00:00+00:00";
    expect(dateKeyInZone(new Date(iso), "America/Denver")).toBe("2026-08-19");
    expect(dateKeyInZone(new Date(iso), "Asia/Manila")).toBe("2026-08-20");
    expect(minuteInZone(new Date(iso), "Asia/Manila")).toBe(10 * 60);
  });

  it("keeps a same-day window as one segment", () => {
    const segments = windowToDaySegments(
      "2026-08-20T15:00:00+00:00",
      "2026-08-20T17:00:00+00:00",
      "UTC",
    );
    expect(segments).toEqual([
      { dateKey: "2026-08-20", startMinute: 900, endMinute: 1020 },
    ]);
  });

  it("splits a window that crosses local midnight", () => {
    const segments = windowToDaySegments(
      "2026-08-20T22:00:00+00:00",
      "2026-08-21T02:00:00+00:00",
      "UTC",
    );
    expect(segments).toEqual([
      { dateKey: "2026-08-20", startMinute: 1320, endMinute: 1440 },
      { dateKey: "2026-08-21", startMinute: 0, endMinute: 120 },
    ]);
  });

  it("emits no empty tail for a window ending at local midnight", () => {
    const segments = windowToDaySegments(
      "2026-08-20T20:00:00+00:00",
      "2026-08-21T00:00:00+00:00",
      "UTC",
    );
    expect(segments).toEqual([
      { dateKey: "2026-08-20", startMinute: 1200, endMinute: 1440 },
    ]);
  });

  it("fills whole days in the middle of a long window", () => {
    const segments = windowToDaySegments(
      "2026-08-20T23:00:00+00:00",
      "2026-08-22T01:00:00+00:00",
      "UTC",
    );
    expect(segments).toHaveLength(3);
    expect(segments[1]).toEqual({
      dateKey: "2026-08-21",
      startMinute: 0,
      endMinute: 1440,
    });
  });

  it("re-anchors a window to the viewer's own day", () => {
    // 09:00–17:00 in Manila is the previous evening in Denver.
    const segments = windowToDaySegments(
      "2026-08-20T01:00:00+00:00",
      "2026-08-20T09:00:00+00:00",
      "America/Denver",
    );
    expect(segments).toEqual([
      { dateKey: "2026-08-19", startMinute: 19 * 60, endMinute: 1440 },
      { dateKey: "2026-08-20", startMinute: 0, endMinute: 3 * 60 },
    ]);
  });

  it("ignores an inverted or unparseable window", () => {
    expect(
      windowToDaySegments(
        "2026-08-20T17:00:00+00:00",
        "2026-08-20T15:00:00+00:00",
        "UTC",
      ),
    ).toEqual([]);
    expect(windowToDaySegments("nonsense", "also nonsense", "UTC")).toEqual([]);
  });
});
