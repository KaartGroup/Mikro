#!/usr/bin/env python3
"""
Server-to-server endpoints for other Kaart apps (no JWT).

``POST /api/internal/kaart-user-lookup`` — Maprizon's account deletion asks
whether a person's shared Auth0 login is also a Mikro user, so it knows not
to delete the Auth0 identity. Authenticated by the ``X-Kaart-Lookup-Secret``
header (``KAART_USER_LOOKUP_SECRET``, same value on Maprizon, Tasking Manager
and Mikro); exempted from JWT in ``api/auth/auth.py``. The caller fails
closed, so any error here only means "treat as a Kaart user".
"""

import hashlib
import hmac
import logging

from flask.views import MethodView
from flask import request, current_app

from .. import users_repo

logger = logging.getLogger(__name__)


class InternalAPI(MethodView):
    """Shared-secret endpoints called by other Kaart backends."""

    def post(self, path):
        if path == "kaart-user-lookup":
            return self.kaart_user_lookup()
        return {"error": "Unknown internal path"}, 404

    def kaart_user_lookup(self):
        """200 {"exists": bool} — true if ANY user row (deactivated or
        soft-deleted included) has this Auth0 sub."""
        secret = current_app.config.get("KAART_USER_LOOKUP_SECRET")
        if not secret:
            logger.error("KAART_USER_LOOKUP_SECRET not configured")
            return {"error": "Lookup not configured"}, 503

        provided = request.headers.get("X-Kaart-Lookup-Secret", "")
        if not hmac.compare_digest(provided.encode("utf-8"), secret.encode("utf-8")):
            return {"error": "Invalid lookup secret"}, 401

        payload = request.get_json(silent=True) or {}
        sub = payload.get("auth0_sub") if isinstance(payload, dict) else None
        if not isinstance(sub, str) or not sub.strip():
            return {"error": "auth0_sub is required"}, 400

        exists = users_repo.exists_by_auth0_sub(sub)
        # Never log the raw sub — a short hash is enough to correlate.
        logger.info(
            "kaart-user-lookup sub_sha256=%s exists=%s",
            hashlib.sha256(sub.encode("utf-8")).hexdigest()[:12],
            exists,
        )
        return {"exists": exists}, 200
