import { NextRequest, NextResponse } from "next/server";

/**
 * Auth0 Organization Invitation acceptance entry point.
 *
 * Auth0 sends the invitation email's link here (this path is configured as
 * the application's "Application Login URI" in the Auth0 dashboard) with
 * `?invitation=TICKET&organization=ORG_ID&organization_name=NAME`.
 *
 * IMPORTANT — why this lives at /accept-invitation and not /api/authorize:
 * On DigitalOcean App Platform (.do/app.yaml) the `/api` route prefix is
 * served by the Flask backend, so anything under /api/* never reaches the
 * Next.js app — it hits Flask's auth gate and returns
 * `authorization_header_missing`. This route must live outside /api/*.
 *
 * IMPORTANT — why we delegate to /auth/login instead of building /authorize
 * ourselves: the Auth0 SDK v4 login handler forwards every query param
 * (except returnTo/challengeMode) to /authorize AND sets up the
 * state/nonce/PKCE transaction cookie that /auth/callback validates.
 * Hand-crafting the /authorize URL skips that transaction, so the callback
 * would fail. So we just forward `organization` + `invitation` to the SDK's
 * own login route and let it do the rest (audience/scope come from the
 * Auth0Client config in src/lib/auth0.ts).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const invitation = searchParams.get("invitation");
  const organization = searchParams.get("organization");

  // Build the redirect against the PUBLIC base URL, not request.nextUrl.origin
  // — behind DigitalOcean's proxy the latter resolves to the internal host
  // (e.g. https://localhost:8080), which sends the invitee to a dead URL.
  // APP_BASE_URL is the public origin (same var src/lib/auth0.ts onCallback
  // relies on); fall back to the request origin only for local dev.
  const baseUrl =
    process.env.APP_BASE_URL ??
    process.env.AUTH0_BASE_URL ??
    request.nextUrl.origin;
  const loginUrl = new URL("/auth/login", baseUrl);

  // Only an org invitation carries `organization`. If it's absent (e.g. a
  // bare third-party-initiated login hitting the Login URI), fall through to
  // a normal login rather than erroring. `organization_name` is intentionally
  // dropped — it is not an /authorize parameter.
  if (organization) {
    loginUrl.searchParams.set("organization", organization);
    if (invitation) {
      loginUrl.searchParams.set("invitation", invitation);
    }
  }

  return NextResponse.redirect(loginUrl);
}
