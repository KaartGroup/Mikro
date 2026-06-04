import { Auth0Client } from "@auth0/nextjs-auth0/server";
import { NextResponse } from "next/server";

// Long-lived rolling sessions with proactive token refresh:
// - rolling: session extends while active within inactivityDuration
// - inactivityDuration 7d: idle tab cap
// - absoluteDuration 30d: hard cap regardless of activity
// - offline_access scope issues the refresh token used by getAccessToken()
// - useSessionHeartbeat (client) pings /auth/heartbeat every 15 min to keep
//   the access token fresh; fetchWithAuth catches 401s as a safety net
//   (NOTE: lives under /auth/ — the /api/ prefix is routed to Flask on prod)
// Requires Auth0 dashboard: Refresh Token Rotation + Reuse Detection enabled,
// Refresh Token Absolute Lifetime >= 30 days, Inactivity Lifetime >= 7 days.
export const auth0 = new Auth0Client({
  authorizationParameters: {
    audience: process.env.AUTH0_AUDIENCE,
    scope: "openid profile email offline_access",
  },
  session: {
    rolling: true,
    inactivityDuration: 60 * 60 * 24 * 7,
    absoluteDuration: 60 * 60 * 24 * 30,
  },
  async beforeSessionSaved(session) {
    // In SDK v4, session.user contains all ID token claims including custom ones
    // Preserve mikro/roles and other custom claims
    return {
      ...session,
      user: {
        ...session.user,
        // Ensure custom claims are preserved (they should already be there)
        "mikro/roles": session.user["mikro/roles"],
      },
    };
  },
  // Reject logins where the user has no org_id — happens with test accounts or
  // invitations that weren't tied to an Auth0 organization. Without this check
  // the user lands on a blank app or a raw error page with no way back.
  async onCallback(error, ctx, session) {
    // Auth0 SDK v4 reads APP_BASE_URL at client init; use the same here instead
    // of AUTH0_BASE_URL (which is the v3 name and may not be populated on prod).
    // Keep AUTH0_BASE_URL as a compat fallback so local .env.local still works.
    const baseUrl = process.env.APP_BASE_URL ?? process.env.AUTH0_BASE_URL;
    if (!baseUrl) {
      throw new Error(
        "APP_BASE_URL is not set — cannot build redirect URL in onCallback",
      );
    }
    if (error) {
      return NextResponse.redirect(
        new URL(
          `/unauthorized?error=${encodeURIComponent(error.code || error.message)}`,
          baseUrl,
        ),
      );
    }
    // Prefer the namespaced claim (mikro/org_id) set by the post-login Action
    // from app_metadata; fall back to Auth0's native org_id for users who DO
    // log in via an Organization URL.
    const orgId =
      (session?.user["mikro/org_id"] as string | undefined) ??
      (session?.user.org_id as string | undefined);
    if (session && !orgId) {
      return NextResponse.redirect(new URL("/no-org", baseUrl));
    }
    // Org VALIDITY (is this org active in Mikro?) is now decided by the
    // backend at /api/login against the organizations table — the single
    // source of truth — so multiple active orgs, not just Kaart, can log in.
    // A disabled or unknown org is rejected there and the authenticated
    // layout routes it to /wrong-org. We keep only the no-org fast-path here.
    return NextResponse.redirect(new URL(ctx.returnTo ?? "/", baseUrl));
  },
});
