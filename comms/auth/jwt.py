"""
Auth0 JWT validation for the comms service.

One shared Auth0 tenant backs every Kaart app, so a token minted for Mikro,
Viewer, or TM4 is all signed by the same issuer — only the `aud` differs.
We therefore verify signature + issuer normally but accept ANY audience in
the configured API_AUDIENCES set (checked explicitly, not via jose).

On every authenticated request we upsert an Identity row from the token
claims (email / org_id / role). That projection is the only thing the emit
path reads — comms never touches a client app's user table.

Pattern adapted from Mikro's backend/api/auth/auth.py.
"""

import json
import time as _time
from urllib.request import urlopen

from flask import request, jsonify, g, current_app
from jose import jwt

_jwks_cache = {"data": None, "fetched_at": 0}
_JWKS_CACHE_TTL = 3600  # 1 hour

# Paths that skip JWT auth entirely.
_PUBLIC_PATHS = {"/health", "/api/health"}
# Server-to-server emit verifies an HMAC signature instead of a JWT.
_HMAC_PREFIXES = ("/emit", "/api/emit")


class AuthError(Exception):
    def __init__(self, error, status_code):
        self.error = error
        self.status_code = status_code


def get_token_auth_header() -> str:
    """Extract the Bearer token from the Authorization header."""
    auth = request.headers.get("Authorization", None)
    if not auth:
        raise AuthError(
            {
                "code": "authorization_header_missing",
                "description": "Authorization header is expected",
            },
            401,
        )
    parts = auth.split()
    if parts[0].lower() != "bearer":
        raise AuthError(
            {
                "code": "invalid_header",
                "description": "Authorization header must start with Bearer",
            },
            401,
        )
    if len(parts) == 1:
        raise AuthError(
            {"code": "invalid_header", "description": "Token not found"}, 401
        )
    if len(parts) > 2:
        raise AuthError(
            {
                "code": "invalid_header",
                "description": "Authorization header must be Bearer token",
            },
            401,
        )
    return parts[1]


def _first_claim(payload: dict, keys: list[str]):
    """Return the first present, non-empty claim among `keys`."""
    for k in keys:
        val = payload.get(k)
        if val not in (None, "", []):
            return val
    return None


def _highest_role(roles) -> str:
    """Map a token roles claim (list or str) to the highest known role."""
    from ..database import ROLE_PRIORITY

    if isinstance(roles, str):
        roles = [roles]
    if not roles:
        return "user"
    best = "user"
    best_rank = -1
    for r in roles:
        rank = ROLE_PRIORITY.get(str(r), -1)
        if rank > best_rank:
            best_rank, best = rank, str(r)
    return best if best_rank >= 0 else "user"


def _fetch_jwks(auth0_domain: str) -> dict:
    now = _time.time()
    if _jwks_cache["data"] and (now - _jwks_cache["fetched_at"]) < _JWKS_CACHE_TTL:
        return _jwks_cache["data"]
    with urlopen(f"https://{auth0_domain}/.well-known/jwks.json", timeout=5) as resp:
        jwks = json.loads(resp.read())
    _jwks_cache["data"] = jwks
    _jwks_cache["fetched_at"] = now
    return jwks


def _sync_identity(payload: dict):
    """Upsert the Identity projection from token claims. Writes only when
    something actually changed, so the common (read) path stays write-free."""
    from ..database import Identity, db

    sub = payload.get("sub")
    if not sub:
        g.identity = None
        return

    cfg = current_app.config
    email = payload.get("email")
    org_id = _first_claim(payload, cfg.get("ORG_CLAIM_KEYS", []))
    role = _highest_role(_first_claim(payload, cfg.get("ROLES_CLAIM_KEYS", [])))
    display_name = payload.get("name") or payload.get("nickname") or email

    identity = db.session.get(Identity, sub)
    try:
        if identity is None:
            identity = Identity(
                sub=sub,
                email=email,
                display_name=display_name,
                org_id=org_id,
                role=role,
            )
            db.session.add(identity)
            db.session.commit()
        else:
            changed = False
            for field, value in (
                ("email", email),
                ("display_name", display_name),
                ("org_id", org_id),
                ("role", role),
            ):
                # Don't clobber a known value with a missing claim.
                if value is not None and getattr(identity, field) != value:
                    setattr(identity, field, value)
                    changed = True
            if changed:
                db.session.commit()
    except Exception as e:  # never let identity sync break the request
        db.session.rollback()
        current_app.logger.warning(f"[IDENTITY-SYNC] failed sub={sub}: {e}")
        identity = db.session.get(Identity, sub)

    g.identity = identity


def authenticate_request():
    """before_request hook: validate the JWT and project the Identity."""
    if request.method == "OPTIONS":
        return None
    if request.path in _PUBLIC_PATHS:
        return None
    if any(request.path.startswith(p) for p in _HMAC_PREFIXES):
        return None  # HMAC-verified, not JWT

    try:
        auth0_domain = current_app.config.get("AUTH0_DOMAIN")
        audiences = set(current_app.config.get("API_AUDIENCES", []))
        algorithms = current_app.config.get("ALGORITHMS", ["RS256"])
        # Fail CLOSED on misconfig: without a configured audience allow-list
        # we must NOT fall through and accept any audience.
        if not auth0_domain or not audiences:
            raise AuthError(
                {"code": "config_error", "description": "Auth0 not configured"}, 500
            )

        token = get_token_auth_header()
        jwks = _fetch_jwks(auth0_domain)
        unverified_header = jwt.get_unverified_header(token)

        rsa_key = {}
        for key in jwks["keys"]:
            if key["kid"] == unverified_header["kid"]:
                rsa_key = {k: key[k] for k in ("kty", "kid", "use", "n", "e")}
                break
        if not rsa_key:
            raise AuthError(
                {
                    "code": "invalid_header",
                    "description": "Unable to find appropriate key",
                },
                401,
            )

        # Verify signature + issuer; accept any audience here, then check
        # the aud claim against our allowed set explicitly below.
        payload = jwt.decode(
            token,
            rsa_key,
            algorithms=algorithms,
            issuer=f"https://{auth0_domain}/",
            options={"verify_aud": False},
        )

        token_auds = payload.get("aud")
        if isinstance(token_auds, str):
            token_auds = [token_auds]
        token_auds = set(token_auds or [])
        if not (token_auds & audiences):
            raise AuthError(
                {
                    "code": "invalid_claims",
                    "description": "Token audience not accepted by comms",
                },
                401,
            )

        g.current_user = payload
        _sync_identity(payload)
        return None

    except jwt.ExpiredSignatureError:
        return (
            jsonify({"code": "token_expired", "description": "Token has expired"}),
            401,
        )
    except AuthError as e:
        return jsonify(e.error), e.status_code
    except Exception as e:
        current_app.logger.error(f"[AUTH] token error: {e}")
        return (
            jsonify(
                {
                    "code": "invalid_header",
                    "description": "Unable to parse authentication token",
                }
            ),
            401,
        )
