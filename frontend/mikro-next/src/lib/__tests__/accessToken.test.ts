import { describe, expect, it, vi } from "vitest";
import {
  createSingleFlightGetAccessToken,
  installSingleFlightAccessToken,
  ROUTE_REFRESH_BUFFER_S,
} from "../accessToken";

const NOW_S = 1_800_000_000;

function session(overrides: Record<string, unknown> = {}) {
  return {
    tokenSet: {
      accessToken: "at-old",
      refreshToken: "rt-1",
      expiresAt: NOW_S + 3600,
      scope: "openid profile",
      ...overrides,
    },
  };
}

/** A wrapper with a controllable clock and a counted SDK. */
function build(
  sessionValue: unknown,
  sdkImpl?: (...args: unknown[]) => Promise<Record<string, unknown>>,
) {
  const sdkGetAccessToken = vi.fn(
    sdkImpl ??
      (async () => ({ token: "at-new", expiresAt: NOW_S + 7200 }) as never),
  );
  const getSession = vi.fn(async () => sessionValue as never);
  const getAccessToken = createSingleFlightGetAccessToken(
    { getSession, getAccessToken: sdkGetAccessToken as never },
    { now: () => NOW_S, log: () => {} },
  );
  return { getAccessToken, sdkGetAccessToken, getSession };
}

describe("single-flight getAccessToken", () => {
  it("returns the session token WITHOUT calling the SDK when it is fresh", async () => {
    // The common path. No SDK call means no refresh and no cookie write, which
    // is what keeps the vast majority of requests off the refresh endpoint.
    const { getAccessToken, sdkGetAccessToken } = build(session());
    const result = await getAccessToken();
    expect(result.token).toBe("at-old");
    expect(sdkGetAccessToken).not.toHaveBeenCalled();
  });

  it("refreshes when the token is inside the refresh buffer", async () => {
    const { getAccessToken, sdkGetAccessToken } = build(
      session({ expiresAt: NOW_S + ROUTE_REFRESH_BUFFER_S - 1 }),
    );
    const result = await getAccessToken();
    expect(result.token).toBe("at-new");
    expect(sdkGetAccessToken).toHaveBeenCalledTimes(1);
    // `refresh: true` is required — the SDK's own trigger is "already
    // expired", so without it an early refresh would be a no-op.
    expect(sdkGetAccessToken.mock.calls[0][0]).toMatchObject({ refresh: true });
  });

  it("COALESCES a burst into exactly one refresh", async () => {
    // THE reason this file exists. Twenty callers presenting the same refresh
    // token simultaneously is what Auth0 reads as token theft; it revoked a
    // whole grant family for it (ferrt, 2026-09-03 / 2026-09-06).
    let resolveSdk: (v: unknown) => void = () => {};
    const pending = new Promise((r) => {
      resolveSdk = r;
    });
    const { getAccessToken, sdkGetAccessToken } = build(
      session({ expiresAt: NOW_S - 1 }),
      () => pending as never,
    );

    const inflight = Array.from({ length: 20 }, () => getAccessToken());
    resolveSdk({ token: "at-new", expiresAt: NOW_S + 7200 });
    const results = await Promise.all(inflight);

    expect(sdkGetAccessToken).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.token === "at-new")).toBe(true);
  });

  it("serves late arrivals from the recent-refresh window", async () => {
    // A caller arriving just after the winner still holds the OLD cookie, so
    // without this it would replay a refresh token Auth0 has already rotated.
    const { getAccessToken, sdkGetAccessToken } = build(
      session({ expiresAt: NOW_S - 1 }),
    );
    await getAccessToken();
    await getAccessToken();
    expect(sdkGetAccessToken).toHaveBeenCalledTimes(1);
  });

  it("shares a FAILED refresh too, instead of letting everyone retry", async () => {
    const boom = new Error("invalid_grant");
    const { getAccessToken, sdkGetAccessToken } = build(
      session({ expiresAt: NOW_S - 1 }),
      async () => {
        throw boom;
      },
    );

    const results = await Promise.allSettled([
      getAccessToken(),
      getAccessToken(),
      getAccessToken(),
    ]);

    expect(sdkGetAccessToken).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.status === "rejected")).toBe(true);
  });

  it("keys flights by refresh token, so different sessions do not share", async () => {
    const a = build(session({ expiresAt: NOW_S - 1, refreshToken: "rt-A" }));
    const b = build(session({ expiresAt: NOW_S - 1, refreshToken: "rt-B" }));
    await Promise.all([a.getAccessToken(), b.getAccessToken()]);
    expect(a.sdkGetAccessToken).toHaveBeenCalledTimes(1);
    expect(b.sdkGetAccessToken).toHaveBeenCalledTimes(1);
  });

  it("honours a caller-supplied refreshBuffer", async () => {
    // How the heartbeat refreshes far ahead of expiry.
    const { getAccessToken, sdkGetAccessToken } = build(
      session({ expiresAt: NOW_S + 600 }),
    );
    await getAccessToken({ refreshBuffer: 1200 });
    expect(sdkGetAccessToken).toHaveBeenCalledTimes(1);
  });

  it("does NOT strip refreshBuffer into the SDK options", async () => {
    const { getAccessToken, sdkGetAccessToken } = build(
      session({ expiresAt: NOW_S - 1 }),
    );
    await getAccessToken({ refreshBuffer: 60 });
    expect(sdkGetAccessToken.mock.calls[0][0]).not.toHaveProperty(
      "refreshBuffer",
    );
  });

  describe("delegates straight to the SDK", () => {
    it("for the (req, res, options) form", async () => {
      // That form exists to write Set-Cookie onto a response the caller owns —
      // middleware's only way to persist a rotated token. Intercepting it
      // would drop the cookie write and the browser would keep the stale one.
      const { getAccessToken, sdkGetAccessToken, getSession } =
        build(session());
      const req = { url: "https://x.test/" };
      const res = { cookies: {} };
      await getAccessToken(req, res, { refresh: true });
      expect(sdkGetAccessToken).toHaveBeenCalledWith(req, res, {
        refresh: true,
      });
      // Must not even read the session — that is the SDK's job here.
      expect(getSession).not.toHaveBeenCalled();
    });

    it.each([
      ["refresh", { refresh: true }],
      ["audience", { audience: "other-api" }],
      ["scope", { scope: "extra" }],
    ])("when %s is requested", async (_label, opts) => {
      const { getAccessToken, sdkGetAccessToken } = build(session());
      await getAccessToken(opts);
      expect(sdkGetAccessToken).toHaveBeenCalledTimes(1);
    });

    it("when there is no session", async () => {
      const { getAccessToken, sdkGetAccessToken } = build(null);
      await getAccessToken();
      expect(sdkGetAccessToken).toHaveBeenCalledTimes(1);
    });

    it("when the session has no access token", async () => {
      const { getAccessToken, sdkGetAccessToken } = build({ tokenSet: {} });
      await getAccessToken();
      expect(sdkGetAccessToken).toHaveBeenCalledTimes(1);
    });

    it("when expired with NO refresh token", async () => {
      // The SDK raises the correctly-worded error here ("...and a refresh
      // token was not provided") which the heartbeat classifies. Not ours to
      // invent.
      const { getAccessToken, sdkGetAccessToken } = build(
        session({ expiresAt: NOW_S - 1, refreshToken: undefined }),
      );
      await getAccessToken();
      expect(sdkGetAccessToken).toHaveBeenCalledTimes(1);
    });

    it("when getSession throws", async () => {
      const sdkGetAccessToken = vi.fn(
        async () => ({ token: "at-new", expiresAt: NOW_S }) as never,
      );
      const getAccessToken = createSingleFlightGetAccessToken(
        {
          getSession: vi.fn(async () => {
            throw new Error("bad cookie");
          }) as never,
          getAccessToken: sdkGetAccessToken as never,
        },
        { now: () => NOW_S, log: () => {} },
      );
      await getAccessToken();
      expect(sdkGetAccessToken).toHaveBeenCalledTimes(1);
    });
  });
});

describe("installSingleFlightAccessToken", () => {
  it("patches the instance in place so existing callers need no change", async () => {
    const client = {
      getSession: vi.fn(async () => session()),
      getAccessToken: vi.fn(async () => ({
        token: "at-new",
        expiresAt: NOW_S + 7200,
      })),
      middleware: vi.fn(),
    };
    const original = client.getAccessToken;

    const patched = installSingleFlightAccessToken(client as never);

    expect(patched).toBe(client);
    expect(client.getAccessToken).not.toBe(original);
    // Other members survive — middleware() is called on this same instance.
    expect(client.middleware).toBeDefined();

    // Fresh token => the original SDK method is never reached.
    const result = await patched.getAccessToken();
    expect(result.token).toBe("at-old");
    expect(original).not.toHaveBeenCalled();
  });
});
