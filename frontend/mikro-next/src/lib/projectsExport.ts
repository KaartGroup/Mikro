/**
 * CSV export for the Projects page.
 *
 * CSV rather than .xlsx deliberately: Excel, Sheets and pandas all ingest it
 * directly, and it costs no bundle dependency. The two details that decide
 * whether a CSV actually opens cleanly are handled below — RFC 4180 quoting
 * and a UTF-8 BOM.
 */

import { todayIso, triggerDownload } from "./chartExport";
import type { ProjectExportRow } from "@/types";

/** Multi-value cells (countries, teams, assignees) are joined with this. */
export const MULTI_VALUE_SEPARATOR = "; ";

/**
 * Column order of the exported file. Declared as data rather than inlined so
 * the header row and the cell extraction can never drift apart.
 */
const COLUMNS: Array<{
  header: string;
  value: (row: ProjectExportRow) => string;
}> = [
  { header: "Project ID", value: (r) => String(r.id) },
  { header: "Name", value: (r) => r.name },
  { header: "Display Name", value: (r) => r.short_name },
  { header: "Countries", value: (r) => join(r.countries) },
  { header: "Regions", value: (r) => join(r.regions) },
  { header: "Created By", value: (r) => r.created_by_name },
  { header: "Created By Email", value: (r) => r.created_by_email },
  { header: "Assigned Teams", value: (r) => join(r.assigned_teams) },
  { header: "Assigned Users", value: (r) => join(r.assigned_users) },
  { header: "Status", value: (r) => (r.status ? "Active" : "Inactive") },
  { header: "Priority", value: (r) => r.priority },
  { header: "Difficulty", value: (r) => r.difficulty },
  { header: "Community", value: (r) => (r.community ? "Yes" : "No") },
  {
    header: "Source",
    value: (r) => (r.source === "mr" ? "MapRoulette" : "TM4"),
  },
  { header: "URL", value: (r) => r.url },
];

function join(values: string[] | null | undefined): string {
  return (values ?? []).join(MULTI_VALUE_SEPARATOR);
}

/**
 * Quote one cell per RFC 4180.
 *
 * A field is quoted when it contains a comma, a quote, or a line break, and
 * embedded quotes are doubled. A leading space after a delimiter also gets
 * quoted — some parsers preserve it and it shifts the column visually.
 */
export function escapeCsvCell(value: string): string {
  if (value === "") return "";
  const needsQuoting = /[",\r\n]/.test(value) || value !== value.trim();
  if (!needsQuoting) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

/** The CSV text for `rows`, header row included. `\r\n` per RFC 4180. */
export function toCsv(rows: ProjectExportRow[]): string {
  const lines = [COLUMNS.map((c) => escapeCsvCell(c.header)).join(",")];
  for (const row of rows) {
    lines.push(COLUMNS.map((c) => escapeCsvCell(c.value(row))).join(","));
  }
  return lines.join("\r\n");
}

/**
 * A downloadable CSV Blob.
 *
 * The leading U+FEFF is what makes Excel read the file as UTF-8. Without it
 * Excel assumes the local ANSI codepage and mangles every non-ASCII name —
 * which, for a team working across West Africa and Latin America, is most of
 * them.
 */
export function toCsvBlob(rows: ProjectExportRow[]): Blob {
  return new Blob(["﻿", toCsv(rows)], {
    type: "text/csv;charset=utf-8;",
  });
}

/** `mikro-projects-2026-08-21.csv` */
export function csvFilename(): string {
  return `mikro-projects-${todayIso()}.csv`;
}

/** Build the file and hand it to the browser. */
export function downloadProjectsCsv(rows: ProjectExportRow[]): void {
  triggerDownload(toCsvBlob(rows), csvFilename());
}
