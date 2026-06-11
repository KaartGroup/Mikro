import { describe, it, expect } from "vitest";
import {
  filterWatchlist,
  sortWatchlist,
  countActiveLast7Days,
  mostActiveEntry,
  type WatchlistEntry,
} from "./utils";

function make(overrides: Partial<WatchlistEntry>): WatchlistEntry {
  return {
    id: overrides.id ?? 1,
    osm_username: overrides.osm_username ?? "user",
    added_by: overrides.added_by ?? "admin",
    created_at: overrides.created_at ?? "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("filterWatchlist", () => {
  const entries: WatchlistEntry[] = [
    make({
      id: 1,
      osm_username: "AliceMapper",
      notes: "great work",
      tags: ["helpful"],
    }),
    make({
      id: 2,
      osm_username: "BobBuilder",
      notes: "watch closely",
      tags: ["vandal", "revert-war"],
    }),
  ];

  it("matches on username (case-insensitive)", () => {
    const res = filterWatchlist(entries, "alice");
    expect(res.map((e) => e.id)).toEqual([1]);
  });

  it("matches on notes", () => {
    const res = filterWatchlist(entries, "closely");
    expect(res.map((e) => e.id)).toEqual([2]);
  });

  it("matches on tags", () => {
    const res = filterWatchlist(entries, "revert-war");
    expect(res.map((e) => e.id)).toEqual([2]);
  });

  it("is case-insensitive and trims the term", () => {
    const res = filterWatchlist(entries, "  BOBBUILDER  ");
    expect(res.map((e) => e.id)).toEqual([2]);
  });

  it("returns all entries for an empty term", () => {
    expect(filterWatchlist(entries, "")).toHaveLength(2);
    expect(filterWatchlist(entries, "   ")).toHaveLength(2);
  });

  it("returns [] when nothing matches", () => {
    expect(filterWatchlist(entries, "nobody")).toEqual([]);
  });
});

describe("sortWatchlist", () => {
  it("sorts by username ascending and descending", () => {
    const entries: WatchlistEntry[] = [
      make({ id: 1, osm_username: "Charlie" }),
      make({ id: 2, osm_username: "alice" }),
      make({ id: 3, osm_username: "Bob" }),
    ];
    expect(sortWatchlist(entries, "username", "asc").map((e) => e.id)).toEqual([
      2, 3, 1,
    ]);
    expect(sortWatchlist(entries, "username", "desc").map((e) => e.id)).toEqual(
      [1, 3, 2],
    );
  });

  it("sorts by changesets numerically (desc)", () => {
    const entries: WatchlistEntry[] = [
      make({ id: 1, cached_total_changesets: 9 }),
      make({ id: 2, cached_total_changesets: 100 }),
      make({ id: 3, cached_total_changesets: 50 }),
    ];
    expect(
      sortWatchlist(entries, "changesets", "desc").map((e) => e.id),
    ).toEqual([2, 3, 1]);
  });

  it("sorts rows missing cached_last_active LAST in both directions", () => {
    const entries: WatchlistEntry[] = [
      make({ id: 1, cached_last_active: "2026-01-01T00:00:00Z" }),
      make({ id: 2 }), // no cached_last_active
      make({ id: 3, cached_last_active: "2026-06-01T00:00:00Z" }),
    ];
    const asc = sortWatchlist(entries, "last_active", "asc");
    expect(asc[asc.length - 1].id).toBe(2);
    const desc = sortWatchlist(entries, "last_active", "desc");
    expect(desc[desc.length - 1].id).toBe(2);
  });

  it("does not mutate the input array", () => {
    const entries: WatchlistEntry[] = [
      make({ id: 1, osm_username: "zeta" }),
      make({ id: 2, osm_username: "alpha" }),
    ];
    const before = entries.map((e) => e.id);
    sortWatchlist(entries, "username", "asc");
    expect(entries.map((e) => e.id)).toEqual(before);
  });
});

describe("countActiveLast7Days", () => {
  it("counts entries active within the window, excluding ones with no last_active", () => {
    const now = new Date("2026-06-10T00:00:00Z");
    const entries: WatchlistEntry[] = [
      make({ id: 1, cached_last_active: "2026-06-08T00:00:00Z" }), // inside
      make({ id: 2, cached_last_active: "2026-05-01T00:00:00Z" }), // outside
      make({ id: 3 }), // no cached_last_active → excluded
    ];
    expect(countActiveLast7Days(entries, now)).toBe(1);
  });
});

describe("mostActiveEntry", () => {
  it("picks the entry with the most changesets", () => {
    const entries: WatchlistEntry[] = [
      make({ id: 1, cached_total_changesets: 5 }),
      make({ id: 2, cached_total_changesets: 42 }),
      make({ id: 3, cached_total_changesets: 10 }),
    ];
    expect(mostActiveEntry(entries)?.id).toBe(2);
  });

  it("returns null on an empty list", () => {
    expect(mostActiveEntry([])).toBeNull();
  });

  it("treats missing changesets as 0", () => {
    const entries: WatchlistEntry[] = [
      make({ id: 1 }), // missing → 0
      make({ id: 2, cached_total_changesets: 3 }),
    ];
    expect(mostActiveEntry(entries)?.id).toBe(2);
  });
});
