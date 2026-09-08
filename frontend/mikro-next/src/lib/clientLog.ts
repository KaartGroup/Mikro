"use client";

/**
 * Persistent client-side diagnostic log.
 *
 * Why this exists: the Aug/Sep 2026 auth outage took days to diagnose because
 * the only evidence was server-side. A user would report "I can't log in" or
 * "I can't clock in", and by the time anyone looked, the browser console was
 * long gone — refreshed away, or on a laptop in another country. Meanwhile the
 * failures that mattered (a 409 from clock_in, a dead token refresh, a forced
 * logout) left no client-side trace at all.
 *
 * Three sinks, deliberately:
 *   1. `localStorage` ring buffer — survives reloads, tab crashes and forced
 *      logouts, so support can ask the user to paste it back hours later.
 *   2. `console` — for anyone with devtools open right now.
 *   3. POST to /clientlog — a Next.js route handler that writes to the server
 *      log, which is the only sink WE can read without the user's help.
 *
 * Sink 3 posts to a Next.js route, NOT /api/* — on DigitalOcean the /api
 * prefix is served by Flask (see accept-invitation/route.ts), and it is
 * deliberately unauthenticated so it still works when the session is the
 * broken thing. That is the whole point: auth failures must be reportable.
 *
 * NEVER log values that could be PII — log event names, keys, status codes and
 * ids. `data` is capped and truncated before it leaves the browser.
 */

const STORAGE_KEY = "mikro:diaglog";
const MAX_ENTRIES = 200;
const MAX_DATA_CHARS = 1000;

export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  /** ISO timestamp. */
  t: string;
  level: LogLevel;
  /** Stable dot-separated event name, e.g. "clockin.rejected". */
  event: string;
  data?: Record<string, unknown>;
  /** Path the event happened on — invaluable for reproducing. */
  path?: string;
}

function safeRead(): LogEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LogEntry[]) : [];
  } catch {
    // Private mode, cleared site data, quota — never let logging break the app.
    return [];
  }
}

function safeWrite(entries: LogEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Quota exceeded — drop the oldest half and try once more, then give up.
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(entries.slice(-Math.floor(MAX_ENTRIES / 2))),
      );
    } catch {
      /* give up silently */
    }
  }
}

function truncate(
  data?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!data) return undefined;
  try {
    const json = JSON.stringify(data);
    if (json.length <= MAX_DATA_CHARS) return data;
    return { _truncated: true, preview: json.slice(0, MAX_DATA_CHARS) };
  } catch {
    return { _unserializable: true, keys: Object.keys(data) };
  }
}

/** Fire-and-forget ship to the server log. Never throws, never awaited. */
function ship(entry: LogEntry): void {
  try {
    // keepalive so the request still goes out when this event is immediately
    // followed by a navigation — which is exactly the case for forced logouts.
    void fetch("/clientlog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
      keepalive: true,
      credentials: "same-origin",
    }).catch(() => {});
  } catch {
    /* offline / blocked — the localStorage copy is still there */
  }
}

/**
 * Record a diagnostic event. Safe to call from anywhere, including error
 * handlers and unload paths.
 */
export function logEvent(
  level: LogLevel,
  event: string,
  data?: Record<string, unknown>,
): void {
  if (typeof window === "undefined") return;

  const entry: LogEntry = {
    t: new Date().toISOString(),
    level,
    event,
    data: truncate(data),
    path: window.location?.pathname,
  };

  const entries = safeRead();
  entries.push(entry);
  safeWrite(entries.slice(-MAX_ENTRIES));

  const line = `[MIKRO] ${entry.event}`;
  if (level === "error") console.error(line, entry.data ?? "");
  else if (level === "warn") console.warn(line, entry.data ?? "");
  else console.info(line, entry.data ?? "");

  ship(entry);
}

/** Everything currently buffered, oldest first. */
export function getLog(): LogEntry[] {
  if (typeof window === "undefined") return [];
  return safeRead();
}

/** Pretty text blob for a user to copy out of the console and paste to support. */
export function dumpLog(): string {
  return getLog()
    .map(
      (e) =>
        `${e.t} ${e.level.toUpperCase()} ${e.event}` +
        `${e.path ? ` path=${e.path}` : ""}` +
        `${e.data ? ` ${JSON.stringify(e.data)}` : ""}`,
    )
    .join("\n");
}

/**
 * Run `fn` with the diagnostic buffer preserved across it.
 *
 * `beginLogout()` calls `localStorage.clear()`, which would otherwise destroy
 * the log at the exact moment it matters most — a forced logout is the event
 * users complain about, and the reason for it is in the entries immediately
 * before it. Wrapping the wipe keeps the history and still clears everything
 * else the session owned.
 */
export function withLogPreserved(fn: () => void): void {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch {
    /* unreadable — nothing to preserve */
  }
  fn();
  try {
    if (saved) localStorage.setItem(STORAGE_KEY, saved);
  } catch {
    /* unwritable — the shipped copy is still in the server log */
  }
}

export function clearLog(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to do */
  }
}

/**
 * Expose on `window` so support can talk a user through it with no tooling:
 * "press F12, type mikroLog() and send me what it prints".
 */
export function installLogGlobals(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as Record<string, unknown>;
  w.mikroLog = dumpLog;
  w.mikroLogClear = clearLog;
}
