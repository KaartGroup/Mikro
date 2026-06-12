"""
TimeEntry read queries — a small class hierarchy over ``time_entries``.

``TimeEntryQuery`` is the core: it composes ``TimeEntryScope`` (visibility)
with the request-driven filter builders (date / activity / subcategory /
free-text search / cursor) and exposes the read operations every time view
needs — ``fetch_page`` (cursor pagination), ``fetch_stats``, ``fetch_all``,
``fetch_recent``.

Workflow subclasses override *policy* — never the plumbing:

  - ``UserHistoryQuery``  — self-scoped history for the calling user.
  - ``AggregateQuery``    — completed-only, no team-admin auto-narrowing,
    with sum / group-by helpers for reports, payroll and dashboards.
  - ``PayrollHoursQuery`` — payroll cycle hours, windowed on ``clock_out``
    over an inclusive calendar-date range.

Writes do NOT live here — see ``service.TimeEntryService``.
"""

from datetime import timedelta

from sqlalchemy import func, or_, and_, cast, Date as SqlDate

from ..utils.tz import parse_filter_datetime
from ..database import TimeEntry, User, db
from .scope import TimeEntryScope


class TimeEntryQuery:
    """Core read query: scoped, filtered, paginated access to time entries."""

    PAGE_SIZE = 50

    # ── policy knobs (overridden by workflow subclasses) ────────────
    # Which statuses this workflow reads. History shows completed + voided;
    # aggregations narrow to completed only (voided never counts in sums).
    STATUS_SET = ("completed", "voided")
    # Whether a team_admin viewer is hard-narrowed to managed-team members.
    # True for the admin/history views; False for report/aggregate queries
    # that resolve their member scope explicitly upstream.
    APPLY_TEAM_ADMIN_SCOPE = True

    def __init__(self, org_id: str, data: dict, viewer, member_ids=None):
        self.org_id = org_id
        self.data = data or {}
        self.viewer = viewer
        self.member_ids = member_ids
        self.scope = TimeEntryScope(viewer, org_id)

        # An explicit ``member_ids`` allow-list (None / [] / [ids]) takes over
        # visibility entirely — the caller (reports, payroll) has already
        # resolved scope and team-admin narrowing upstream, so the role-driven
        # path and the team-admin auto-narrowing below are both bypassed.
        if member_ids is not None:
            scope_conditions = self.scope.member_ids_conditions(member_ids)
        else:
            scope_conditions = self.scope.user_scope_conditions(self.data)

        filter_conditions = (
            self._base_conditions()
            + scope_conditions
            + self._date_conditions()
            + self._category_conditions()
            + self._search_conditions()
        )
        cursor = self._cursor_conditions()

        self._query = TimeEntry.query.filter(*(filter_conditions + cursor)).order_by(
            TimeEntry.clock_in.desc(), TimeEntry.id.desc()
        )
        # Cursor-free query used for aggregations — same scope/date/category
        # but no cursor offset and no ORDER BY.
        self._agg_query = TimeEntry.query.filter(*filter_conditions)

        if (
            member_ids is None
            and self.APPLY_TEAM_ADMIN_SCOPE
            and getattr(viewer, "role", None) == "team_admin"
        ):
            team_id = self.data.get("teamId")
            self._query = self.scope.apply_team_admin_scope(self._query, team_id)
            self._agg_query = self.scope.apply_team_admin_scope(
                self._agg_query, team_id
            )

    # ── condition builders ──────────────────────────────────────────
    def _base_conditions(self) -> list:
        return [
            TimeEntry.org_id == self.org_id,
            TimeEntry.status.in_(list(self.STATUS_SET)),
        ]

    def _date_conditions(self) -> list:
        conditions = []
        start_date, _ = parse_filter_datetime(self.data.get("startDate"))
        end_date, end_was_date_only = parse_filter_datetime(self.data.get("endDate"))

        if start_date:
            conditions.append(TimeEntry.clock_in >= start_date)
        if end_date:
            if end_was_date_only:
                end_date = end_date + timedelta(days=1)
            conditions.append(TimeEntry.clock_in < end_date)

        return conditions

    def _category_conditions(self) -> list:
        conditions = []
        category = self.data.get("category") or self.data.get("activity")
        if category:
            conditions.append(TimeEntry.activity == category.lower())

        subcategory_name = self.data.get("subcategoryName")
        if subcategory_name:
            conditions.append(TimeEntry.subcategory_name == subcategory_name)

        return conditions

    def _search_conditions(self) -> list:
        """Restrict to entries whose user's name matches a free-text search.

        Mirrors the frontend's old client-side `userName.includes(term)`
        filter, but runs against the DB so it applies to the full result
        set rather than just the loaded page. `userName` on the wire is
        `User.full_name` (first + last), which is a Python property, not a
        column — so we match a coalesced lower(first || ' ' || last)
        concatenation. Matched user ids feed an `in_` subquery so this
        composes with the AND'd scope/team-admin conditions.
        """
        search = (self.data.get("search") or "").strip().lower()
        if not search:
            return []

        full_name = func.lower(
            func.coalesce(User.first_name, "") + " " + func.coalesce(User.last_name, "")
        )
        matching_ids = db.session.query(User.id).filter(full_name.like(f"%{search}%"))
        return [TimeEntry.user_id.in_(matching_ids)]

    def _cursor_conditions(self) -> list:
        cursor = self.data.get("cursor")
        if not cursor:
            return []

        cursor_dt, _ = parse_filter_datetime(cursor.get("clockIn") or "")
        try:
            cursor_id = int(cursor["id"])
        except (KeyError, TypeError, ValueError):
            cursor_id = None

        if cursor_dt is None or cursor_id is None:
            return []

        return [
            or_(
                TimeEntry.clock_in < cursor_dt,
                and_(
                    TimeEntry.clock_in == cursor_dt,
                    TimeEntry.id < cursor_id,
                ),
            )
        ]

    # ── read operations ─────────────────────────────────────────────
    def queryset(self):
        """The bare cursor-free, order-free filtered query — for callers
        that want to layer their own aggregation / ordering on top."""
        return self._agg_query

    def fetch_page(self) -> tuple:
        rows = self._query.limit(self.PAGE_SIZE + 1).all()
        has_more = len(rows) > self.PAGE_SIZE
        page = rows[: self.PAGE_SIZE]
        cursor = None
        if has_more and page:
            last = page[-1]
            if last.clock_in is None:
                raise ValueError(
                    f"TimeEntry {last.id} has null clock_in; cannot generate cursor"
                )
            cursor = {
                "clockIn": last.clock_in.isoformat() + "Z",
                "id": last.id,
            }
        return page, cursor

    def fetch_stats(self) -> dict:
        """Aggregate stats matching the current filter set (no cursor, no limit)."""
        completed_q = self._agg_query.filter(TimeEntry.status == "completed")

        total_seconds = (
            completed_q.with_entities(
                func.coalesce(func.sum(TimeEntry.duration_seconds), 0)
            ).scalar()
            or 0
        )

        pending_adjustments = completed_q.filter(
            TimeEntry.notes.like("[ADJUSTMENT REQUESTED]%")
        ).count()

        voided_count = self._agg_query.filter(TimeEntry.status == "voided").count()

        return {
            "totalHours": round((total_seconds / 3600) * 10) / 10,
            "pendingAdjustments": pending_adjustments,
            "voidedEntries": voided_count,
        }

    def fetch_all(self) -> list:
        return self._query.all()

    def fetch_recent(self, limit: int) -> list:
        """The newest ``limit`` rows in the same ``clock_in``-desc order as
        ``fetch_all`` — for bounded "recent activity" lists (a user profile's
        last N sessions, etc.) that want a SQL ``LIMIT`` rather than loading
        the whole history and slicing in Python."""
        return self._query.limit(limit).all()


class UserHistoryQuery(TimeEntryQuery):
    """Self-scoped history for the calling user (the ``my_history`` view).

    Forces ``userId`` to the viewer so an admin hitting their own history
    page sees only their own entries — identical to the long-standing
    ``data["userId"] = g.user.id`` line the view used to set by hand.
    """

    def __init__(self, org_id: str, data: dict, viewer):
        scoped = dict(data or {})
        scoped["userId"] = getattr(viewer, "id", None)
        super().__init__(org_id, scoped, viewer)


class AggregateQuery(TimeEntryQuery):
    """Completed-only aggregation over the shared scope + filter machinery.

    Voided entries never count toward sums, so the status policy narrows to
    ``completed``. Team-admin auto-narrowing is off: report and payroll
    callers resolve their member scope explicitly (via ``filters`` /
    ``userId`` / ``teamId``) rather than relying on the viewer's role.
    """

    STATUS_SET = ("completed",)
    APPLY_TEAM_ADMIN_SCOPE = False

    def total_seconds(self) -> int:
        return (
            self._agg_query.with_entities(
                func.coalesce(func.sum(TimeEntry.duration_seconds), 0)
            ).scalar()
            or 0
        )

    def sum_seconds_by(self, *group_cols):
        """``[(group_col_values..., seconds), ...]`` grouped by the given
        columns — e.g. ``sum_seconds_by(TimeEntry.user_id)`` or
        ``sum_seconds_by(TimeEntry.activity)``."""
        return (
            self._agg_query.with_entities(
                *group_cols,
                func.coalesce(func.sum(TimeEntry.duration_seconds), 0).label("seconds"),
            )
            .group_by(*group_cols)
            .all()
        )


class PayrollHoursQuery(AggregateQuery):
    """Completed-session hours for a *payroll cycle* — the one read whose
    date semantics deliberately diverge from every other path here.

    Two divergences, made explicit (the reason this is its own class and not
    a flag on AggregateQuery):

      1. **Window column is ``clock_out``, not ``clock_in``.** A session that
         starts Apr 30 23:00 and ends May 1 01:00 is paid in the cycle it
         *ends* in. Reports/dashboards window on ``clock_in``; payroll does
         not, and that difference used to be an undocumented accident spread
         across two query sites.
      2. **The window is an INCLUSIVE calendar-date range** —
         ``cast(clock_out, Date)`` between ``cycle_start`` and ``cycle_end``
         (both ``date`` objects from the payroll-period generator) — rather
         than the half-open ``[start, end)`` datetime window the reports use.

    Org scope + completed-only status + the member allow-list come from
    AggregateQuery. The clock_in date pipeline of the base constructor is
    unused (these are built with no ``startDate``/``endDate``); the cycle
    window is applied per call instead.

    Note: ``hours_by_user`` adds an ``org_id`` filter (inherited base scope)
    that the legacy free function omitted. Every caller already passes an
    org-scoped ``user_ids`` list, so this is a redundant no-op that closes a
    latent cross-org hole on the (currently unused) ``user_ids=None`` path.
    """

    def _cycle_window(self, query, cycle_start, cycle_end):
        return (
            query.filter(TimeEntry.clock_out.isnot(None))
            .filter(cast(TimeEntry.clock_out, SqlDate) >= cycle_start)
            .filter(cast(TimeEntry.clock_out, SqlDate) <= cycle_end)
        )

    def hours_by_user(self, user_ids, cycle_start, cycle_end) -> dict:
        """``{user_id: int_seconds}`` of completed-session seconds per user
        inside the cycle. ``user_ids`` is an iterable of ids, or ``None`` for
        no per-user filter; an empty iterable short-circuits to ``{}``."""
        if user_ids is not None:
            ids = list(user_ids)
            if not ids:
                return {}
        q = self._cycle_window(
            self.queryset().with_entities(
                TimeEntry.user_id,
                func.coalesce(func.sum(TimeEntry.duration_seconds), 0).label("seconds"),
            ),
            cycle_start,
            cycle_end,
        )
        if user_ids is not None:
            q = q.filter(TimeEntry.user_id.in_(ids))
        return {
            row.user_id: int(row.seconds or 0)
            for row in q.group_by(TimeEntry.user_id).all()
        }

    def sessions_in_cycle(self, user_id, cycle_start, cycle_end) -> list:
        """Completed sessions for one user inside the cycle, ``clock_in`` asc
        — the Payments contributor-detail session breakdown."""
        return (
            self._cycle_window(
                self.queryset().filter(TimeEntry.user_id == user_id),
                cycle_start,
                cycle_end,
            )
            .order_by(TimeEntry.clock_in.asc())
            .all()
        )
