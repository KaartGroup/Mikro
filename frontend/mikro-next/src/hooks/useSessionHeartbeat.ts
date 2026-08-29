"use client";

import { useCallback, useEffect, useRef } from "react";
import { redirectToLogin as goToLogin } from "@/lib/logout";

// How often to ping the heartbeat endpoint while the tab is visible.
// 15 minutes is well under the typical Auth0 access token lifetime (24h default).
const HEARTBEAT_INTERVAL_MS = 15 * 60 * 1000;

// After a transient error, retry sooner.
const RETRY_INTERVAL_MS = 2 * 60 * 1000;

// Max consecutive failures before redirecting to login.
const MAX_CONSECUTIVE_FAILURES = 3;

export function useSessionHeartbeat() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failureCountRef = useRef(0);
  const isMountedRef = useRef(true);
  const lastHeartbeatRef = useRef(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const redirectToLogin = useCallback(() => {
    goToLogin();
  }, []);

  const scheduleNext = useCallback(
    (delayMs: number, fn: () => void) => {
      clearTimer();
      timerRef.current = setTimeout(fn, delayMs);
    },
    [clearTimer],
  );

  const doHeartbeat = useCallback(async () => {
    if (!isMountedRef.current) return;

    const handleTransientFailure = () => {
      failureCountRef.current += 1;
      if (failureCountRef.current >= MAX_CONSECUTIVE_FAILURES) {
        console.warn(
          `[heartbeat] ${MAX_CONSECUTIVE_FAILURES} consecutive failures, redirecting to login`,
        );
        redirectToLogin();
      } else {
        scheduleNext(RETRY_INTERVAL_MS, doHeartbeat);
      }
    };

    try {
      const response = await fetch("/auth/heartbeat", {
        credentials: "same-origin",
      });

      if (!isMountedRef.current) return;

      if (response.ok) {
        failureCountRef.current = 0;
        lastHeartbeatRef.current = Date.now();
        scheduleNext(HEARTBEAT_INTERVAL_MS, doHeartbeat);
      } else if (response.status === 401) {
        console.warn("[heartbeat] Session expired, redirecting to login");
        redirectToLogin();
      } else {
        handleTransientFailure();
      }
    } catch {
      if (!isMountedRef.current) return;
      handleTransientFailure();
    }
  }, [redirectToLogin, scheduleNext]);

  const handleVisibilityChange = useCallback(() => {
    if (document.visibilityState === "visible") {
      const elapsed = Date.now() - lastHeartbeatRef.current;
      if (elapsed >= HEARTBEAT_INTERVAL_MS) {
        // Tab was hidden longer than one heartbeat interval — refresh now
        clearTimer();
        doHeartbeat();
      }
      // Otherwise let the existing timer fire naturally
    } else {
      // Tab hidden — stop polling to avoid unnecessary background requests
      clearTimer();
    }
  }, [doHeartbeat, clearTimer]);

  useEffect(() => {
    isMountedRef.current = true;
    lastHeartbeatRef.current = Date.now();

    // Don't fire immediately on mount — page load already validated the session.
    scheduleNext(HEARTBEAT_INTERVAL_MS, doHeartbeat);

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isMountedRef.current = false;
      clearTimer();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [doHeartbeat, handleVisibilityChange, scheduleNext, clearTimer]);
}
