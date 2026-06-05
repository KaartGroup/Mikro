"""
Route decorators for the comms service.

- @requires_auth         : a valid JWT projected an Identity onto g.identity
- @requires_admin        : caller is org_admin or above (gates campaigns/broadcasts)
- @requires_hmac         : valid server-to-server HMAC signature (gates /emit)
"""

from functools import wraps

from flask import g, jsonify

from .hmac_auth import verify_hmac


def requires_auth(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        identity = getattr(g, "identity", None)
        if identity is None:
            return jsonify({"message": "Unauthorized", "status": 401}), 401
        return f(*args, **kwargs)

    return wrapper


def requires_admin(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        identity = getattr(g, "identity", None)
        if identity is None:
            return jsonify({"message": "Unauthorized", "status": 401}), 401
        if not identity.is_admin:
            return jsonify({"message": "Forbidden", "status": 403}), 403
        return f(*args, **kwargs)

    return wrapper


def requires_hmac(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if not verify_hmac():
            return jsonify({"message": "Invalid signature", "status": 401}), 401
        return f(*args, **kwargs)

    return wrapper
