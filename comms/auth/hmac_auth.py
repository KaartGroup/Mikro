"""
HMAC-SHA256 verification for server-to-server event emits.

App backends (Mikro, Viewer, TM4) POST notification events to /emit signed
with the shared COMMS_WEBHOOK_SECRET. This is the same scheme TM4 already
uses to reach Mikro, so the clients have a working reference implementation.

Signature: hex( HMAC-SHA256(secret, raw_request_body) ), sent in the
`X-Comms-Signature` header.
"""

import hashlib
import hmac

from flask import request, current_app


def verify_hmac() -> bool:
    """True if the request body carries a valid HMAC signature."""
    secret = current_app.config.get("COMMS_WEBHOOK_SECRET")
    if not secret:
        current_app.logger.error("[EMIT] COMMS_WEBHOOK_SECRET not configured")
        return False

    sent = request.headers.get("X-Comms-Signature", "")
    if not sent:
        return False

    expected = hmac.new(
        secret.encode("utf-8"),
        request.get_data(),  # raw bytes, exactly as signed by the sender
        hashlib.sha256,
    ).hexdigest()

    return hmac.compare_digest(sent, expected)
