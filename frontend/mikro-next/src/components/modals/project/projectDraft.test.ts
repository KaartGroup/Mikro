import { describe, it, expect } from "vitest";
import { reviewProjectDraft } from "./projectDraft";

describe("reviewProjectDraft", () => {
  it("flags both team and region when neither is selected", () => {
    const result = reviewProjectDraft({ teamCount: 0, countryCount: 0, userCount: 0, isVisible: false });
    expect(result.missingTeam).toBe(true);
    expect(result.missingRegion).toBe(true);
    expect(result.missing).toHaveLength(2);
    expect(result.missing).toContain("a team");
    expect(result.missing).toContain("a region/location");
  });

  it("flags only the region when a team is present but no region", () => {
    const result = reviewProjectDraft({ teamCount: 2, countryCount: 0, userCount: 0, isVisible: false });
    expect(result.missingTeam).toBe(false);
    expect(result.missingRegion).toBe(true);
    expect(result.missing).toEqual(["a region/location"]);
  });

  it("flags nothing when both a team and a region are present", () => {
    const result = reviewProjectDraft({ teamCount: 1, countryCount: 3, userCount: 0, isVisible: false });
    expect(result.missingTeam).toBe(false);
    expect(result.missingRegion).toBe(false);
    expect(result.missing).toHaveLength(0);
  });

  it("marks invisible when not visible and no team or user assigned", () => {
    const result = reviewProjectDraft({ teamCount: 0, countryCount: 0, userCount: 0, isVisible: false });
    expect(result.invisible).toBe(true);
  });

  it("not invisible when visibility is true even with no assignments", () => {
    const result = reviewProjectDraft({ teamCount: 0, countryCount: 0, userCount: 0, isVisible: true });
    expect(result.invisible).toBe(false);
  });

  it("not invisible when a team is assigned even without visibility", () => {
    const result = reviewProjectDraft({ teamCount: 1, countryCount: 0, userCount: 0, isVisible: false });
    expect(result.invisible).toBe(false);
  });

  it("not invisible when a user is assigned even without visibility", () => {
    const result = reviewProjectDraft({ teamCount: 0, countryCount: 0, userCount: 1, isVisible: false });
    expect(result.invisible).toBe(false);
  });
});
