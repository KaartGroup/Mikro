import { todayIso, triggerDownload } from "./chartExport";
// ── CSV ─────────────────────────────────────────────────────────────────────
// ── Word Document ────────────────────────────────────────────────────────────

export async function exportChartsAsDocx(
  container: HTMLElement,
  dateRange: string,
): Promise<void> {
  const [
    { toPng },
    { Document, Packer, Paragraph, ImageRun, HeadingLevel, AlignmentType },
  ] = await Promise.all([import("html-to-image"), import("docx")]);

  const charts = Array.from(
    container.querySelectorAll<HTMLElement>("[data-chart-export]"),
  );

  const captured = await Promise.all(
    charts.map(async (el) => {
      const rect = el.getBoundingClientRect();
      const targetW = 310;
      const targetH =
        rect.width > 0 ? Math.round((rect.height / rect.width) * targetW) : 170;
      const png = await toPng(el, {
        pixelRatio: 2,
        backgroundColor: "#ffffff",
      });
      const bytes = new Uint8Array(await (await fetch(png)).arrayBuffer());
      return {
        name: el.dataset.chartExport ?? "Chart",
        bytes,
        targetW,
        targetH,
      };
    }),
  );

  const children = [
    new Paragraph({
      text: `Mikro Report — ${dateRange}`,
      heading: HeadingLevel.HEADING_1,
    }),
    new Paragraph({ text: `Exported: ${new Date().toLocaleString()}` }),
    new Paragraph(""),
  ];

  for (const { name, bytes, targetW, targetH } of captured) {
    children.push(
      new Paragraph({ text: name, heading: HeadingLevel.HEADING_2 }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new ImageRun({
            data: bytes,
            transformation: { width: targetW, height: targetH },
            type: "png",
          }),
        ],
      }),
      new Paragraph(""),
    );
  }

  const doc = new Document({ sections: [{ children }] });
  triggerDownload(await Packer.toBlob(doc), `mikro-report-${todayIso()}.docx`);
}

// ── PNG ZIP ──────────────────────────────────────────────────────────────────
