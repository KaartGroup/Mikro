import { describe, it, expect } from "vitest";
import {
  MULTI_VALUE_SEPARATOR,
  csvFilename,
  escapeCsvCell,
  toCsv,
} from "../projectsExport";
import type { ProjectExportRow } from "@/types";

function row(overrides: Partial<ProjectExportRow> = {}): ProjectExportRow {
  return {
    id: 1234,
    name: "Kaduna Building Mapping",
    short_name: "Kaduna Bldgs",
    countries: ["Nigeria"],
    regions: ["West Africa"],
    created_by_name: "Logan Lead",
    created_by_email: "logan@example.com",
    assigned_teams: ["Nigeria Field Team"],
    assigned_users: ["Ada Mapper"],
    url: "https://tasks.example.com/projects/1234",
    source: "tm4",
    priority: "High",
    difficulty: "Intermediate",
    community: false,
    status: true,
    ...overrides,
  };
}

const lines = (csv: string) => csv.split("\r\n");
const cells = (line: string) => line.split(",");

describe("escapeCsvCell", () => {
  it("leaves an ordinary value alone", () => {
    expect(escapeCsvCell("Nigeria")).toBe("Nigeria");
  });

  it("quotes a value containing a comma", () => {
    expect(escapeCsvCell("Lagos, Nigeria")).toBe('"Lagos, Nigeria"');
  });

  it("doubles embedded quotes", () => {
    expect(escapeCsvCell('The "Big" Project')).toBe('"The ""Big"" Project"');
  });

  it("quotes a value containing a newline", () => {
    expect(escapeCsvCell("line one\nline two")).toBe('"line one\nline two"');
    expect(escapeCsvCell("line one\r\nline two")).toBe(
      '"line one\r\nline two"',
    );
  });

  it("quotes leading/trailing whitespace so the column can't shift", () => {
    expect(escapeCsvCell("  padded  ")).toBe('"  padded  "');
  });

  it("passes an empty value through as empty, not as a quoted blank", () => {
    expect(escapeCsvCell("")).toBe("");
  });
});

describe("toCsv", () => {
  it("emits a header row followed by one row per project", () => {
    const csv = toCsv([row(), row({ id: 5678 })]);
    const out = lines(csv);
    expect(out).toHaveLength(3);
    expect(out[0].startsWith("Project ID,Name,Display Name,Countries")).toBe(
      true,
    );
    expect(cells(out[1])[0]).toBe("1234");
    expect(cells(out[2])[0]).toBe("5678");
  });

  it("still emits the header when there are no rows", () => {
    const csv = toCsv([]);
    expect(lines(csv)).toHaveLength(1);
  });

  it("keeps every row aligned to the header's column count", () => {
    const csv = toCsv([row()]);
    const out = lines(csv);
    expect(cells(out[1])).toHaveLength(cells(out[0]).length);
  });

  it("uses CRLF line endings per RFC 4180", () => {
    expect(toCsv([row()])).toContain("\r\n");
  });

  it("joins multi-value cells and quotes them (the separator has a comma-like role)", () => {
    const csv = toCsv([
      row({ assigned_users: ["Ada Mapper", "Chidi Editor"] }),
    ]);
    expect(csv).toContain(`Ada Mapper${MULTI_VALUE_SEPARATOR}Chidi Editor`);
  });

  it("renders an empty multi-value cell as blank, not as '[]' or 'undefined'", () => {
    const csv = toCsv([row({ assigned_users: [], assigned_teams: [] })]);
    expect(csv).not.toContain("undefined");
    expect(csv).not.toContain("[]");
  });

  it("renders booleans as words a reader understands", () => {
    const active = toCsv([row({ status: true, community: true })]);
    expect(active).toContain("Active");
    expect(active).toContain("Yes");

    const inactive = toCsv([row({ status: false, community: false })]);
    expect(inactive).toContain("Inactive");
    expect(inactive).toContain("No");
  });

  it("labels the source rather than dumping the raw code", () => {
    expect(toCsv([row({ source: "mr" })])).toContain("MapRoulette");
    expect(toCsv([row({ source: "tm4" })])).toContain("TM4");
  });

  it("survives a project name containing a comma and quotes", () => {
    const csv = toCsv([row({ name: 'Kaduna, "Phase 2"' })]);
    const out = lines(csv);
    // The embedded comma must not create an extra column.
    expect(out).toHaveLength(2);
    expect(csv).toContain('"Kaduna, ""Phase 2"""');
  });

  it("leaves a creatorless project's cells empty", () => {
    const csv = toCsv([row({ created_by_name: "", created_by_email: "" })]);
    expect(csv).not.toContain("undefined");
    expect(csv).toContain(",,");
  });
});

describe("csvFilename", () => {
  it("is dated so repeat exports don't collide", () => {
    expect(csvFilename()).toMatch(/^mikro-projects-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});
