import { describe, it, expect } from "vitest";
import { reviewProjectDraft } from "./projectDraft";

describe("reviewProjectDraft", () => {
  it("flags both team and region when neither is selected", () => {
    const result = reviewProjectDraft({ teamCount: 0, countryCount: 0 });
    expect(result.missingTeam).toBe(true);
    expect(result.missingRegion).toBe(true);
    expect(result.missing).toHaveLength(2);
    expect(result.missing).toContain("a team");
    expect(result.missing).toContain("a region/location");
  });

  it("flags only the region when a team is present but no region", () => {
    const result = reviewProjectDraft({ teamCount: 2, countryCount: 0 });
    expect(result.missingTeam).toBe(false);
    expect(result.missingRegion).toBe(true);
    expect(result.missing).toEqual(["a region/location"]);
  });

  it("flags nothing when both a team and a region are present", () => {
    const result = reviewProjectDraft({ teamCount: 1, countryCount: 3 });
    expect(result.missingTeam).toBe(false);
    expect(result.missingRegion).toBe(false);
    expect(result.missing).toHaveLength(0);
  });
});
