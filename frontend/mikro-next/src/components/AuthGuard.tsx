"use client";

import { useEffect, useRef } from "react";
import { useUser } from "@auth0/nextjs-auth0/client";
import { useSessionHeartbeat } from "@/hooks/useSessionHeartbeat";
import { beginLogout, isLoggingOut } from "@/lib/logout";
import { logEvent, installLogGlobals } from "@/lib/clientLog";

/**
 * AuthGuard — aggressive session integrity checker.
 *
 * If ANY sign of a broken/missing/stale session is detected:
 *   1. Clears all client-side storage
 *   2. Redirects to /auth/logout (kills Auth0 server session too)
 *
 * Checks run:
 *   - On mount (lightweight API ping)
 *   - On tab/window refocus
 *   - When useUser() reports no user after loading completes
 *
 * All logout navigation goes through the shared `beginLogout()` helper
 * (see lib/logout.ts) so these three triggers — plus a manual Logout
 * click and the API-layer 401 handler — can't race each other into
 * duplicate/half-completed logouts.
 */

async function verifySession(): Promise<boolean> {
  try {
    const res = await fetch("/backend/user/fetch_user_role", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    return res.status !== 401;
  } catch {
    // Network error — don't nuke on transient failures
    return true;
  }
}

export function AuthGuard() {
  const { user, isLoading } = useUser();
  const hadUser = useRef(false);

  // Keep session alive by proactively refreshing the access token.
  // Pings /api/auth/heartbeat every 15 min while tab is visible.
  useSessionHeartbeat();

  // Track whether we ever had a user
  useEffect(() => {
    if (user) hadUser.current = true;
  }, [user]);

  // If useUser() finishes loading and there's no user, nuke it
  useEffect(() => {
    if (!isLoading && !user && !isLoggingOut()) {
      logEvent("error", "authguard.no_user", { hadUser: hadUser.current });
      beginLogout();
    }
  }, [isLoading, user]);

  // Verify session on mount
  useEffect(() => {
    installLogGlobals();
    if (isLoggingOut()) return;
    verifySession().then((valid) => {
      if (!valid) {
        logEvent("error", "authguard.session_invalid", { trigger: "mount" });
        beginLogout();
      }
    });
  }, []);

  // Re-verify on tab focus / visibility change
  useEffect(() => {
    const handleFocus = () => {
      if (isLoggingOut()) return;
      verifySession().then((valid) => {
        if (!valid) {
          logEvent("error", "authguard.session_invalid", { trigger: "focus" });
          beginLogout();
        }
      });
    };

    // Must be a named reference: the previous version added an inline arrow
    // here and removed `handleFocus`, so the cleanup silently did nothing and
    // each remount stacked another listener — multiplying verifySession()
    // calls (and now log entries) on every tab focus.
    const handleVisibility = () => {
      if (document.visibilityState === "visible") handleFocus();
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  return null;
}
