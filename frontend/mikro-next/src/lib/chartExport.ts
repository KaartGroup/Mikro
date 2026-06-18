/**
 * Chart-to-PNG export using browser-native APIs.
 *
 * Recharts renders an <svg> inside each <ResponsiveContainer>. We
 * serialize that SVG, draw it onto an offscreen canvas, and trigger a
 * PNG download — no html2canvas or dom-to-image dependency needed.
 *
 * Used by the admin Reports page per-chart export buttons (UI17).
 * Silent-fails on any error (returns false + console.warn) so a broken
 * export doesn't crash the page.
 */

/** Trigger a browser download for a Blob with the given filename. */
export function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

/**
 * Returns `YYYY-MM-DD` for today's local date — used to suffix export
 * filenames so repeat exports don't collide.
 */
export function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
