/**
 * Transcript export helpers — .txt and .pdf downloads used by both the
 * main Transcribe page and the Library detail view.
 *
 * The .pdf path dynamically imports jspdf so it's only pulled into the
 * bundle when the user actually clicks Download PDF.
 */

import type { TranscriptionSegment } from "./transcribe";
import { formatTimestamp } from "./transcribe";

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 100) || "transcript";
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

export function buildTranscriptText(
  segments: TranscriptionSegment[],
  fullText: string,
): string {
  // Prefer the server-provided fullText (segments joined with spaces) —
  // that's the cleanest narrative form. Fall back to reassembling from
  // segments only if fullText is empty for some reason.
  if (fullText && fullText.trim().length > 0) return fullText;
  return segments.map((s) => s.text).join(" ");
}

export function downloadTranscriptTxt(
  segments: TranscriptionSegment[],
  fullText: string,
  displayName: string,
) {
  const content = buildTranscriptText(segments, fullText);
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  triggerDownload(blob, `${sanitizeFilename(displayName)}.txt`);
}

export async function downloadTranscriptPdf(
  segments: TranscriptionSegment[],
  fullText: string,
  displayName: string,
) {
  const { default: jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });

  const MARGIN_X = 48;
  const MARGIN_TOP = 56;
  const MARGIN_BOTTOM = 56;
  const LINE_HEIGHT = 14;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const usableW = pageW - MARGIN_X * 2;
  let cursorY = MARGIN_TOP;

  // Title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(displayName, MARGIN_X, cursorY);
  cursorY += LINE_HEIGHT * 1.5;

  // Export stamp
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(`Exported ${new Date().toLocaleString()}`, MARGIN_X, cursorY);
  cursorY += LINE_HEIGHT * 1.5;
  doc.setTextColor(0);

  // Body — plain wrapped text, no per-segment timestamp lines. Keeps
  // the PDF at readable-document size rather than doubling it with
  // machine-readable markup that has no value in a PDF export.
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);

  const body =
    fullText && fullText.trim().length > 0
      ? fullText
      : segments.map((s) => s.text).join(" ");

  const wrapped: string[] = doc.splitTextToSize(body, usableW);
  for (const line of wrapped) {
    if (cursorY > pageH - MARGIN_BOTTOM) {
      doc.addPage();
      cursorY = MARGIN_TOP;
    }
    doc.text(line, MARGIN_X, cursorY);
    cursorY += LINE_HEIGHT;
  }

  doc.save(`${sanitizeFilename(displayName)}.pdf`);
}

/** AI result export — plain markdown (txt is fine), or rendered PDF. */
export function downloadAiResultTxt(
  content: string,
  presetLabel: string,
  displayName: string,
) {
  const header = `${presetLabel} — ${displayName}\n${"─".repeat(40)}\n\n`;
  const blob = new Blob([header + content], {
    type: "text/plain;charset=utf-8",
  });
  triggerDownload(
    blob,
    `${sanitizeFilename(displayName)}-${sanitizeFilename(presetLabel)}.txt`,
  );
}

export async function downloadAiResultPdf(
  content: string,
  presetLabel: string,
  displayName: string,
) {
  const { default: jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });

  const MARGIN_X = 48;
  const MARGIN_TOP = 56;
  const MARGIN_BOTTOM = 56;
  const LINE_HEIGHT = 14;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const usableW = pageW - MARGIN_X * 2;
  let cursorY = MARGIN_TOP;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(`${presetLabel}`, MARGIN_X, cursorY);
  cursorY += LINE_HEIGHT * 1.3;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(120);
  doc.text(`${displayName}`, MARGIN_X, cursorY);
  cursorY += LINE_HEIGHT;
  doc.text(`Exported ${new Date().toLocaleString()}`, MARGIN_X, cursorY);
  cursorY += LINE_HEIGHT * 1.5;
  doc.setTextColor(0);

  doc.setFontSize(11);
  // Render markdown as plain text — jspdf doesn't do markdown natively.
  // Users who want rendered markdown can copy to clipboard.
  const wrapped: string[] = doc.splitTextToSize(content, usableW);
  for (const line of wrapped) {
    if (cursorY > pageH - MARGIN_BOTTOM) {
      doc.addPage();
      cursorY = MARGIN_TOP;
    }
    doc.text(line, MARGIN_X, cursorY);
    cursorY += LINE_HEIGHT;
  }

  doc.save(
    `${sanitizeFilename(displayName)}-${sanitizeFilename(presetLabel)}.pdf`,
  );
}
