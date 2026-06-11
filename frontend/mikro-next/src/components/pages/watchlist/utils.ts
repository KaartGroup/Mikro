export type WatchlistEntry = {
  id: number;
  osm_username: string;
  osm_uid?: number;
  notes?: string;
  tags?: string[];
  added_by: string;
  added_by_name?: string;
  created_at: string;
  cached_total_changesets?: number;
  cached_last_active?: string;
  cached_account_created?: string;
  cache_updated_at?: string;
};

/**
 * Filter watchlist entries by a free-text term. Matches against the OSM
 * username, notes, and tags (joined with spaces). Case-insensitive; the term
 * is trimmed. An empty term returns all entries.
 */
export function filterWatchlist(
  entries: WatchlistEntry[],
  term: string,
): WatchlistEntry[] {
  const s = term.trim().toLowerCase();
  if (!s) return entries;
  return entries.filter(
    (p) =>
      p.osm_username.toLowerCase().includes(s) ||
      (p.notes || "").toLowerCase().includes(s) ||
      (p.tags || []).join(" ").toLowerCase().includes(s),
  );
}

/**
 * Sort watchlist entries by the given key/direction. Returns a NEW array;
 * the input is never mutated. Mirrors the original Friends/Punks page switch.
 */
export function sortWatchlist(
  entries: WatchlistEntry[],
  sortKey: string,
  sortDir: "asc" | "desc",
): WatchlistEntry[] {
  const dir = sortDir === "asc" ? 1 : -1;
  return [...entries].sort((a, b) => {
    let aVal: string | number = "";
    let bVal: string | number = "";
    switch (sortKey) {
      case "username":
        aVal = a.osm_username.toLowerCase();
        bVal = b.osm_username.toLowerCase();
        break;
      case "added_by":
        aVal = (a.added_by_name || "").toLowerCase();
        bVal = (b.added_by_name || "").toLowerCase();
        break;
      case "created_at":
        aVal = a.created_at || "";
        bVal = b.created_at || "";
        break;
      case "last_active":
        aVal = a.cached_last_active || "";
        bVal = b.cached_last_active || "";
        if (!aVal && !bVal) return 0;
        if (!aVal) return 1;
        if (!bVal) return -1;
        break;
      case "changesets":
        aVal = a.cached_total_changesets ?? 0;
        bVal = b.cached_total_changesets ?? 0;
        break;
      default:
        return 0;
    }
    if (aVal < bVal) return -1 * dir;
    if (aVal > bVal) return 1 * dir;
    return 0;
  });
}

/**
 * Count entries that were active within the 7 days preceding `now`.
 * Entries without a cached_last_active are excluded.
 */
export function countActiveLast7Days(
  entries: WatchlistEntry[],
  now: Date,
): number {
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  return entries.filter(
    (p) =>
      p.cached_last_active && new Date(p.cached_last_active) >= sevenDaysAgo,
  ).length;
}

/**
 * The entry with the most cached changesets (missing → 0). Null if empty.
 */
export function mostActiveEntry(
  entries: WatchlistEntry[],
): WatchlistEntry | null {
  if (entries.length === 0) return null;
  return entries.reduce<WatchlistEntry | null>((best, p) => {
    if (!best) return p;
    return (p.cached_total_changesets ?? 0) >
      (best.cached_total_changesets ?? 0)
      ? p
      : best;
  }, null);
}
