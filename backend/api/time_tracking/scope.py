"""
TimeEntry visibility scoping — single source of truth.

Every read path over ``time_entries`` has to answer the same question:
*which users' entries is this viewer allowed to see, given the requested
filters?* Before this module that logic was reimplemented at least four
ways — in ``TimeEntryQuery``, in ``TimeTrackingHelpers._apply_team_admin_scope``,
inline in several ``TimeTracking`` endpoints, and again in the reports
package — each with its own copy of the "empty team → match nothing"
guard (some used ``user_id == None``, some used a ``"__no_match__"``
sentinel).

``TimeEntryScope`` consolidates that into one collaborator:

  - the role gate (``user`` → self; ``team_admin`` → managed-team members;
    org-admin and above → the whole org),
  - the ``filters`` / ``userId`` / ``teamId`` request-narrowing precedence,
  - the team-admin post-narrowing applied on top of admin-level filters,
  - the member-id allow-list resolver (``resolve_member_ids``) the reports
    package delegates to,
  - and the canonical false condition used whenever a scope resolves to
    "no users".

Query classes compose an instance of this; ``reports.helpers`` and the legacy
``TimeTrackingHelpers._apply_team_admin_scope`` delegate here so the
implementations never drift.
"""

from ..database import TimeEntry, TeamUser
from ..filters import resolve_filtered_user_ids
from ..auth import managed_team_ids_for, team_member_ids_for


class TimeEntryScope:
    """Translates ``(viewer, request filters)`` into TimeEntry conditions."""

    def __init__(self, viewer, org_id):
        self.viewer = viewer
        self.org_id = org_id
        self.role = getattr(viewer, "role", None)

    # ── canonical guards ────────────────────────────────────────────
    @staticmethod
    def match_nothing():
        """The single false condition used for every "no users" scope.

        Centralized so empty-team / zero-team-team_admin cases never
        diverge across call sites (they used to use different sentinels).
        """
        return TimeEntry.user_id == None  # noqa: E711

    @staticmethod
    def _team_member_ids(team_id):
        return [tu.user_id for tu in TeamUser.query.filter_by(team_id=team_id).all()]

    # ── pre-resolved member allow-list ──────────────────────────────
    def member_ids_conditions(self, member_ids) -> list:
        """Conditions for an already-resolved member-id allow-list.

        Report / payroll callers resolve their visible-member set upstream
        (``resolve_member_ids`` / ``resolve_member_id_filter``) — which
        already folds team-admin narrowing into a single list — and inject it
        here rather than going through the role-driven ``user_scope_conditions``
        path. The tri-state mirrors that resolver exactly:

          - ``None``  → no restriction (all org members),
          - ``[]``    → the canonical match-nothing guard (was a hand-rolled
            ``"__no_match__"`` sentinel at several call sites),
          - ``[ids]`` → ``user_id IN (ids)``.
        """
        if member_ids is None:
            return []
        if not member_ids:
            return [self.match_nothing()]
        return [TimeEntry.user_id.in_(member_ids)]

    # ── member-id resolution (id-list twin of user_scope_conditions) ─
    def resolve_member_ids(self, filters=None, user_id=None, team_id=None):
        """Resolve (``filters`` / ``userId`` / ``teamId`` + team-admin
        narrowing) to a member-id allow-list.

        This is the id-list counterpart of ``user_scope_conditions``: report
        and aggregate callers that hand a resolved ``member_ids`` list to a
        query (rather than letting it build SQL conditions) resolve it here,
        so the precedence rules and the team-admin intersection live in one
        place. Returns the same tri-state ``member_ids_conditions`` consumes:

          - ``None``  → no restriction (all org members),
          - ``[]``    → no users (empty filter, or a zero-team team_admin),
          - ``[ids]`` → the resolved subset.

        ``team_admin`` viewers are intersected with their managed-team
        members; every other role passes through unrestricted (the role-gate
        for plain ``user`` viewers belongs to ``user_scope_conditions`` — this
        method is for admin-level report callers).
        """
        member_ids = None
        if filters:
            filtered = resolve_filtered_user_ids(filters, self.org_id)
            if filtered is not None:
                member_ids = filtered
        elif user_id:
            member_ids = [user_id]
        elif team_id:
            member_ids = self._team_member_ids(team_id)

        if self.role == "team_admin":
            managed = managed_team_ids_for(self.viewer)
            if not managed:
                return []
            ta_ids = list(team_member_ids_for(managed))
            if member_ids is not None:
                member_ids = [u for u in member_ids if u in set(ta_ids)]
            else:
                member_ids = ta_ids

        return member_ids

    # ── role + request narrowing (admin-level filters) ──────────────
    def user_scope_conditions(self, data: dict) -> list:
        """Conditions narrowing a query to the users this viewer may see.

        ``user`` role is hard-restricted to their own entries regardless of
        any requested filters. For everyone else the request may narrow via
        ``filters`` (highest precedence), then ``userId``, then ``teamId``;
        an empty ``teamId`` membership yields the match-nothing guard.
        """
        if self.role == "user":
            return [TimeEntry.user_id == self.viewer.id]

        filters = data.get("filters")
        user_id = data.get("userId")
        team_id = data.get("teamId")

        if filters:
            filtered_ids = resolve_filtered_user_ids(filters, self.org_id)
            if filtered_ids is not None:
                return [TimeEntry.user_id.in_(filtered_ids)]
        elif user_id:
            return [TimeEntry.user_id == user_id]
        elif team_id:
            member_ids = self._team_member_ids(team_id)
            if member_ids:
                return [TimeEntry.user_id.in_(member_ids)]
            else:
                return [self.match_nothing()]

        return []

    # ── team-admin hard narrowing (applied on top of the above) ─────
    def apply_team_admin_scope(self, query, team_id_in_request=None):
        """Force a query down to the viewer's managed-team members.

        No-op for any non-``team_admin`` viewer (org-admin / super_admin see
        the whole org). A zero-team team_admin gets an empty result. A
        ``teamId`` outside the managed set is silently dropped back to the
        union of managed teams — same effect as if it were never sent.
        """
        if self.viewer is None or self.role != "team_admin":
            return query

        managed = managed_team_ids_for(self.viewer)
        if not managed:
            return query.filter(self.match_nothing())

        if team_id_in_request and team_id_in_request not in managed:
            team_id_in_request = None

        if team_id_in_request:
            member_ids = self._team_member_ids(team_id_in_request)
        else:
            member_ids = list(team_member_ids_for(managed))

        if not member_ids:
            return query.filter(self.match_nothing())
        return query.filter(TimeEntry.user_id.in_(member_ids))
