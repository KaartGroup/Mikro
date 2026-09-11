import { describe, expect, it } from "vitest";
import {
  BACKEND_REASON,
  CLAIM_NAMESPACE,
  orgClaimSource,
  orgIdFromClaims,
  redirectForVerdict,
  type OrgVerdict,
} from "../org";

const NATIVE = "org_nativeAAA111";
const NAMESPACED = "org_namespacedBBB222";
const NS_KEY = `${CLAIM_NAMESPACE}/org_id`;

describe("orgIdFromClaims", () => {
  it("prefers Auth0's native org_id over the namespaced claim", () => {
    // Native means Auth0 itself verified membership on an org-scoped login,
    // so it outranks a value copied out of app_metadata by an Action.
    expect(orgIdFromClaims({ org_id: NATIVE, [NS_KEY]: NAMESPACED })).toBe(
      NATIVE,
    );
    expect(orgClaimSource({ org_id: NATIVE, [NS_KEY]: NAMESPACED })).toBe(
      "native",
    );
  });

  it("falls back to the namespaced claim", () => {
    expect(orgIdFromClaims({ [NS_KEY]: NAMESPACED })).toBe(NAMESPACED);
    expect(orgClaimSource({ [NS_KEY]: NAMESPACED })).toBe("namespaced");
  });

  it("returns undefined when neither claim is present", () => {
    expect(orgIdFromClaims({ sub: "auth0|x" })).toBeUndefined();
    expect(orgClaimSource({ sub: "auth0|x" })).toBeNull();
  });

  it("handles null/undefined users", () => {
    expect(orgIdFromClaims(null)).toBeUndefined();
    expect(orgIdFromClaims(undefined)).toBeUndefined();
    expect(orgClaimSource(null)).toBeNull();
  });

  it.each([
    ["empty string", ""],
    ["not an org id", "not-an-org"],
    ["prefix only", "org_"],
    ["wrong case", "ORG_abc"],
    ["embedded space", "org_abc def"],
    ["number", 12345],
    ["object", { a: 1 }],
    ["null", null],
  ])("rejects a malformed native claim (%s)", (_label, bad) => {
    expect(orgIdFromClaims({ org_id: bad })).toBeUndefined();
  });

  it("falls through to the namespaced claim when native is malformed", () => {
    expect(orgIdFromClaims({ org_id: "garbage", [NS_KEY]: NAMESPACED })).toBe(
      NAMESPACED,
    );
  });
});

describe("redirectForVerdict", () => {
  it("routes an org-less session to /no-org", () => {
    expect(redirectForVerdict("no_org")).toBe("/no-org");
  });

  it("routes a disabled/unknown org to /wrong-org", () => {
    expect(redirectForVerdict("org_not_active")).toBe("/wrong-org");
  });

  it("does not redirect on success", () => {
    expect(redirectForVerdict("ok")).toBeNull();
  });

  it("does NOT redirect when the backend is unavailable", () => {
    // Load-bearing: a backend blip must under-privilege, never lock out. If
    // this ever starts returning a path, an API outage becomes a full outage.
    expect(redirectForVerdict("unavailable")).toBeNull();
  });

  it("has a defined destination for every verdict", () => {
    const all: OrgVerdict[] = ["ok", "no_org", "org_not_active", "unavailable"];
    for (const v of all) {
      expect(() => redirectForVerdict(v)).not.toThrow();
    }
  });
});

describe("BACKEND_REASON", () => {
  it("matches the reason strings Login.py sends", () => {
    // These are a cross-process contract; changing one side silently breaks
    // org routing. Keep in sync with backend/api/views/Login.py.
    expect(BACKEND_REASON.noOrg).toBe("no_org");
    expect(BACKEND_REASON.orgNotActive).toBe("org_not_active");
  });
});
