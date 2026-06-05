"""Auth package for the comms service."""

from .jwt import authenticate_request, AuthError
from .hmac_auth import verify_hmac
from .decorators import requires_auth, requires_admin, requires_hmac

__all__ = [
    "authenticate_request",
    "AuthError",
    "verify_hmac",
    "requires_auth",
    "requires_admin",
    "requires_hmac",
]
