/**
 * Allow-list for the query parameters we are willing to forward from
 * `/auth/login` into Auth0's `/authorize`, and nothing else.
 *
 * WHY THIS FILE EXISTS. `@auth0/nextjs-auth0` v4's login handler forwards the
 * ENTIRE incoming query string to Auth0's `/authorize` endpoint as
 * authorization parameters. In the installed package it is, in effect:
 *
 *     const { returnTo, ...authorizationParameters } = searchParams;
 *
 * There is no allow-list of its own. `/auth/login` is unauthenticated by
 * necessity (you cannot require a session in order to establish one), so
 * anybody — or any stray link — can call it with anything, and without this
 * step every one of those values reaches a third-party authorization request
 * verbatim. Now that Mikro passes `organization` on login as part of its
 * org-based auth, that pass-through stops being theoretical.
 *
 * Reference implementation: the sibling Maprizon app in the same Auth0 tenant
 * solved this first, in
 * `viewer 2/viewer-2-0/client/src/app/utils/loginParams.js`
 * (`sanitizeLoginUrl`), applied from its `src/middleware.js`. This is the same
 * approach in TypeScript, with Mikro's own parameter set.
 *
 * The module is deliberately pure and free of `next/*` imports: it takes a URL
 * and returns a URL, so it can be unit-tested without a request, a server or a
 * running SDK.
 */

/** Longest `login_hint` we will forward. */
const LOGIN_HINT_MAX = 255;

/** Longest `invitation` ticket we will forward. */
const INVITATION_MAX = 512;

/**
 * Deliberately loose: "something, an @, something, a dot, something". We are
 * not trying to validate deliverability, only to reject things that are
 * obviously not an email address.
 */
const PLAUSIBLE_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Auth0 organization ids are `org_` plus an alphanumeric suffix. */
const ORGANIZATION_ID = /^org_[A-Za-z0-9]+$/;

/**
 * The allow-list itself: parameter name -> predicate deciding whether a given
 * value may be forwarded. A parameter absent from this map is dropped, so
 * adding a login parameter is a deliberate edit here rather than an accident
 * somewhere else.
 *
 * Exported so tests can assert on both the set of keys and each rule.
 */
export const LOGIN_PARAM_ALLOWLIST: Readonly<
  Record<string, (value: string) => boolean>
> = {
  // `organization`: an Auth0 organization id, forwarded on every org-scoped
  // login and by the invitation-acceptance route (src/app/accept-invitation/
  // route.ts). Auth0 is its only consumer and validates it itself — an unknown
  // org is refused at /authorize rather than becoming our problem — so the
  // shape check here is just to keep arbitrary text out of the authorization
  // request.
  organization: (value) => ORGANIZATION_ID.test(value),

  // `invitation`: the opaque invitation ticket out of the Auth0 invite email,
  // forwarded by /accept-invitation. Auth0 validates the ticket, so we do not
  // try to parse it; we only cap its length, because an unbounded value here
  // is an unbounded value in an outbound URL.
  invitation: (value) => value.length <= INVITATION_MAX,

  // `prompt`: exactly "login", or dropped.
  //
  // This is the force-the-login-form switch: when a user explicitly clicks
  // "Log in" we want Auth0 to show its form rather than silently reinstating
  // whichever SSO session survived — otherwise someone signed in as an account
  // with no org gets bounced by the no-org check with no way to pick a
  // different account.
  //
  // Any other value is somebody else's idea of how this app should
  // authenticate, arriving on an endpoint anyone can call. `prompt=none` in
  // particular would turn a login link into a silent probe for whether a
  // session exists.
  prompt: (value) => value === "login",

  // `screen_hint`: exactly "signup", or dropped.
  //
  // Sends a brand-new user to Auth0's create-a-password screen instead of a
  // log-in form for an account that does not exist yet. Allow-listed to the one
  // known value rather than passed through, so it stays a switch instead of an
  // open pass-through into the auth request.
  screen_hint: (value) => value === "signup",

  // `login_hint`: a plausible email, length-capped.
  //
  // Pre-fills the email field on Auth0's Universal Login page so somebody who
  // just typed their address into our own form is not asked for it twice.
  // Auth0 owns escaping it on its hosted page, but there is no reason to push
  // arbitrary text into a third-party authorization request when the only
  // legitimate caller ever sends an email address.
  login_hint: (value) =>
    value.length <= LOGIN_HINT_MAX && PLAUSIBLE_EMAIL.test(value),

  // `returnTo`: passed through unchecked, and that is deliberate rather than an
  // oversight. The SDK strips it from the authorization parameters and runs it
  // through its own same-origin sanitiser (`toSafeRedirect`) before using it,
  // so it cannot become an open redirect. Named here so the omission reads as
  // intentional to whoever debugs this next.
  returnTo: () => true,
};

/**
 * Return a copy of `url` whose query string contains only allow-listed
 * parameters carrying allow-listed values. Everything else is dropped.
 *
 * The input is never mutated. Surviving parameters keep their original order,
 * and each surviving parameter appears exactly once, so a caller can decide
 * whether a redirect is needed with a plain string comparison:
 *
 *     const clean = sanitizeLoginUrl(new URL(request.url));
 *     if (clean.href !== request.url) return NextResponse.redirect(clean);
 *
 * Repeated parameters (`?prompt=login&prompt=consent`) are dropped outright
 * rather than reduced to their first value: the SDK's own parsing of a repeated
 * key is not something we want to depend on, and no legitimate caller sends
 * one, so a duplicate is treated as an attempt to smuggle a value past the
 * check.
 */
export function sanitizeLoginUrl(url: URL): URL {
  const sanitized = new URL(url);
  const incoming = url.searchParams;

  // Rebuild the query string rather than deleting from it: `delete` on a
  // URLSearchParams being iterated is easy to get subtly wrong, and rebuilding
  // guarantees the "one value per key" property the doc comment promises.
  const kept = new URLSearchParams();
  let dropped = false;

  // `new Set(incoming.keys())` de-duplicates while preserving first-seen order.
  for (const key of new Set(incoming.keys())) {
    const isAllowed = LOGIN_PARAM_ALLOWLIST[key];
    const values = incoming.getAll(key);

    if (
      isAllowed &&
      values.length === 1 && // repeated key — see doc comment
      isAllowed(values[0])
    ) {
      kept.set(key, values[0]);
    } else {
      dropped = true;
    }
  }

  // Only rewrite the query string if something actually had to go. Reassigning
  // `search` re-serialises every value (a literal `@` in a login_hint comes
  // back as `%40`, say), which would make the href differ from the incoming
  // one and trigger a redirect even when nothing was wrong.
  if (dropped) {
    sanitized.search = kept.toString();
  }
  return sanitized;
}
