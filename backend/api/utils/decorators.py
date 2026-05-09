#!/usr/bin/env python3
"""
Decorators for Mikro API.

These decorators provide role-based access control and utility functions.
Authentication is handled by the before_request hook in app.py.
"""

import cProfile
import pstats
from functools import wraps
from enum import IntFlag

from flask import g, request, jsonify, current_app


def _trace_decorator(event: str, **kw):
    """[AUTH-TRACE] logger for decorator-level rejects."""
    try:
        ip = request.headers.get("X-Forwarded-For", "").split(",")[0].strip() or request.remote_addr
    except Exception:
        ip = "?"
    path = getattr(request, "path", "?")
    sub = None
    try:
        if hasattr(g, "current_user") and g.current_user:
            sub = g.current_user.get("sub")
    except Exception:
        pass
    parts = [f"event={event}", f"path={path}", f"ip={ip}"]
    if sub:
        parts.append(f"sub={sub!r}")
    for k, v in kw.items():
        parts.append(f"{k}={v!r}")
    current_app.logger.warning("[AUTH-TRACE] " + " ".join(parts))


class TeamRole(IntFlag):
    """Describes a role a team can have for a project."""

    VIEWER = 2
    CREATOR = 4
    VIEW_CREATE = 8


class TeamMemberFunction(IntFlag):
    """Describes a role a user can have within a team."""

    MEMBER = 1
    MANAGER = 2


def profile(func):  # pragma: no cover
    """
    Profile a function.

    A file with the name of profile_<function_name>.out
    will be written to the current directory.
    """

    @wraps(func)
    def inner(*args, **kwargs):
        profiler = cProfile.Profile()
        profiler.enable()
        try:
            return_value = func(*args, **kwargs)
        finally:
            profiler.disable()
            filename = "".join(["profile_", func.__qualname__])
            with open(filename + ".print.profile", "w") as profile_file:
                stats = pstats.Stats(profiler, stream=profile_file)
                stats.dump_stats(filename + ".pstat")
                stats.print_stats()
        return return_value

    return inner


def requires_auth(f):
    """
    Decorator to require authenticated user.

    The actual JWT validation is done by the before_request hook.
    This decorator checks that g.user was set.
    """

    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not hasattr(g, "user") or not g.user:
            _trace_decorator("requires_auth_reject", reason="no_g_user")
            return jsonify({"message": "Unauthorized", "status": 401}), 401
        # Deactivated accounts are blocked even with a valid token.
        # Admin must reactivate before they can use the app again.
        if not getattr(g.user, "is_active", True):
            _trace_decorator("requires_auth_reject", reason="user_inactive")
            return jsonify({
                "message": "Your account has been deactivated. Contact your admin.",
                "status": 401,
                "reason": "deactivated",
            }), 401
        return f(*args, **kwargs)

    return decorated_function


_ORG_ADMIN_ROLES = {"admin", "super_admin"}
_TEAM_ADMIN_OR_ABOVE_ROLES = {"admin", "super_admin", "team_admin"}


def requires_admin(f):
    """
    Decorator to require Org Admin tier or above.

    Passes for `admin` (Org Admin) and `super_admin`. Does NOT pass for
    `team_admin` — team_admin endpoints use `requires_team_admin_or_above`
    and do their own scoping inside the handler.

    The user must be authenticated and active.
    """

    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not hasattr(g, "user") or not g.user:
            _trace_decorator("requires_admin_reject", reason="no_g_user")
            return jsonify({"message": "Unauthorized", "status": 401}), 401
        if not getattr(g.user, "is_active", True):
            _trace_decorator("requires_admin_reject", reason="user_inactive")
            return jsonify({
                "message": "Your account has been deactivated. Contact your admin.",
                "status": 401,
                "reason": "deactivated",
            }), 401
        if g.user.role not in _ORG_ADMIN_ROLES:
            _trace_decorator(
                "requires_admin_reject",
                reason="wrong_role",
                role=g.user.role,
                user_id=g.user.id,
            )
            return (
                jsonify(
                    {
                        "message": "Admin access required",
                        "status": 403,
                    }
                ),
                403,
            )
        return f(*args, **kwargs)

    return decorated_function


def requires_team_admin_or_above(f):
    """
    Decorator to require any admin tier.

    Passes for `team_admin`, `admin`, and `super_admin`. The handler is
    responsible for further scoping — a team_admin must only act on
    teams/users they manage. Use `team_admin_can_access_team` and
    `team_admin_can_access_user` from `auth/team_scoping.py` for that.
    """

    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not hasattr(g, "user") or not g.user:
            _trace_decorator("requires_team_admin_or_above_reject", reason="no_g_user")
            return jsonify({"message": "Unauthorized", "status": 401}), 401
        if not getattr(g.user, "is_active", True):
            _trace_decorator(
                "requires_team_admin_or_above_reject", reason="user_inactive"
            )
            return jsonify({
                "message": "Your account has been deactivated. Contact your admin.",
                "status": 401,
                "reason": "deactivated",
            }), 401
        if g.user.role not in _TEAM_ADMIN_OR_ABOVE_ROLES:
            _trace_decorator(
                "requires_team_admin_or_above_reject",
                reason="wrong_role",
                role=g.user.role,
                user_id=g.user.id,
            )
            return (
                jsonify(
                    {
                        "message": "Admin access required",
                        "status": 403,
                    }
                ),
                403,
            )
        return f(*args, **kwargs)

    return decorated_function


def requires_super_admin(f):
    """
    Decorator to require super_admin role.

    Reserved for cross-org operations (org onboarding, billing, etc.).
    No callsites yet — added now so the predicate seam exists.
    """

    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not hasattr(g, "user") or not g.user:
            _trace_decorator("requires_super_admin_reject", reason="no_g_user")
            return jsonify({"message": "Unauthorized", "status": 401}), 401
        if not getattr(g.user, "is_active", True):
            _trace_decorator("requires_super_admin_reject", reason="user_inactive")
            return jsonify({
                "message": "Your account has been deactivated. Contact your admin.",
                "status": 401,
                "reason": "deactivated",
            }), 401
        if g.user.role != "super_admin":
            _trace_decorator(
                "requires_super_admin_reject",
                reason="wrong_role",
                role=g.user.role,
                user_id=g.user.id,
            )
            return (
                jsonify(
                    {
                        "message": "Super admin access required",
                        "status": 403,
                    }
                ),
                403,
            )
        return f(*args, **kwargs)

    return decorated_function


_VALIDATOR_OR_ABOVE_ROLES = {
    "validator",
    "team_admin",
    "admin",
    "super_admin",
}


def requires_validator(f):
    """
    Decorator to require validator role or any admin tier.

    Passes for `validator`, `team_admin`, `admin`, and `super_admin`.
    Admin tiers are strictly more privileged than `validator`, so any
    endpoint a validator can reach an admin can reach too.
    """

    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not hasattr(g, "user") or not g.user:
            _trace_decorator("requires_validator_reject", reason="no_g_user")
            return jsonify({"message": "Unauthorized", "status": 401}), 401
        if g.user.role not in _VALIDATOR_OR_ABOVE_ROLES:
            _trace_decorator(
                "requires_validator_reject",
                reason="wrong_role",
                role=g.user.role,
                user_id=g.user.id,
            )
            return (
                jsonify(
                    {
                        "message": "Validator access required",
                        "status": 403,
                    }
                ),
                403,
            )
        return f(*args, **kwargs)

    return decorated_function


def verify_access_to_resources(f):
    """
    Decorator to verify user has access to the requested project.

    Checks that the project exists.
    """

    @wraps(f)
    def decorated_function(*args, **kwargs):
        from ..database import Project

        project_id = request.args.get("project")
        if not project_id or not project_id.isdigit():
            return jsonify({"message": "Project id is required!", "status": 400}), 400

        project = Project.get_by_id(project_id)
        if not project:
            return jsonify({"message": "Project does not exist!", "status": 404}), 404

        return f(*args, **kwargs)

    return decorated_function


# Legacy compatibility - jwt_verification is no longer needed
# Auth is now handled by before_request hook
def jwt_verification(f):
    """
    Legacy decorator - no longer needed.

    JWT verification is now handled by the before_request hook in app.py.
    This decorator is kept for backwards compatibility but does nothing.
    """

    @wraps(f)
    def wrapper(*args, **kwargs):
        return f(*args, **kwargs)

    return wrapper
