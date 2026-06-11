from datetime import timedelta

from sqlalchemy import func, or_, and_

from .tz import parse_filter_datetime
from ..database import TimeEntry, TeamUser, User, db
from ..filters import resolve_filtered_user_ids
from .time_tracking_helpers import TimeTrackingHelpers


class TimeEntryQuery:
    PAGE_SIZE = 50

    def __init__(self, org_id: str, data: dict, viewer):
        base = self._base_conditions(org_id)
        scope = self._user_scope_conditions(data, viewer, org_id)
        date = self._date_conditions(data)
        category = self._category_conditions(data)
        search = self._search_conditions(data)
        cursor = self._cursor_conditions(data)

        filter_conditions = base + scope + date + category + search

        self._query = TimeEntry.query.filter(*(filter_conditions + cursor)).order_by(
            TimeEntry.clock_in.desc(), TimeEntry.id.desc()
        )
        # Cursor-free query used for aggregations — same scope/date/category
        # but no cursor offset and no ORDER BY.
        self._agg_query = TimeEntry.query.filter(*filter_conditions)

        if getattr(viewer, "role", None) == "team_admin":
            team_id = data.get("teamId")
            self._query = TimeTrackingHelpers._apply_team_admin_scope(
                self._query, viewer, team_id
            )
            self._agg_query = TimeTrackingHelpers._apply_team_admin_scope(
                self._agg_query, viewer, team_id
            )

    def _base_conditions(self, org_id: str) -> list:
        return [
            TimeEntry.org_id == org_id,
            TimeEntry.status.in_(["completed", "voided"]),
        ]

    def _user_scope_conditions(self, data: dict, viewer, org_id: str) -> list:
        if getattr(viewer, "role", None) == "user":
            return [TimeEntry.user_id == viewer.id]

        filters = data.get("filters")
        user_id = data.get("userId")
        team_id = data.get("teamId")

        if filters:
            filtered_ids = resolve_filtered_user_ids(filters, org_id)
            if filtered_ids is not None:
                return [TimeEntry.user_id.in_(filtered_ids)]
        elif user_id:
            return [TimeEntry.user_id == user_id]
        elif team_id:
            member_ids = [
                tu.user_id
                for tu in TeamUser.query.filter_by(team_id=team_id).all()
            ]
            # Return a guaranteed-false condition if the team has no members
            if member_ids:
                return [TimeEntry.user_id.in_(member_ids)]
            else:
                return [TimeEntry.user_id == None]  # noqa: E711

        return []

    def _date_conditions(self, data: dict) -> list:
        conditions = []
        start_date, _ = parse_filter_datetime(data.get("startDate"))
        end_date, end_was_date_only = parse_filter_datetime(data.get("endDate"))

        if start_date:
            conditions.append(TimeEntry.clock_in >= start_date)
        if end_date:
            if end_was_date_only:
                end_date = end_date + timedelta(days=1)
            conditions.append(TimeEntry.clock_in < end_date)

        return conditions

    def _category_conditions(self, data: dict) -> list:
        conditions = []
        category = data.get("category") or data.get("activity")
        if category:
            conditions.append(TimeEntry.activity == category.lower())

        subcategory_name = data.get("subcategoryName")
        if subcategory_name:
            conditions.append(TimeEntry.subcategory_name == subcategory_name)

        return conditions

    def _search_conditions(self, data: dict) -> list:
        """Restrict to entries whose user's name matches a free-text search.

        Mirrors the frontend's old client-side `userName.includes(term)`
        filter, but runs against the DB so it applies to the full result
        set rather than just the loaded page. `userName` on the wire is
        `User.full_name` (first + last), which is a Python property, not a
        column — so we match a coalesced lower(first || ' ' || last)
        concatenation. Matched user ids feed an `in_` subquery so this
        composes with the AND'd scope/team-admin conditions.
        """
        search = (data.get("search") or "").strip().lower()
        if not search:
            return []

        full_name = func.lower(
            func.coalesce(User.first_name, "")
            + " "
            + func.coalesce(User.last_name, "")
        )
        matching_ids = db.session.query(User.id).filter(
            full_name.like(f"%{search}%")
        )
        return [TimeEntry.user_id.in_(matching_ids)]

    def _cursor_conditions(self, data: dict) -> list:
        cursor = data.get("cursor")
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

    def fetch_page(self) -> tuple:
        rows = self._query.limit(self.PAGE_SIZE + 1).all()
        has_more = len(rows) > self.PAGE_SIZE
        page = rows[:self.PAGE_SIZE]
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

        total_seconds = completed_q.with_entities(
            func.coalesce(func.sum(TimeEntry.duration_seconds), 0)
        ).scalar() or 0

        pending_adjustments = completed_q.filter(
            TimeEntry.notes.like("[ADJUSTMENT REQUESTED]%")
        ).count()

        voided_count = self._agg_query.filter(
            TimeEntry.status == "voided"
        ).count()

        return {
            "totalHours": round((total_seconds / 3600) * 10) / 10,
            "pendingAdjustments": pending_adjustments,
            "voidedEntries": voided_count,
        }

    def fetch_all(self) -> list:
        return self._query.all()
