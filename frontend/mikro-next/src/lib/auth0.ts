import { Auth0Client } from "@auth0/nextjs-auth0/server";
import { NextResponse } from "next/server";
import { orgClaimSource, orgIdFromClaims } from "@/lib/org";
import { installSingleFlightAccessToken } from "@/lib/accessToken";

// Long-lived rolling sessions with proactive token refresh:
// - rolling: session extends while active within inactivityDuration
// - inactivityDuration 7d: idle tab cap
// - absoluteDuration 30d: hard cap regardless of activity
// - offline_access scope issues the refresh token used by getAccessToken()
// - useSessionHeartbeat (client) pings /auth/heartbeat every 15 min to keep
//   the access token fresh; useApi catches 401s as a safety net
//   (NOTE: lives under /auth/ — the /api/ prefix is routed to Flask on prod)
//
// REQUIRED Auth0 dashboard settings:
//   API (the AUTH0_AUDIENCE one) → "Allow Offline Access"      : ON
//     ^ Without this Auth0 silently DROPS the offline_access scope below.
//       Login still succeeds, but no refresh token is ever issued, so every
//       session dies at the first access-token expiry and the user is thrown
//       back to the login page. This was off on 2026-08-27 and caused a
//       multi-day outage of exactly that shape.
//   Application → "Set Idle Refresh Token Lifetime"    : >= 7 days  (matches inactivityDuration)
//   Application → "Set Maximum Refresh Token Lifetime" : >= 30 days (matches absoluteDuration)
//   Application → Grant Types → "Refresh Token"        : checked
//
//   Application → "Allow Refresh Token Rotation"       : OFF until verified.
//     ^ The two things that made rotation unsafe are now fixed:
//         1. Refresh happens in src/middleware.ts, which CAN write the session
//            cookie, so a rotated token is actually persisted. Server
//            Components cannot set cookies, which is why a refresh triggered
//            from (authenticated)/layout.tsx used to be computed and thrown
//            away while the cookie kept the spent token.
//         2. getAccessToken() is single-flighted (src/lib/accessToken.ts), so
//            a burst of parallel requests presents one refresh token once
//            instead of N times — the pattern Auth0 reads as token theft.
//       Turn rotation back on only AFTER both are deployed and a full working
//       day shows no `ferrt` events for this client id in the Auth0 logs.
//       See Auth0 SDK v4 docs, "Getting an access token > On the server
//       (App Router)".
// `getAccessToken` on this instance is NOT the SDK's own.
// `installSingleFlightAccessToken` replaces it so that a burst of parallel
// requests hitting a near-expired token produces ONE refresh instead of one
// per request. The SDK has no such guard, and simultaneous reuse of a single
// rotating refresh token is what Auth0 reads as token theft — it revoked a
// Maprizon user's whole grant family for it on 2026-09-03, and produced the
// same `ferrt` event for Mikro's client id on 2026-09-06. Refresh Token
// Rotation must stay OFF until this is deployed and proven.
//
// Every caller keeps calling `auth0.getAccessToken()` unchanged.
// See src/lib/accessToken.ts.
export const auth0 = installSingleFlightAccessToken(
  new Auth0Client({
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
      // Preserve mikro/roles, the org claims and other custom claims.
      //
      // The org claims are re-asserted EXPLICITLY, not left to the spread above.
      // Today they survive only because of `...session.user`; the moment anyone
      // converts this into an allow-list (a very natural "let's only persist what
      // we need" refactor) the org claim vanishes from the session, every user
      // looks org-less to the frontend, and the whole tenant gets bounced. Both
      // spellings matter: Auth0's native `org_id` (emitted on an org-scoped /
      // org-picker login) and the namespaced `mikro/org_id` set from app_metadata
      // by the post-login Action. Keep both lines here.
      return {
        ...session,
        user: {
          ...session.user,
          // Ensure custom claims are preserved (they should already be there)
          "mikro/roles": session.user["mikro/roles"],
          "mikro/org_id": session.user["mikro/org_id"],
          org_id: session.user.org_id,
        },
      };
    },
    // Handle the Auth0 callback: surface auth errors, then hand off to returnTo.
    //
    // DO NOT reinstate an org gate here. This used to redirect to /no-org
    // whenever the ID token carried no org claim, and that was the
    // "No Organization Found" bug reported on 2026-09-10: a confirmed member of
    // an organization was refused because a TOKEN CLAIM IS NOT THE SOURCE OF
    // TRUTH — the database is. Their Mikro row held the correct org_id the whole
    // time. Worse, this callback runs BEFORE the first POST /api/login, so the
    // authoritative check could never even be reached.
    //
    // Org resolution now belongs entirely to the backend, which decides through a
    // 3-tier chain (native claim → namespaced claim → the caller's DB row) and
    // returns a verdict from POST /api/login. The authenticated layout asks for
    // that verdict on the very next request and routes on it via
    // redirectForVerdict() (see src/lib/org.ts). Anything we could decide here is
    // a guess made with strictly less information.
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
      // Telemetry ONLY — never a gate. Whether the token carried an org claim, and
      // which spelling supplied it, is the single most useful fact when this bug
      // class recurs (org-picker login behaving differently from a personal-account
      // login). Log it and move on; an absent claim is not a rejection.
      if (session) {
        const orgId = orgIdFromClaims(session.user);
        console.info(
          `[auth0.onCallback] org claim ${orgId ? "present" : "absent"}` +
            ` (source=${orgClaimSource(session.user) ?? "none"})` +
            " — org verdict deferred to backend /api/login",
        );
      }
      return NextResponse.redirect(new URL(ctx.returnTo ?? "/", baseUrl));
    },
  }),
);
