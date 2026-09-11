import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth0 } from "./lib/auth0";
import { sanitizeLoginUrl } from "./lib/loginParams";

/**
 * Refresh the access token this many seconds before it expires.
 *
 * Larger than `ROUTE_REFRESH_BUFFER_S` in lib/accessToken.ts on purpose:
 * middleware runs on a real navigation, which the browser does not abandon,
 * so it is the ideal place to renew a token early and spare the API routes
 * (whose requests CAN be cancelled mid-flight) from ever having to.
 */
const MIDDLEWARE_REFRESH_BUFFER_S = 120;

export default async function proxy(request: NextRequest) {
  // Auth0 middleware handles /auth/* routes AND maintains session cookies
  const authRes = await auth0.middleware(request);

  // Strip anything we are not willing to forward into Auth0's /authorize.
  //
  // The SDK's v4 login handler forwards the ENTIRE query string it receives on
  // /auth/login as authorization parameters, with no allow-list of its own, and
  // /auth/login is unauthenticated by necessity — so anything appended to that
  // URL becomes an OAuth parameter. See src/lib/loginParams.ts for the rules.
  //
  // THIS MUST COME BEFORE the `startsWith("/auth")` early return below: that
  // return hands the request straight to the SDK, so a check placed after it
  // would never run for the one path it exists to protect. Redirecting (rather
  // than rewriting) means the SDK re-enters this middleware and only ever sees
  // an already-clean query string.
  if (request.nextUrl.pathname === "/auth/login") {
    const clean = sanitizeLoginUrl(new URL(request.url));
    if (clean.href !== request.url) {
      return NextResponse.redirect(clean);
    }
  }

  // Let Auth0 fully handle /auth routes
  if (request.nextUrl.pathname.startsWith("/auth")) {
    return authRes;
  }

  // Let the invitation-acceptance route run for logged-out invitees instead
  // of bouncing them to logout. (Lives at /accept-invitation, not /api/*,
  // because /api/* is routed to the Flask backend on prod — see the route.)
  if (request.nextUrl.pathname === "/accept-invitation") {
    return authRes;
  }

  // Diagnostic log sink (src/lib/clientLog.ts). Must bypass the session check
  // below: the events most worth capturing are auth failures, so requiring a
  // valid session here would discard exactly the ones we need. Lives outside
  // /api/* because that prefix is served by Flask on prod.
  if (request.nextUrl.pathname === "/clientlog") {
    return authRes;
  }

  // Public routes - pass through with auth cookies maintained
  const publicRoutes = [
    "/",
    "/welcome",
    "/unauthorized",
    "/no-org",
    "/wrong-org",
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

  // A session with no access token at all is unusable — nothing to refresh.
  const accessToken = session.tokenSet?.accessToken;
  if (!accessToken) {
    const { origin } = new URL(request.url);
    return NextResponse.redirect(`${origin}/auth/logout`);
  }

  // REFRESH HERE. Do not log the user out for a merely-expired access token.
  //
  // This block used to redirect to /auth/logout the moment `expiresAt` was in
  // the past, which turned "this token needs renewing" — the most routine
  // event in the whole auth system — into a silent, unexplained logout. It is
  // why users reported being thrown back to the login page several times a
  // day.
  //
  // Middleware is also the ONLY place a refreshed token can be persisted:
  // Server Components cannot set cookies, so a refresh triggered from
  // `(authenticated)/layout.tsx` is computed and then thrown away while the
  // cookie keeps the spent token. Auth0's own v4 guidance is to refresh in
  // middleware for exactly this reason.
  //
  // Passing (request, authRes) is load-bearing: that is the SDK form which
  // writes Set-Cookie onto a response we control, so the rotated token
  // actually reaches the browser.
  const expiresAt = session.tokenSet?.expiresAt;
  const nowS = Math.floor(Date.now() / 1000);
  const hasExpiry = typeof expiresAt === "number";
  const expired = hasExpiry && expiresAt <= nowS;
  const nearExpiry =
    hasExpiry && expiresAt <= nowS + MIDDLEWARE_REFRESH_BUFFER_S;

  if (nearExpiry) {
    try {
      await auth0.getAccessToken(request, authRes, { refresh: true });
    } catch (err) {
      console.warn(
        "[middleware] token refresh failed",
        err instanceof Error ? err.message : String(err),
      );
      // Only give up if the token is ACTUALLY expired. If it is merely inside
      // the refresh buffer it is still valid, so a transient refresh failure
      // must not cost the user their session — let the request through and try
      // again on the next one.
      if (expired) {
        const { origin } = new URL(request.url);
        return NextResponse.redirect(`${origin}/auth/logout`);
      }
    }
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
