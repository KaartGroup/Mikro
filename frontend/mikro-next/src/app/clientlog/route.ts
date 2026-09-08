import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";

/**
 * Sink for browser diagnostic events from src/lib/clientLog.ts.
 *
 * Writes to the Next.js server log — the one place we can read without asking
 * the user to fetch anything. Grep the app logs for "[CLIENTLOG]".
 *
 * IMPORTANT — why this lives at /clientlog and not /api/clientlog:
 * on DigitalOcean the /api prefix is served by Flask, so anything under
 * /api/* never reaches Next.js (same reason accept-invitation lives at the
 * root). It also must be listed in the middleware pass-through, or the
 * session check will bounce it to /auth/logout.
 *
 * DELIBERATELY does not require a session. The events most worth capturing are
 * auth failures — a dead token refresh, a forced logout — and an authenticated
 * endpoint cannot receive those by definition. The session is read only to
 * attribute the entry when one happens to exist.
 *
 * Because it is unauthenticated it is also reachable by the scanner traffic
 * this host already attracts, so: hard body cap, strict field whitelist, fixed
 * output shape. Nothing here is echoed back to the caller.
 */

const MAX_BODY_BYTES = 4096;
const MAX_EVENT_LEN = 120;
const MAX_PATH_LEN = 200;
const MAX_DATA_CHARS = 1000;

const LEVELS = new Set(["info", "warn", "error"]);

function clamp(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

export async function POST(request: NextRequest) {
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return NextResponse.json({ ok: false }, { status: 413 });
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    const event = clamp(body.event, MAX_EVENT_LEN);
    if (!event) return NextResponse.json({ ok: false }, { status: 400 });

    const level = LEVELS.has(body.level as string)
      ? (body.level as string)
      : "info";
    const path = clamp(body.path, MAX_PATH_LEN);

    let data = "";
    if (body.data && typeof body.data === "object") {
      try {
        data = JSON.stringify(body.data).slice(0, MAX_DATA_CHARS);
      } catch {
        data = "<unserializable>";
      }
    }

    // Attribute to a user when we can, but never require it.
    let sub = "";
    try {
      const session = await auth0.getSession(request);
      sub = (session?.user?.sub as string | undefined) ?? "";
    } catch {
      /* no session — expected for auth-failure events */
    }

    const line =
      `[CLIENTLOG] level=${level} event=${event}` +
      ` sub=${sub || "-"} path=${path || "-"}` +
      ` ip=${request.headers.get("x-forwarded-for") ?? "-"}` +
      (data ? ` data=${data}` : "");

    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.info(line);

    return NextResponse.json({ ok: true });
  } catch {
    // Logging must never surface an error to the app.
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
