import { auth0 } from "@/lib/auth0";
import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.FLASK_BACKEND_URL || "http://localhost:5004";

/**
 * Generic proxy handler for all backend API calls.
 * This route proxies requests to the Flask backend, adding the Auth0 access token.
 *
 * Example: /backend/user/fetch_user_role -> BACKEND_URL/api/user/fetch_user_role
 */
async function handleRequest(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const session = await auth0.getSession(request);

    if (!session) {
      // Real "user has no session" case — fail fast.
      console.warn("[BACKEND-PROXY] 401 no session for", request.url);
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { path } = await params;
    const backendPath = path.join("/");
    const url = new URL(request.url);
    const queryString = url.search;

    const backendUrl = `${BACKEND_URL}/api/${backendPath}${queryString}`;

    // Prefer an actively-refreshed access token over whatever is sitting in
    // session.tokenSet — browser session cookies can arrive with partially
    // valid tokens after a just-completed login, and getAccessToken triggers
    // the refresh-token dance via the SDK when the current token is stale.
    let accessToken: string | undefined;
    try {
      const tokenResp = await auth0.getAccessToken();
      accessToken = tokenResp?.token ?? session.tokenSet?.accessToken;
    } catch (err) {
      console.warn(
        "[BACKEND-PROXY] getAccessToken threw — falling back to session.tokenSet.accessToken",
        err,
      );
      accessToken = session.tokenSet?.accessToken;
    }

    if (!accessToken) {
      console.warn(
        "[BACKEND-PROXY] 401 no access token after refresh attempt for",
        request.url,
        "— session present?",
        !!session,
        "tokenSet present?",
        !!session.tokenSet,
      );
      return NextResponse.json(
        { error: "Access token expired" },
        { status: 401 },
      );
    }

    const headers: HeadersInit = {
      Authorization: `Bearer ${accessToken}`,
    };

    // Preserve the original Content-Type (critical for multipart file uploads)
    const incomingContentType = request.headers.get("content-type");
    if (incomingContentType) {
      headers["Content-Type"] = incomingContentType;
    } else if (request.method !== "GET") {
      headers["Content-Type"] = "application/json";
    }

    // Stream body through directly — preserves multipart boundaries and binary data
    const body = request.method !== "GET" ? request.body : null;

    const fetchInit: RequestInit & { duplex?: string } = {
      method: request.method,
      headers,
      body,
    };

    // Node.js fetch requires duplex: "half" for streaming request bodies
    if (body) {
      fetchInit.duplex = "half";
    }

    const response = await fetch(backendUrl, fetchInit);

    // Check content type to handle non-JSON responses (CSV, PDF exports)
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
    console.error("Backend proxy error:", error);
    return NextResponse.json(
      { error: "Failed to proxy request to backend" },
      { status: 500 },
    );
  }
}

export const GET = handleRequest;
export const POST = handleRequest;
export const PUT = handleRequest;
export const DELETE = handleRequest;
export const PATCH = handleRequest;
