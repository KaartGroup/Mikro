"""
Auth0 JWT validation module for Mikro API.

This module provides JWT token validation against Auth0's JWKS endpoint.
Pattern adapted from Viewer application.
"""

import json
import os
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
