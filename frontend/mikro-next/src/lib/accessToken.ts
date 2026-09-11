/**
 * Single-flight access-token acquisition.
 *
 * EDGE-SAFE, AND THAT IS NOT OPTIONAL: `lib/auth0.ts` imports this file and
 * `middleware.ts` imports `lib/auth0.ts`, so this module is evaluated in the
 * Edge runtime on every request the matcher covers. A Node-only import here
 * (`node:crypto`, `fs`, …) does NOT fail the build — it fails middleware at
 * runtime and every route answers 500. Web APIs only: `Date` and `Map` here.
 *
 * WHY THIS EXISTS
 * ---------------
 * `@auth0/nextjs-auth0` has no concurrency guard around its refresh. When the
 * access token expires, every in-flight request that calls `getAccessToken()`
 * presents the SAME refresh token to Auth0 at once. With Refresh Token
 * Rotation enabled, Auth0 reads simultaneous reuse as token theft and revokes
 * the entire grant family — every later refresh then fails with
 * `invalid_grant` until the user clears their cookies.
 *
 * That is not hypothetical for this tenant. The sibling Maprizon app hit it on
 * 2026-09-03 (`ferrt` — "reused refresh token detected" — in the Auth0 log,
 * `tokenCounter: 1 / latestCounter: 2`), and Mikro produced the same event for
 * its own client id on 2026-09-06. Rotation is currently OFF for Mikro
 * *because* of this gap. This file is the prerequisite for turning it back on.
 *
 * Auth0 acknowledges the gap and ships nothing (auth0/nextjs-auth0#2149). The
 * dashboard's "Rotation Overlap Period" is a grace window, not a fix. This is
 * the fix, in two parts:
 *
 *  1. DON'T CALL THE SDK WHEN THE TOKEN IS FINE. The session cookie already
 *     holds the access token and its expiry. If it is not near expiry, hand it
 *     straight back — no SDK call, no refresh, no cookie write. Nearly every
 *     request takes this path, and it has no shared state to race on.
 *
 *  2. WHEN A REFRESH IS NEEDED, DO IT ONCE. Concurrent callers holding the
 *     same refresh token await one in-flight refresh instead of each starting
 *     their own, and the result stays cached briefly afterwards so a caller
 *     arriving just after the winner — still carrying the OLD cookie, because
 *     the browser has not received the new one yet — gets the fresh token
 *     rather than replaying a refresh token Auth0 has already rotated.
 *
 * SCOPE: this coalesces callers within ONE Next.js process. Separate
 * containers still refresh independently; the rotation overlap period covers
 * that.
 *
 * SHAPES: `tokenSet.accessToken`, `.expiresAt` (epoch SECONDS),
 * `.refreshToken`, `.scope` are the SDK's `SessionData`/`TokenSet`. The return
 * object mirrors what the SDK's own `getAccessToken` resolves to, so callers
 * see no difference.
 */

/**
 * Ordinary callers refresh only if the token expires within this many seconds.
 * Deliberately small: these are requests a browser may abandon, so they should
 * rarely be the ones that refresh.
 */
export const ROUTE_REFRESH_BUFFER_S = 30;

/**
 * `/auth/heartbeat` refreshes this far ahead of expiry. MUST exceed the
 * heartbeat interval (15 min — `HEARTBEAT_INTERVAL_MS` in
 * `hooks/useSessionHeartbeat.ts`), or a token can expire between two beats and
 * the burst refresh this file prevents is back on the table.
 */
export const HEARTBEAT_REFRESH_BUFFER_S = 20 * 60;

/**
 * How long a completed refresh keeps serving late arrivals. Long enough to
 * cover a burst that all left the browser with the old cookie; short enough
 * that a token is never served from here after it has expired.
 */
export const RECENT_REFRESH_TTL_MS = 30 * 1000;

/** What the SDK's getAccessToken resolves to. Extra keys pass through. */
export interface AccessTokenResult {
  token: string;
  expiresAt: number;
  scope?: string;
  [key: string]: unknown;
}

interface TokenSetLike {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
  [key: string]: unknown;
}

interface SessionLike {
  tokenSet?: TokenSetLike;
  [key: string]: unknown;
}

/** Options we understand, plus anything the SDK understands. */
export interface GetAccessTokenOptions {
  /** Seconds before expiry at which to refresh. Defaults to ROUTE_REFRESH_BUFFER_S. */
  refreshBuffer?: number;
  refresh?: boolean;
  audience?: string;
  scope?: string;
  [key: string]: unknown;
}

interface Deps {
  /** Epoch seconds. Injected for tests. */
  now?: () => number;
  log?: (msg: string, ctx: Record<string, unknown>) => void;
}

interface Sdk {
  getSession: () => Promise<SessionLike | null | undefined>;
  getAccessToken: (...args: unknown[]) => Promise<AccessTokenResult>;
}

interface Flight {
  promise: Promise<AccessTokenResult> | null;
  until: number | null;
  waiters: number;
}

function fromTokenSet(tokenSet: TokenSetLike): AccessTokenResult {
  return {
    token: tokenSet.accessToken as string,
    expiresAt: tokenSet.expiresAt as number,
    scope: tokenSet.scope,
  };
}

function defaultLog(msg: string, ctx: Record<string, unknown>): void {
  // One line per refresh. In production this is what proves a burst produced
  // ONE refresh (coalesced > 0) rather than twenty.
  console.log(`[auth] ${msg}`, ctx);
}

export function createSingleFlightGetAccessToken(
  { getSession, getAccessToken: sdkGetAccessToken }: Sdk,
  { now = () => Date.now() / 1000, log = defaultLog }: Deps = {},
) {
  const flights = new Map<string, Flight>();

  function sweep(nowMs: number): void {
    for (const [key, entry] of flights) {
      if (entry.until !== null && entry.until <= nowMs) flights.delete(key);
    }
  }

  return async function getAccessToken(
    ...args: unknown[]
  ): Promise<AccessTokenResult> {
    // The SDK also accepts `getAccessToken(req, res, options)` — the form that
    // writes refreshed session cookies onto a response the CALLER controls.
    // That is the form middleware uses, and it is the only way a rotated token
    // ever gets persisted. Never intercept it: coalescing it would drop the
    // Set-Cookie side effect that is the entire reason for calling it that way,
    // and the caller would silently keep the stale cookie.
    if (args.length > 1) {
      return sdkGetAccessToken(...args);
    }

    const options = (args[0] ?? {}) as GetAccessTokenOptions;
    const { refreshBuffer = ROUTE_REFRESH_BUFFER_S, ...sdkOptions } =
      options || {};

    // Anything asking for a DIFFERENT token than the session default (another
    // audience/scope) or forcing a refresh outright goes to the SDK untouched.
    // Nothing in Mikro does this today; the branch exists so the wrapper can
    // never silently change what such a call would have returned.
    if (sdkOptions.refresh || sdkOptions.audience || sdkOptions.scope) {
      return sdkGetAccessToken(sdkOptions);
    }

    let session: SessionLike | null | undefined;
    try {
      session = await getSession();
    } catch {
      // A session the SDK cannot read (bad cookie, domain mismatch). Let the
      // SDK's own call raise the error callers already classify.
      return sdkGetAccessToken(sdkOptions);
    }

    const tokenSet = session?.tokenSet;
    if (!session || !tokenSet?.accessToken) {
      // No session, or one with no access token: the SDK throws the correctly
      // coded error for both. Not ours to invent.
      return sdkGetAccessToken(sdkOptions);
    }

    const expiresAt = Number(tokenSet.expiresAt);
    const fresh =
      Number.isFinite(expiresAt) && expiresAt > now() + refreshBuffer;
    if (fresh) {
      // Part 1 — the common path. No SDK, no refresh, no cookie write.
      return fromTokenSet(tokenSet);
    }

    if (!tokenSet.refreshToken) {
      // Expired with nothing to refresh with. The SDK's error says exactly
      // that ("...and a refresh token was not provided"), which is the message
      // the heartbeat logs and classifies.
      return sdkGetAccessToken(sdkOptions);
    }

    // Part 2 — one refresh per refresh token, shared by everyone holding it.
    const nowMs = Date.now();
    sweep(nowMs);

    // Keyed by the refresh token itself: two requests hold the same one only
    // if they came from the same browser with the same cookie — precisely the
    // set of callers that must share a single refresh.
    const key = tokenSet.refreshToken;
    const existing = flights.get(key);
    if (existing?.promise) {
      existing.waiters += 1;
      return existing.promise;
    }

    const entry: Flight = { promise: null, until: null, waiters: 0 };

    // `refresh: true` is load-bearing. The SDK's own trigger is "already
    // expired" (its buffer is 0), so inside OUR buffer the token is usually
    // still valid and the SDK would just hand the old one back — the early
    // refresh the heartbeat exists for would never happen.
    entry.promise = sdkGetAccessToken({ ...sdkOptions, refresh: true }).then(
      (result) => {
        entry.until = Date.now() + RECENT_REFRESH_TTL_MS;
        log("access token refreshed", {
          coalesced: entry.waiters,
          expiresAt: result?.expiresAt,
        });
        return result;
      },
      (error: unknown) => {
        // A FAILED refresh is cached for the same window, deliberately. Twenty
        // callers each retrying a refresh token Auth0 just rejected is the
        // exact storm this file prevents. They all get the same error, the
        // heartbeat classifies it, and the client goes to login once.
        entry.until = Date.now() + RECENT_REFRESH_TTL_MS;
        const err = error as { code?: string; message?: string } | null;
        log("access token refresh failed", {
          coalesced: entry.waiters,
          code: err?.code,
          message: err?.message,
        });
        throw error;
      },
    );

    flights.set(key, entry);
    return entry.promise;
  };
}

/**
 * Replace `getAccessToken` on an Auth0Client instance with the single-flight
 * version.
 *
 * The instance is patched rather than subclassed so every existing caller —
 * `(authenticated)/layout.tsx`, `/auth/heartbeat`, the `/backend` and `/comms`
 * proxies — needs no change at all. The SDK's internals never call
 * `this.getAccessToken`, so nothing inside the SDK is affected.
 */
/**
 * The client with its `getAccessToken` retyped to accept our extra
 * `refreshBuffer` option, and to keep the SDK's `(req, res, options)` overload
 * that middleware relies on to persist a rotated cookie. Without this the
 * SDK's own narrower signature wins and `refreshBuffer` is a type error at
 * every call site.
 */
export type WithSingleFlight<T> = Omit<T, "getAccessToken"> & {
  getAccessToken: {
    (options?: GetAccessTokenOptions): Promise<AccessTokenResult>;
    (
      req: unknown,
      res: unknown,
      options?: GetAccessTokenOptions,
    ): Promise<AccessTokenResult>;
  };
};

export function installSingleFlightAccessToken<
  T extends {
    getSession: (...args: never[]) => unknown;
    getAccessToken: (...args: never[]) => unknown;
  },
>(client: T, deps?: Deps): WithSingleFlight<T> {
  const sdk = client as unknown as Sdk;
  const sdkGetAccessToken = sdk.getAccessToken.bind(client);
  const getSession = () => sdk.getSession.call(client);

  (client as unknown as Sdk).getAccessToken = createSingleFlightGetAccessToken(
    { getSession, getAccessToken: sdkGetAccessToken },
    deps,
  ) as unknown as Sdk["getAccessToken"];

  return client as unknown as WithSingleFlight<T>;
}
