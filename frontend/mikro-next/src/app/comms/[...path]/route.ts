import { auth0 } from "@/lib/auth0";
import { NextRequest, NextResponse } from "next/server";

/**
 * Comms-service proxy.
 *
 * The comms platform (notifications / messenger / email campaigns) is a
 * SEPARATE Flask service from Mikro's own backend. This route mirrors the
 * Mikro backend proxy at src/app/backend/[...path]/route.ts — same Auth0
 * access-token attachment dance — but forwards to the comms service base URL
 * instead of the Mikro Flask backend.
 *
 * The base URL comes from the SERVER-SIDE env var `COMMS_PROXY_URL`
 * (in-cluster this is the internal service address "http://comms:8080";
 * "http://localhost:5005" in local dev). It is never exposed to the
 * browser. If unset we fall back to a local dev default.
 *
 * NOTE: the comms service registers its routes at the ROOT (no "/api"
 * prefix) — e.g. POST /notifications/unread_count — unlike Mikro's Flask
 * backend, which lives under /api. So we forward to COMMS_PROXY_URL/<path>
 * directly, NOT COMMS_PROXY_URL/api/<path>.
 *
 * Example: /comms/notifications/unread_count
 *            -> COMMS_PROXY_URL/notifications/unread_count
 */
const COMMS_URL = process.env.COMMS_PROXY_URL || "http://localhost:5005";

async function handleRequest(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const session = await auth0.getSession(request);

    if (!session) {
      console.warn("[COMMS-PROXY] 401 no session for", request.url);
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { path } = await params;
    const commsPath = path.join("/");
    const url = new URL(request.url);
    const queryString = url.search;

    const commsUrl = `${COMMS_URL}/${commsPath}${queryString}`;

    // Prefer an actively-refreshed access token over whatever is sitting in
    // session.tokenSet — getAccessToken triggers refresh-token rotation when
    // the current token is stale (identical to the Mikro backend proxy).
    let accessToken: string | undefined;
    try {
      const tokenResp = await auth0.getAccessToken();
      accessToken = tokenResp?.token ?? session.tokenSet?.accessToken;
    } catch (err) {
      console.warn(
        "[COMMS-PROXY] getAccessToken threw — falling back to session.tokenSet.accessToken",
        err,
      );
      accessToken = session.tokenSet?.accessToken;
    }

    if (!accessToken) {
      console.warn(
        "[COMMS-PROXY] 401 no access token after refresh attempt for",
        request.url,
      );
      return NextResponse.json(
        { error: "Access token expired" },
        { status: 401 },
      );
    }

    const headers: HeadersInit = {
      Authorization: `Bearer ${accessToken}`,
    };

    const incomingContentType = request.headers.get("content-type");
    if (incomingContentType) {
      headers["Content-Type"] = incomingContentType;
    } else if (request.method !== "GET") {
      headers["Content-Type"] = "application/json";
    }

    const body = request.method !== "GET" ? request.body : null;

    const fetchInit: RequestInit & { duplex?: string } = {
      method: request.method,
      headers,
      body,
    };

    if (body) {
      fetchInit.duplex = "half";
    }

    const response = await fetch(commsUrl, fetchInit);

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      const responseHeaders = new Headers();
      responseHeaders.set("Content-Type", contentType);
      const disposition = response.headers.get("content-disposition");
      if (disposition) {
        responseHeaders.set("Content-Disposition", disposition);
      }
      const blob = await response.arrayBuffer();
      return new NextResponse(blob, {
        status: response.status,
        headers: responseHeaders,
      });
    }

    const data = await response.json();

    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Comms proxy error:", error);
    return NextResponse.json(
      { error: "Failed to proxy request to comms service" },
      { status: 500 },
    );
  }
}

export const GET = handleRequest;
export const POST = handleRequest;
export const PUT = handleRequest;
export const DELETE = handleRequest;
export const PATCH = handleRequest;
