import { describe, expect, it } from "vitest";
import { LOGIN_PARAM_ALLOWLIST, sanitizeLoginUrl } from "../loginParams";

const BASE = "https://mikro.test/auth/login";

/** Sanitize a query string and return the surviving params as an object. */
function sanitized(query: string): Record<string, string> {
  const out = sanitizeLoginUrl(new URL(`${BASE}${query}`));
  return Object.fromEntries(out.searchParams.entries());
}

describe("LOGIN_PARAM_ALLOWLIST", () => {
  it("allows exactly the parameters Auth0 login needs and no more", () => {
    // Adding a key here must be a deliberate edit. If this set grows without
    // a matching reason, an arbitrary value is reaching /authorize.
    expect(Object.keys(LOGIN_PARAM_ALLOWLIST).sort()).toEqual(
      [
        "invitation",
        "login_hint",
        "organization",
        "prompt",
        "returnTo",
        "screen_hint",
      ].sort(),
    );
  });
});

describe("sanitizeLoginUrl", () => {
  it("drops parameters that are not allow-listed", () => {
    // The attack this exists to stop: injecting an OAuth parameter of your
    // choosing into a third-party authorization request.
    const out = sanitized(
      "?returnTo=/dashboard&redirect_uri=https://evil.test",
    );
    expect(out.returnTo).toBe("/dashboard");
    expect(out.redirect_uri).toBeUndefined();
  });

  it("keeps an accept-invitation redirect intact", () => {
    // src/app/accept-invitation/route.ts forwards exactly these two. If
    // sanitisation ate either one, every org invitation would break.
    const out = sanitized("?organization=org_abc123&invitation=tkt_XYZ");
    expect(out).toEqual({
      organization: "org_abc123",
      invitation: "tkt_XYZ",
    });
  });

  it("leaves an already-clean invitation URL byte-identical", () => {
    // The middleware compares hrefs to decide whether to redirect. If a clean
    // URL did not round-trip exactly, every login would redirect once for
    // nothing — or loop.
    const url = new URL(`${BASE}?organization=org_abc123&invitation=tkt_XYZ`);
    expect(sanitizeLoginUrl(url).href).toBe(url.href);
  });

  it("is idempotent", () => {
    const once = sanitizeLoginUrl(new URL(`${BASE}?prompt=login&evil=1`));
    const twice = sanitizeLoginUrl(new URL(once.href));
    expect(twice.href).toBe(once.href);
  });

  it("does not mutate the input URL", () => {
    const url = new URL(`${BASE}?evil=1`);
    sanitizeLoginUrl(url);
    expect(url.searchParams.get("evil")).toBe("1");
  });

  describe("prompt", () => {
    it("allows prompt=login", () => {
      expect(sanitized("?prompt=login").prompt).toBe("login");
    });

    it.each(["none", "consent", "select_account", "LOGIN", ""])(
      "drops prompt=%s",
      (value) => {
        // prompt=none in particular would attempt a SILENT authorization —
        // never something an inbound link should get to ask for.
        expect(sanitized(`?prompt=${value}`).prompt).toBeUndefined();
      },
    );
  });

  describe("screen_hint", () => {
    it("allows screen_hint=signup", () => {
      expect(sanitized("?screen_hint=signup").screen_hint).toBe("signup");
    });

    it("drops any other screen_hint", () => {
      expect(sanitized("?screen_hint=hack").screen_hint).toBeUndefined();
    });
  });

  describe("organization", () => {
    it("allows a well-formed org id", () => {
      expect(sanitized("?organization=org_abc123").organization).toBe(
        "org_abc123",
      );
    });

    it.each(["evil", "org_", "ORG_abc", "org_abc def", ""])(
      "drops a malformed org id (%s)",
      (value) => {
        expect(
          sanitized(`?organization=${encodeURIComponent(value)}`).organization,
        ).toBeUndefined();
      },
    );
  });

  describe("login_hint", () => {
    it("allows a plausible email", () => {
      expect(sanitized("?login_hint=a@b.test").login_hint).toBe("a@b.test");
    });

    it("drops a non-email", () => {
      expect(sanitized("?login_hint=notanemail").login_hint).toBeUndefined();
    });

    it("drops an over-long value", () => {
      const long = `${"a".repeat(300)}@b.test`;
      expect(
        sanitized(`?login_hint=${encodeURIComponent(long)}`).login_hint,
      ).toBeUndefined();
    });
  });

  describe("invitation", () => {
    it("drops an over-long ticket", () => {
      expect(
        sanitized(`?invitation=${"t".repeat(600)}`).invitation,
      ).toBeUndefined();
    });
  });

  describe("repeated parameters", () => {
    it("drops a duplicated key rather than taking the first value", () => {
      // A repeated key is treated as a smuggling attempt, not as a good value
      // plus noise — otherwise `?prompt=login&prompt=none` could slip a second
      // value past a naive first-wins reader downstream.
      expect(sanitized("?prompt=login&prompt=none").prompt).toBeUndefined();
    });

    it("drops a duplicated organization even if both look valid", () => {
      expect(
        sanitized("?organization=org_aaa111&organization=org_bbb222")
          .organization,
      ).toBeUndefined();
    });

    it("keeps other valid params when one key is duplicated", () => {
      const out = sanitized(
        "?prompt=login&prompt=none&organization=org_abc123",
      );
      expect(out.organization).toBe("org_abc123");
      expect(out.prompt).toBeUndefined();
    });
  });

  it("handles an empty query string", () => {
    const url = new URL(BASE);
    expect(sanitizeLoginUrl(url).href).toBe(url.href);
  });
});
