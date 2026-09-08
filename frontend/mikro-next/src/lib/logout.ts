"use client";

/**
 * Centralized logout so the app has exactly ONE path to `/auth/logout`.
 *
 * Why this exists: several independent triggers can decide to log the user
 * out — the AuthGuard (mount / refocus / no-user), the API layer on a hard
 * 401, the middleware, and the user clicking a Logout link. When more than
 * one fires in the same page (e.g. a manual click while AuthGuard's focus
 * check is mid-flight), they used to race to `window.location.href`,
 * producing the intermittent "logout didn't work, click it again" behavior.
 *
 * The guard here is a MODULE-LEVEL boolean, deliberately not sessionStorage:
 * the previous guard set a sessionStorage flag and then immediately called
 * `sessionStorage.clear()`, wiping the very flag it just set. An in-memory
 * flag lives for the life of the page (until the navigation replaces it) and
 * cannot be cleared out from under us, so the first caller wins and every
 * later caller is a no-op.
 */

import { logEvent, withLogPreserved } from "@/lib/clientLog";

let loggingOut = false;

/**
 * The ONLY URL the app should send an expired/rejected session to.
 *
 * `prompt=login` is load-bearing, not cosmetic. Clearing our own session
 * cookie does NOT end the Auth0 SSO session, so a bare `/auth/login` finds
 * that SSO session still alive and silently signs the user straight back in
 * as the same account — no prompt, no chance to switch users. That is what
 * users report as "I logged out but it logged me right back in", and what
 * makes an expired session look like an unbreakable loop.
 *
 * The landing page's Log In link already did this (LandingClient.tsx); the
 * session-expiry paths did not. Everything routes through here now so they
 * cannot drift apart again.
 */
export const LOGIN_URL = "/auth/login?prompt=login";

/** True once any logout has begun on this page. */
export function isLoggingOut(): boolean {
  return loggingOut;
}

/**
 * Send the user to a fresh Auth0 login prompt. No-op if a logout is already
 * in flight — a login redirect must never stomp an in-progress logout.
 */
export function redirectToLogin(): void {
  if (loggingOut) return;
  logEvent("warn", "auth.redirect_to_login");
  if (typeof window !== "undefined") {
    window.location.href = LOGIN_URL;
  }
}

/**
 * Mark a logout as in progress without navigating. Used by the manual
 * Logout links, which let the native `<a href="/auth/logout">` do the
 * navigation — this just flips the guard so AuthGuard's session checks
 * stop firing competing redirects while that navigation is in flight.
 */
export function markLoggingOut(): void {
  loggingOut = true;
}

/**
 * Begin a full logout: wipe client-side storage and navigate to the Auth0
 * logout route (which also kills the server session). Safe to call from
 * multiple places — only the first call does anything.
 */
export function beginLogout(): void {
  if (loggingOut) return;
  loggingOut = true;

  // Log BEFORE localStorage.clear() wipes the diagnostic buffer, and rely on
  // the /clientlog POST (keepalive) to survive the navigation — otherwise a
  // forced logout erases the only evidence of why it happened.
  logEvent("error", "auth.forced_logout");

  withLogPreserved(() => {
    try {
      localStorage.clear();
    } catch {}
    try {
      sessionStorage.clear();
    } catch {}
  });

  if (typeof window !== "undefined") {
    window.location.href = "/auth/logout";
  }
}
