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
 * Serialize the first <svg> inside `container` to a PNG and download
 * it as `<filename>.png`. Returns true on success, false on any
 * early bail (no svg found, rasterize failure, etc).
 *
 * The rasterization pads the canvas with a white background so PNGs
 * paste cleanly onto dark-theme terminals / light-theme docs alike.
 */
export async function exportChartAsPng(
  container: HTMLElement | null,
  filename: string,
): Promise<boolean> {
  if (!container) return false;
  const svg = container.querySelector("svg");
  if (!svg) {
    console.warn("[chartExport] no <svg> found in container");
    return false;
  }

  // Measure the rendered size. getBoundingClientRect() handles
  // ResponsiveContainer sizing that hasn't been committed to the
  // svg's own width/height attributes.
  const rect = svg.getBoundingClientRect();
  const width = Math.ceil(rect.width) || 800;
  const height = Math.ceil(rect.height) || 400;

  // Clone + inject explicit width/height into the serialized SVG so
  // the <Image> renderer doesn't fall back to percentages.
  const clone = svg.cloneNode(true) as SVGElement;
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");

  const svgMarkup = new XMLSerializer().serializeToString(clone);
  const svgBlob = new Blob([svgMarkup], {
    type: "image/svg+xml;charset=utf-8",
  });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const img = new Image();
    img.width = width;
    img.height = height;

    const loaded = await new Promise<boolean>((resolve) => {
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = svgUrl;
    });
    if (!loaded) {
      console.warn("[chartExport] failed to load serialized SVG into <img>");
      return false;
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      console.warn("[chartExport] could not get 2d canvas context");
      return false;
    }
    // White background so PNGs paste cleanly into docs/reports.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/png"),
    );
    if (!blob) {
      console.warn("[chartExport] canvas.toBlob returned null");
      return false;
    }
    const safeFilename = filename.endsWith(".png")
      ? filename
      : `${filename}.png`;
    triggerDownload(blob, safeFilename);
    return true;
  } catch (err) {
    console.warn("[chartExport] unexpected error", err);
    return false;
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

/**
 * CSV generator + download trigger for table rows. Handles value
 * quoting (commas, quotes, newlines) the RFC-4180 way: wrap the
 * cell in double-quotes when it contains any of those chars, and
 * double up any embedded quote.
 */
export function exportRowsAsCsv<T extends Record<string, unknown>>(
  rows: T[],
  columns: Array<{ key: keyof T & string; label: string }>,
  filename: string,
): boolean {
  if (!rows.length) return false;

  const escape = (raw: unknown): string => {
    const s = raw === null || raw === undefined ? "" : String(raw);
    if (/[",\n\r]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const header = columns.map((c) => escape(c.label)).join(",");
  const body = rows
    .map((row) => columns.map((c) => escape(row[c.key])).join(","))
    .join("\n");
  const csv = `${header}\n${body}\n`;

  const safeFilename = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  triggerDownload(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
    safeFilename,
  );
  return true;
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
