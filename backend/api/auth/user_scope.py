"""
User-visibility scoping — single source of truth.

Every admin read path over the ``users`` table answers the same
question: *which users may this viewer see, given their org, their
team-admin scope, and the request filters?* Before this module that
logic was reimplemented inline in every list endpoint (Payments,
Users, TimeTracking …), each with its own copy of the team-admin
empty-state guard and the filter intersection, plus single-user
lookups that repeated a ``filter_by(id=, org_id=)`` + ad-hoc access
check.

``UserScope`` consolidates that, mirroring ``TimeEntryScope`` in
``api/time_tracking/scope.py``. It composes the existing policy
modules rather than duplicating them:

  - the role gate (``user``/``validator`` → self only; ``team_admin``
    → managed-team members; org-admin and above → the whole org),
  - the universal ``filters`` narrowing (``resolve_filtered_user_ids``),
  - the generic access gate for single-user lookups,
  - pay-visibility filtering (delegated to ``can_view_pay_for``).

These helpers fail closed: a None viewer, a missing target, or a
cross-org access attempt all return None-restriction-denied / [] /
False as appropriate.
"""

from ..database import User
from ..filters import resolve_filtered_user_ids
from .team_scoping import (
    managed_team_ids_for,
    team_member_ids_for,
    team_admin_can_access_user,
    is_org_admin_or_above,
)
from .pay_visibility import can_view_pay_for


class UserScope:
    """Translates ``(viewer, request filters)`` into User-table scope."""

    def __init__(self, viewer):
        self.viewer = viewer
        self.org_id = getattr(viewer, "org_id", None)
        self.role = getattr(viewer, "role", None)

    # ── canonical guard ─────────────────────────────────────────────
    @staticmethod
    def _match_nothing():
        """The single false condition for every "no users" scope.

        ``User.id`` is the Auth0 sub (a non-null primary key), so
        ``IS NULL`` reliably matches zero rows — the User-table twin of
        ``TimeEntryScope.match_nothing``. Avoids the empty-``IN`` path.
        """
        return User.id.is_(None)

    # ── role gate (no filters) ──────────────────────────────────────
    def _role_scoped_ids(self):
        """The user-id ceiling this viewer may see, before filters.

        - org-admin / super_admin → ``None`` (no constraint: whole org).
        - team_admin → set of members across managed teams (``set()`` if
          they lead no teams: the zero-team team_admin empty state).
        - anyone else → ``set()`` (route gate usually blocks them; self
          access is handled separately by ``can_access`` / ``get``).
        """
        if is_org_admin_or_above(self.viewer):
            return None
        if self.role == "team_admin":
            return team_member_ids_for(managed_team_ids_for(self.viewer))
        return set()

    # ── role gate ∩ universal filters ───────────────────────────────
    def visible_user_ids(self, filters=None):
        """Viewer's role/team ceiling INTERSECTED with the ``filters`` body.

        ``filters`` is the universal dict shape ({region, country, team,
        role, timezone, ...}) resolved by ``resolve_filtered_user_ids``.

        Returns the same tri-state every list call site consumes:

          - ``None``  → no constraint (org-admin+ AND no filters): all org users.
          - ``set()`` → nothing matches: caller yields no rows.
          - ``set``   → the allowed user-id set.

        The team ceiling is never *widened* by a filter — a filter can
        only narrow within what the viewer may already see, so the
        page-level filter and the team scope can never conflict.
        """
        scoped = self._role_scoped_ids()  # None | set | set()
        resolved = resolve_filtered_user_ids(filters, self.org_id)  # None | list
        if resolved is None:
            return scoped
        resolved = set(resolved)
        if scoped is None:
            return resolved
        return scoped & resolved

    # ── scoped list query ───────────────────────────────────────────
    def query(self, *, filters=None, active_only=False):
        """``User.query`` scoped to org + ``visible_user_ids`` + active flag.

        Returns a SQLAlchemy query so callers can add their own joins,
        columns (``with_entities``), or ordering. An empty scope yields a
        query that returns no rows — replacing the repeated
        ``if not scoped_ids: return []`` branches at the call sites.
        """
        q = User.query.filter(User.org_id == self.org_id)
        if active_only:
            q = q.filter(User.is_active.is_(True))

        ids = self.visible_user_ids(filters)
        if ids is None:
            return q
        if not ids:
            return q.filter(self._match_nothing())
        return q.filter(User.id.in_(list(ids)))

    def users(self, **kwargs):
        """Convenience: ``self.query(**kwargs).all()``."""
        return self.query(**kwargs).all()

    # ── single-user access gate ─────────────────────────────────────
    def can_access(self, target):
        """True if ``viewer`` may act on ``target`` (a User or its id).

        Generic access gate, distinct from ``can_view_pay_for`` (which
        adds a pay-specific rank gate). The rule:

          - self → always,
          - org-admin / super_admin → any user in the same org,
          - team_admin → members of a team they lead,
          - anyone else → never.

        Fails closed on a None viewer/target.
        """
        if self.viewer is None or target is None:
            return False
        target_id = getattr(target, "id", target)
        if not target_id:
            return False
        viewer_id = getattr(self.viewer, "id", None)
        if viewer_id is not None and viewer_id == target_id:
            return True
        if is_org_admin_or_above(self.viewer):
            # Cross-org rail: an org admin only reaches users in their org.
            target_org = getattr(target, "org_id", None)
            if target_org is not None:
                return target_org == self.org_id
            return True  # id-only target; org checked by get()'s query filter
        if self.role == "team_admin":
            return team_admin_can_access_user(self.viewer, target_id)
        return False

    def get(self, user_id, *, active_only=False):
        """Fetch a single user enforcing org scope + ``can_access``.

        Returns ``None`` when the user does not exist, is in another org,
        is inactive (when ``active_only``), or the viewer may not access
        them — replacing the ``filter_by(id=, org_id=)`` + manual gate
        pattern and the bare viewer-context ``User.query.get(user_id)``.
        """
        if not user_id:
            return None
        q = User.query.filter(User.id == user_id, User.org_id == self.org_id)
        if active_only:
            q = q.filter(User.is_active.is_(True))
        user = q.first()
        if user is None or not self.can_access(user):
            return None
        return user

    # ── pay-visibility filter ───────────────────────────────────────
    def pay_visible(self, users):
        """Drop targets whose pay this viewer may not see.

        Thin wrapper over ``can_view_pay_for`` for the payment tables —
        replaces the inline ``[u for u in q.all() if can_view_pay_for(...)]``.
        """
        return [u for u in users if can_view_pay_for(self.viewer, u)]
