import type {
  TimekeepingStatsResponse,
  EditingStatsResponse,
  ElementAnalysisCategory,
} from "@/types";
import { todayIso, triggerDownload } from "./chartExport";

function escapeCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function row(...cells: unknown[]): string {
  return cells.map(escapeCell).join(",");
}

// ── CSV ─────────────────────────────────────────────────────────────────────

export function exportReportAsCsv(
  timekeepingData: TimekeepingStatsResponse | null,
  editingData: EditingStatsResponse | null,
  elementCategories: ElementAnalysisCategory[],
  dateRange: string,
) {
  const sections: string[] = [];

  sections.push(`Mikro Report Export — ${dateRange}`);
  sections.push(`Exported: ${new Date().toLocaleString()}`);
  sections.push("");

  // KPI Summary
  if (timekeepingData) {
    const s = timekeepingData.summary;
    sections.push("SECTION: KPI Summary");
    sections.push(row("Metric", "Value"));
    sections.push(row("Total Hours", s.total_hours));
    sections.push(row("Total Changesets", s.total_changesets));
    sections.push(row("Total Changes", s.total_changes));
    sections.push(
      row(
        "Avg Changes / Changeset",
        s.total_changesets > 0
          ? (s.total_changes / s.total_changesets).toFixed(2)
          : 0,
      ),
    );
    sections.push(
      row(
        "Avg Changes / Hour",
        s.total_hours > 0 ? (s.total_changes / s.total_hours).toFixed(2) : 0,
      ),
    );
    sections.push(row("Active Users", s.active_users));
    sections.push("");
  }

  // Daily Activity
  if (timekeepingData?.daily_activity.length) {
    sections.push("SECTION: Daily Activity");
    sections.push(
      row("Day", "Hours", "Changes", "Changesets", "Changes/Changeset", "Changes/Hour"),
    );
    for (const d of timekeepingData.daily_activity) {
      sections.push(
        row(d.day, d.hours, d.changes, d.changesets, d.changes_per_changeset, d.changes_per_hour),
      );
    }
    sections.push("");
  }

  // Hours by Category
  if (timekeepingData?.hours_by_category.length) {
    sections.push("SECTION: Hours by Category");
    sections.push(row("Category", "Hours"));
    for (const c of timekeepingData.hours_by_category) {
      sections.push(row(c.category, c.hours));
    }
    sections.push("");
  }

  // Tasks Over Time (Daily)
  if (editingData?.tasks_over_time_daily.length) {
    sections.push("SECTION: Tasks Over Time (Daily)");
    sections.push(row("Day", "Mapped", "Validated", "Invalidated"));
    for (const d of editingData.tasks_over_time_daily) {
      sections.push(row(d.day, d.mapped, d.validated, d.invalidated));
    }
    sections.push("");
  }

  // Element Analysis
  if (elementCategories.length) {
    const categoryNames = elementCategories.map((c) => c.title);

    // Merge all days across categories
    const dayMap: Record<string, Record<string, number>> = {};
    for (const cat of elementCategories) {
      for (const d of cat.data) {
        if (!dayMap[d.day]) dayMap[d.day] = {};
        dayMap[d.day][cat.title] = d.added + d.modified + d.deleted;
      }
    }

    sections.push("SECTION: Element Analysis (Total Edits by Category)");
    sections.push(row("Day", ...categoryNames, "Total"));
    for (const day of Object.keys(dayMap).sort()) {
      const vals = categoryNames.map((n) => dayMap[day][n] ?? 0);
      const total = vals.reduce((a, b) => a + b, 0);
      sections.push(row(day, ...vals, total));
    }
    sections.push("");
  }

  const csv = sections.join("\n");
  triggerDownload(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
    `mikro-report-${todayIso()}.csv`,
  );
}

// ── Word Document ────────────────────────────────────────────────────────────

export async function exportChartsAsDocx(
  container: HTMLElement,
  dateRange: string,
): Promise<void> {
  const [{ toPng }, { Document, Packer, Paragraph, ImageRun, HeadingLevel, AlignmentType }] =
    await Promise.all([import("html-to-image"), import("docx")]);

  const charts = Array.from(
    container.querySelectorAll<HTMLElement>("[data-chart-export]"),
  );

  const captured = await Promise.all(
    charts.map(async (el) => {
      const rect = el.getBoundingClientRect();
      const targetW = 310;
      const targetH = rect.width > 0 ? Math.round((rect.height / rect.width) * targetW) : 170;
      const png = await toPng(el, { pixelRatio: 2, backgroundColor: "#ffffff" });
      const bytes = new Uint8Array(await (await fetch(png)).arrayBuffer());
      return { name: el.dataset.chartExport ?? "Chart", bytes, targetW, targetH };
    }),
  );

  const children = [
    new Paragraph({ text: `Mikro Report — ${dateRange}`, heading: HeadingLevel.HEADING_1 }),
    new Paragraph({ text: `Exported: ${new Date().toLocaleString()}` }),
    new Paragraph(""),
  ];

  for (const { name, bytes, targetW, targetH } of captured) {
    children.push(
      new Paragraph({ text: name, heading: HeadingLevel.HEADING_2 }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new ImageRun({ data: bytes, transformation: { width: targetW, height: targetH }, type: "png" })],
      }),
      new Paragraph(""),
    );
  }

  const doc = new Document({ sections: [{ children }] });
  triggerDownload(await Packer.toBlob(doc), `mikro-report-${todayIso()}.docx`);
}

// ── PNG ZIP ──────────────────────────────────────────────────────────────────

export async function exportChartsAsZip(container: HTMLElement): Promise<void> {
  const [{ toPng }, { default: JSZip }] = await Promise.all([
    import("html-to-image"),
    import("jszip"),
  ]);

  const charts = Array.from(
    container.querySelectorAll<HTMLElement>("[data-chart-export]"),
  );

  const zip = new JSZip();
  const folder = zip.folder("mikro-charts") ?? zip;

  await Promise.all(
    charts.map(async (el) => {
      const name = (el.dataset.chartExport ?? "chart").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      const png = await toPng(el, { pixelRatio: 1, backgroundColor: "#ffffff" });
      const base64 = png.replace(/^data:image\/png;base64,/, "");
      folder.file(`${name}.png`, base64, { base64: true });
    }),
  );

  const blob = await zip.generateAsync({ type: "blob" });
  triggerDownload(blob, `mikro-charts-${todayIso()}.zip`);
}
