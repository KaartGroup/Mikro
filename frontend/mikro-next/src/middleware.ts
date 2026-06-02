import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth0 } from "./lib/auth0";

export default async function proxy(request: NextRequest) {
  // Auth0 middleware handles /auth/* routes AND maintains session cookies
  const authRes = await auth0.middleware(request);

  // Let Auth0 fully handle /auth routes
  if (request.nextUrl.pathname.startsWith("/auth")) {
    return authRes;
  }

  // Let the authorize route handle org invitation acceptance
  if (request.nextUrl.pathname === "/api/authorize") {
    return authRes;
  }

  // Transcribe worker iframe needs COOP/COEP for SharedArrayBuffer (WASM pthreads)
  if (request.nextUrl.pathname === "/transcribe-worker") {
    const response = NextResponse.next();
    response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
    response.headers.set("Cross-Origin-Embedder-Policy", "require-corp");
    return response;
  }

  // Public routes - pass through with auth cookies maintained
  const publicRoutes = [
    "/",
    "/welcome",
    "/unauthorized",
    "/no-org",
    "/wrong-org",
    "/transcribe-worker",
  ];
  const isPublicRoute = publicRoutes.some(
    (route) => request.nextUrl.pathname === route,
  );

  if (isPublicRoute) {
    return authRes;
  }

  // Protected routes require authentication
  const session = await auth0.getSession(request);
  if (!session) {
    // No session at all — send to logout to ensure any stale cookies are cleared
    const { origin } = new URL(request.url);
    return NextResponse.redirect(`${origin}/auth/logout`);
  }

  // Check if access token is missing or expired — getSession() can return
  // stale sessions where the token is expired, so users appear "logged in"
  // but all API calls fail. Kill the session entirely.
  const accessToken = session.tokenSet?.accessToken;
  const expiresAt = session.tokenSet?.expiresAt;
  if (
    !accessToken ||
    (expiresAt && expiresAt < Math.floor(Date.now() / 1000))
  ) {
    const { origin } = new URL(request.url);
    return NextResponse.redirect(`${origin}/auth/logout`);
  }

  return authRes;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, sitemap.xml, robots.txt (metadata files)
     */
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
