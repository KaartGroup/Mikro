"use client";

import { useEffect } from "react";

/**
 * Run `tick` every `intervalMs` milliseconds, but ONLY while the tab
 * is visible. Also runs `tick` immediately when the tab regains
 * visibility. Shared by NotificationBell + MessengerIcon (and any
 * future polled widget) — kills copy-paste of the same useEffect.
 */
export function useVisibilityPoll(tick: () => void, intervalMs: number): void {
  useEffect(() => {
    const run = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState !== "visible") return;
      tick();
    };
    const id = window.setInterval(run, intervalMs);
    const onVis = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [tick, intervalMs]);
}
