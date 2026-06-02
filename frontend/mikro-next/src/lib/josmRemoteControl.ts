/**
 * JOSM Remote-Control integration for Mikro.
 *
 * Direct adaptation of Viewer's pattern in
 * `viewer-2-0/client/src/Contexts/DataContext/index.js:1168-1208`.
 * Same probe-then-send model, same silent-fail-when-JOSM-not-running
 * behaviour, same buffered-bbox construction.
 *
 * What's different: Viewer's helper operates on a Mapillary-style
 * "picture" object (single lat/lon point). This version operates on
 * a Changeset, constructing a bbox from `centroid` and optionally
 * chaining an `/import` call that loads the changeset's actual object
 * edits as a new JOSM layer.
 *
 * Used from:
 *   - The explicit [JOSM] icon button in the changeset table
 *   - The Follow-in-JOSM row-click handler (zoom only, no import)
 */

import type { Changeset } from "@/types";

const JOSM_BASE = "http://127.0.0.1:8111";
// Buffer around the centroid when constructing a bbox. Larger than
// Viewer's image buffer (0.0007) because changesets cover bigger areas.
const BBOX_BUFFER_DEG = 0.005;

/** Seconds between /version probes. Cuts the network chatter on rapid clicks. */
const PROBE_TTL_MS = 30 * 1000;

let _probeCache: { version: number | null; fetchedAt: number } | null = null;

/**
 * Probe `/version` to confirm JOSM is running with remote-control on.
 * Returns the JOSM build number, or null if unreachable. Result is
 * cached for PROBE_TTL_MS so back-to-back clicks don't spam the probe.
 */
export async function probeJosm(): Promise<number | null> {
  const now = Date.now();
  if (_probeCache && now - _probeCache.fetchedAt < PROBE_TTL_MS) {
    return _probeCache.version;
  }
  try {
    const res = await fetch(`${JOSM_BASE}/version`);
    if (!res.ok) {
      _probeCache = { version: null, fetchedAt: now };
      return null;
    }
    const json = (await res.json()) as { version?: number };
    const version = typeof json.version === "number" ? json.version : null;
    _probeCache = { version, fetchedAt: now };
    return version;
  } catch {
    _probeCache = { version: null, fetchedAt: now };
    return null;
  }
}

function buildZoomUrl(changeset: Changeset): string | null {
  const c = changeset.centroid;
  if (!c || typeof c.lat !== "number" || typeof c.lon !== "number") return null;
  const params = new URLSearchParams({
    left: String(c.lon - BBOX_BUFFER_DEG),
    right: String(c.lon + BBOX_BUFFER_DEG),
    bottom: String(c.lat - BBOX_BUFFER_DEG),
    top: String(c.lat + BBOX_BUFFER_DEG),
    changeset_tags: "true",
  });
  return `${JOSM_BASE}/load_and_zoom?${params.toString()}`;
}

/**
 * Fire a zoom command to JOSM for this changeset's centroid. No-op
 * (returns false) if JOSM isn't running or the changeset has no
 * centroid. Idempotent — safe to call repeatedly from follow-mode.
 */
export async function zoomToChangeset(changeset: Changeset): Promise<boolean> {
  const version = await probeJosm();
  if (version === null) return false;
  const url = buildZoomUrl(changeset);
  if (!url) return false;
  try {
    await fetch(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Full "View in JOSM" flow for a changeset:
 *   1. Probe (bail if JOSM not running)
 *   2. Zoom to the changeset's centroid + buffer
 *   3. Import the changeset's actual object edits as a new layer
 *
 * Returns true on success, false on any early bail.
 */
export async function openChangesetInJosm(
  changeset: Changeset,
): Promise<boolean> {
  const version = await probeJosm();
  if (version === null) return false;

  // Step 1 — zoom (if we have a centroid)
  const zoomUrl = buildZoomUrl(changeset);
  if (zoomUrl) {
    try {
      await fetch(zoomUrl);
    } catch {
      // Zoom failed but we can still try the import
    }
  }

  // Step 2 — import the changeset as a new layer. This URL is fetched
  // BY JOSM (not by the browser) so the user sees the actual edits in
  // JOSM once it's loaded.
  const importParams = new URLSearchParams({
    url: `https://www.openstreetmap.org/api/0.6/changeset/${changeset.id}/download`,
  });
  try {
    await fetch(`${JOSM_BASE}/import?${importParams.toString()}`);
    return true;
  } catch {
    return false;
  }
}
