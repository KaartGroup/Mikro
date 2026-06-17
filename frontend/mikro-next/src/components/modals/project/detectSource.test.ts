import { describe, it, expect } from "vitest";
import { detectSource } from "./detectSource";

describe("detectSource", () => {
  it("detects MapRoulette from a browse-challenges URL", () => {
    expect(detectSource("https://maproulette.org/browse/challenges/123")).toBe(
      "mr",
    );
  });

  it("detects MapRoulette from other maproulette.org paths", () => {
    expect(detectSource("https://maproulette.org/challenge/456")).toBe("mr");
    expect(
      detectSource("https://maproulette.org/admin/project/7/challenge/8"),
    ).toBe("mr");
  });

  it("detects TM4 from a tasks.kaart.com project URL", () => {
    expect(detectSource("https://tasks.kaart.com/projects/123")).toBe("tm4");
  });

  it("treats any non-maproulette URL as TM4 (the catch-all default)", () => {
    expect(detectSource("https://tasks.hotosm.org/projects/999")).toBe("tm4");
    expect(detectSource("https://example.com/anything")).toBe("tm4");
  });

  it("is case-insensitive about the maproulette host", () => {
    expect(detectSource("https://MapRoulette.org/browse/challenges/1")).toBe(
      "mr",
    );
    expect(detectSource("HTTPS://MAPROULETTE.ORG/BROWSE/CHALLENGES/1")).toBe(
      "mr",
    );
  });

  it("matches 'maproulette' anywhere in the string, not just the host", () => {
    // Mirrors the backend's substring check — staging/dev hosts that embed
    // the word still resolve to MapRoulette.
    expect(
      detectSource("https://staging.maproulette.example/challenges/1"),
    ).toBe("mr");
  });

  it("defaults an empty string to TM4 (the initial form state)", () => {
    expect(detectSource("")).toBe("tm4");
  });

  it("only ever returns 'mr' or 'tm4'", () => {
    const urls = [
      "",
      "garbage",
      "https://maproulette.org/browse/challenges/1",
      "https://tasks.kaart.com/projects/2",
    ];
    for (const url of urls) {
      expect(["mr", "tm4"]).toContain(detectSource(url));
    }
  });
});
