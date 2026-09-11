"""
Auth0 JWT validation module for Mikro API.

This module provides JWT token validation against Auth0's JWKS endpoint.
Pattern adapted from Viewer application.
"""

import json
import os
import re
import time as _time
from urllib.request import urlopen

from flask import request, jsonify, g, current_app
from jose import jwt
import requests

# In-memory JWKS cache (shared across requests in the same process)
_jwks_cache = {"data": None, "fetched_at": 0}
_JWKS_CACHE_TTL = 3600  # 1 hour


class AuthError(Exception):
    """Custom exception for authentication errors."""

    def __init__(self, error, status_code):
        self.error = error
        self.status_code = status_code


def _trace_auth(event: str, **kw):
    """
    Emit a [AUTH-TRACE] structured log for the auth flow.

    Every 401 / redirect / decision point in the auth path calls this so
    DO logs can be filtered with `grep AUTH-TRACE` when a user reports
    a login issue. Keep fields short + parseable.
    """
    try:
        ip = (
            request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
            or request.remote_addr
        )
    except Exception:
        ip = "?"
    try:
        ua = (request.headers.get("User-Agent") or "")[:80]
    except Exception:
        ua = "?"
    path = getattr(request, "path", "?")
    parts = [f"event={event}", f"path={path}", f"ip={ip}"]
    for k, v in kw.items():
        parts.append(f"{k}={v!r}")
    parts.append(f"ua={ua!r}")
    current_app.logger.warning("[AUTH-TRACE] " + " ".join(parts))


# ───────────────────────── ORG RESOLUTION (SSOT) ─────────────────────────
#
# THE single place Mikro decides "which organization is this request in".
# Everything downstream (Login.py, org gating, provisioning) must consume
# `resolved_org_id()` and never re-read an org claim off the token itself.
#
# Why this exists: org identity used to be read straight off the
# `mikro/org_id` custom claim in exactly one place (Login.py), which made the
# whole system depend on an Auth0 Action that writes `app_metadata.org_id`.
# When that claim went missing the org gate silently failed OPEN, and members
# whose Mikro row held the correct org were still refused — because nothing
# ever asked the database. Modelled on Maprizon's 3-tier chain
# (server/flaskr/auth/auth.py in the viewer repo), which solved this already.
#
# Precedence, highest first:
#   1. native `org_id`      — Auth0 emits this on an ORG-SCOPED login (i.e. an
#                             `organization` param reached /authorize). Most
#                             trustworthy: Auth0 itself verified membership.
#   2. `mikro/org_id`       — namespaced custom claim from app_metadata, set by
#                             the post-login Action. Needed for clients that
#                             cannot send `organization=` at all.
#   3. the caller's DB row  — last resort. Marked `org_id_from_local_row` so
#                             privilege checks can refuse a backfilled org, and
#                             skipped for soft-deleted users so an erased
#                             identity's stale org is never reinstated.
#
# A tier-3 org is NOT proof of current Auth0 membership — it is the last known
# good value. Treat it as sufficient for scoping, never for granting
# privilege across tenants.
#
# WHY LOGIN CAN SAFELY FAIL CLOSED ON None (see Login.py). It looks like a
# first-ever login must break — no DB row means no tier 3 — but people do not
# join Mikro by visiting /auth/login. They arrive from an Auth0 invitation
# email, which lands on /accept-invitation and forwards `organization=<org_id>`
# to /authorize (see frontend/src/app/accept-invitation/route.ts). That makes
# the login ORG-SCOPED, so Auth0 issues the native `org_id` claim — tier 1 —
# and it does so itself, independently of the post-login Action and of
# app_metadata. A new invitee therefore resolves on tier 1 with no DB row at
# all, and the row that first login creates carries the right org, which then
# feeds tier 3 for every subsequent bare login. The chain is self-healing:
#
#   invite  → tier 1 (native claim) → user row written with the correct org
#   later   → tier 3 (that row)     → resolves forever after
#
# So an identity reaching here with no org has neither a row NOR an invitation
# context — i.e. was never invited. Refusing it is correct, not collateral.

ORG_ID_RE = re.compile(r"^org_[A-Za-z0-9]+$")


def _valid_org_id(value):
    """True if `value` looks like a real Auth0 organization id."""
    return isinstance(value, str) and bool(ORG_ID_RE.match(value))


def _normalize_org_claim(payload):
    """
    Resolve tiers 1 and 2 into `payload["org_id"]`.

    Mutates `payload` in place and records provenance in
    `payload["org_id_source"]` (``"native"`` | ``"namespaced"`` | ``None``).
    A malformed value in either position is discarded rather than trusted.
    """
    if not isinstance(payload, dict):
        return

    native = payload.get("org_id")
    if _valid_org_id(native):
        payload["org_id_source"] = "native"
        return

    namespace = current_app.config.get("AUTH0_NAMESPACE", "mikro")
    namespaced = payload.get(f"{namespace}/org_id")
    if _valid_org_id(namespaced):
        payload["org_id"] = namespaced
        payload["org_id_source"] = "namespaced"
        return

    # Neither tier produced a usable value. Clear any malformed leftover so
    # downstream truthiness checks cannot act on garbage.
    payload.pop("org_id", None)
    payload["org_id_source"] = None


def _backfill_org_from_db_user(payload, user):
    """
    Tier 3: supply the org from the caller's own DB row when the token names
    none. No-op if a claim already won, if there is no row, or if the row is
    soft-deleted.
    """
    if not isinstance(payload, dict) or payload.get("org_id"):
        return
    if user is None or getattr(user, "deleted_date", None) is not None:
        return

    org_id = getattr(user, "org_id", None)
    if _valid_org_id(org_id):
        payload["org_id"] = org_id
        payload["org_id_source"] = "local_row"
        payload["org_id_from_local_row"] = True


def resolve_request_org(payload, user):
    """
    Run the full chain for one request. Called by `authenticate_request`
    immediately after `g.user` is loaded; not intended for direct use in views.
    """
    _normalize_org_claim(payload)
    _backfill_org_from_db_user(payload, user)


def resolved_org_id():
    """
    The organization for the current request, or None.

    This is the accessor every caller should use. Reading an org claim off
    `g.current_user` directly bypasses the chain and is the bug this module
    exists to prevent.
    """
    payload = getattr(g, "current_user", None)
    if not isinstance(payload, dict):
        return None
    return payload.get("org_id")


def org_id_source():
    """Which tier supplied the org: "native" | "namespaced" | "local_row" | None."""
    payload = getattr(g, "current_user", None)
    if not isinstance(payload, dict):
        return None
    return payload.get("org_id_source")


def org_id_is_backfilled():
    """
    True when the org came from the DB row rather than a verified claim.

    Callers granting cross-tenant privilege must refuse a backfilled org —
    it is a last-known-good value, not proof of current Auth0 membership.
    """
    payload = getattr(g, "current_user", None)
    if not isinstance(payload, dict):
        return False
    return bool(payload.get("org_id_from_local_row"))


# ─────────────────────────────────────────────────────────────────────────


def get_token_auth_header():
    """
    Extract the Bearer token from the Authorization header.

    Returns:
        str: The JWT token

    Raises:
        AuthError: If the header is missing or malformed
    """
    auth = request.headers.get("Authorization", None)

    if not auth:
        _trace_auth("reject_no_auth_header")
        raise AuthError(
            {
                "code": "authorization_header_missing",
                "description": "Authorization header is expected",
            },
            401,
        )

    parts = auth.split()

    if parts[0].lower() != "bearer":
        _trace_auth("reject_bearer_prefix", got_prefix=parts[0] if parts else "")
        raise AuthError(
            {
                "code": "invalid_header",
                "description": "Authorization header must start with Bearer",
            },
            401,
        )
    elif len(parts) == 1:
        _trace_auth("reject_bearer_no_token")
        raise AuthError(
            {"code": "invalid_header", "description": "Token not found"}, 401
        )
    elif len(parts) > 2:
        _trace_auth("reject_bearer_extra_parts", part_count=len(parts))
        raise AuthError(
            {
                "code": "invalid_header",
                "description": "Authorization header must be Bearer token",
            },
            401,
        )

    return parts[1]


def authenticate_request():
    """
    Validate JWT token from Authorization header.

    This function is called before each request to validate the JWT token.
    It fetches the JWKS from Auth0 and validates the token signature,
    audience, and issuer.

    Returns:
        None on success, or a JSON error response on failure
    """
    # Skip auth for health checks and preflight OPTIONS requests
    if request.method == "OPTIONS":
        return None

    if request.path in ["/health", "/api/health"]:
        return None

    # Skip auth for OSM OAuth callback - it's called by OSM's redirect, not authenticated user
    if request.path == "/api/osm/callback":
        return None

    # Skip JWT auth for webhook endpoints — they use HMAC verification instead
    if request.path.startswith("/api/webhook/"):
        return None

    # Only authenticate /api/* routes - let other routes pass through
    if not request.path.startswith("/api/"):
        return None

    try:
        auth0_domain = current_app.config.get("AUTH0_DOMAIN")
        api_audience = current_app.config.get("API_AUDIENCE")
        algorithms = current_app.config.get("ALGORITHMS", ["RS256"])

        if not auth0_domain:
            current_app.logger.error("AUTH0_DOMAIN not configured")
            raise AuthError(
                {"code": "config_error", "description": "Auth0 not configured"}, 500
            )

        token = get_token_auth_header()

        # Fetch JWKS from Auth0 (cached with TTL)
        now = _time.time()
        if _jwks_cache["data"] and (now - _jwks_cache["fetched_at"]) < _JWKS_CACHE_TTL:
            jwks = _jwks_cache["data"]
        else:
            jsonurl = urlopen(
                f"https://{auth0_domain}/.well-known/jwks.json", timeout=5
            )
            jwks = json.loads(jsonurl.read())
            _jwks_cache["data"] = jwks
            _jwks_cache["fetched_at"] = now

        # Get the unverified header to find the key ID
        unverified_header = jwt.get_unverified_header(token)
        rsa_key = {}

        # Find the matching key in JWKS
        for key in jwks["keys"]:
            if key["kid"] == unverified_header["kid"]:
                rsa_key = {
                    "kty": key["kty"],
                    "kid": key["kid"],
                    "use": key["use"],
                    "n": key["n"],
                    "e": key["e"],
                }
                break

        if rsa_key:
            try:
                # Decode and validate the token
                payload = jwt.decode(
                    token,
                    rsa_key,
                    algorithms=algorithms,
                    audience=api_audience,
                    issuer=f"https://{auth0_domain}/",
                )

                # Store the decoded payload in Flask's g object
                g.current_user = payload

                # Try to load the user from the database
                try:
                    from ..database import User

                    auth0_sub = payload.get("sub")
                    if auth0_sub:
                        user = User.query.filter_by(auth0_sub=auth0_sub).first()
                        g.user = user
                        if user is None:
                            # Token verified but no DB row for this sub yet.
                            # Most endpoints will 401 via @requires_auth right
                            # after this — log so we can see it in the trail.
                            _trace_auth(
                                "jwt_ok_no_db_user",
                                sub=auth0_sub,
                                email=payload.get("email"),
                            )
                    else:
                        _trace_auth("jwt_ok_no_sub_claim")
                        g.user = None
                except Exception as e:
                    current_app.logger.warning(f"Could not load user from DB: {e}")
                    _trace_auth("db_lookup_failed", err=str(e))
                    g.user = None

                # Resolve the request's organization ONCE, here, for every
                # request — not just /api/login. See the ORG RESOLUTION block
                # above. Wrapped so a resolution bug can never 500 the whole
                # API: the worst case is `resolved_org_id()` returning None,
                # which callers already have to handle.
                try:
                    resolve_request_org(payload, getattr(g, "user", None))
                except Exception as e:
                    current_app.logger.warning(f"Org resolution failed: {e}")
                    _trace_auth("org_resolution_failed", err=str(e))

                return None

            except jwt.ExpiredSignatureError:
                _trace_auth("reject_token_expired")
                raise AuthError(
                    {"code": "token_expired", "description": "Token has expired"}, 401
                )

            except jwt.JWTClaimsError as e:
                _trace_auth(
                    "reject_invalid_claims",
                    err=str(e),
                    audience_expected=api_audience,
                )
                raise AuthError(
                    {
                        "code": "invalid_claims",
                        "description": "Incorrect claims. Please check the audience and issuer",
                    },
                    401,
                )

            except Exception as e:
                current_app.logger.error(f"Token parsing error: {e}")
                _trace_auth("reject_token_parse_error", err=str(e))
                raise AuthError(
                    {
                        "code": "invalid_header",
                        "description": "Unable to parse authentication token",
                    },
                    401,
                )

        _trace_auth(
            "reject_no_matching_jwks_key",
            kid=unverified_header.get("kid"),
            jwks_kids=[k.get("kid") for k in jwks.get("keys", [])],
        )
        raise AuthError(
            {"code": "invalid_header", "description": "Unable to find appropriate key"},
            401,
        )

    except AuthError as e:
        return jsonify(e.error), e.status_code

    except Exception as e:
        current_app.logger.error(f"Authentication error: {e}")
        _trace_auth("reject_unhandled_auth_error", err=str(e))
        return (
            jsonify(
                {
                    "code": "auth_error",
                    "description": f"An error occurred during authentication: {str(e)}",
                }
            ),
            401,
        )


def get_auth0_management_api_token():
    """
    Retrieve an access token for Auth0 Management API.

    This is used for server-to-server calls to Auth0's Management API,
    such as creating users or updating user metadata.

    Returns:
        str: Access token for Management API, or None on failure
    """
    auth0_domain = os.getenv("AUTH0_DOMAIN")
    client_id = os.getenv("AUTH0_M2M_CLIENT_ID")
    client_secret = os.getenv("AUTH0_M2M_CLIENT_SECRET")

    if not all([auth0_domain, client_id, client_secret]):
        print("Missing Auth0 M2M credentials")
        return None

    url = f"https://{auth0_domain}/oauth/token"

    payload = {
        "grant_type": "client_credentials",
        "client_id": client_id,
        "client_secret": client_secret,
        "audience": f"https://{auth0_domain}/api/v2/",
    }

    try:
        response = requests.post(url, json=payload)
        response.raise_for_status()
        return response.json()["access_token"]
    except requests.RequestException as e:
        print(f"Failed to retrieve Auth0 Management API token: {e}")
        return None
