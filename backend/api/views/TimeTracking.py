#!/usr/bin/env python3
"""
Time Tracking API endpoints for Mikro.

Handles clock in/out, session management, and admin oversight
for contractor time tracking with OSM changeset correlation.
"""

import csv
import io
import logging
import unicodedata
from datetime import date, datetime, timedelta
from reportlab.lib.pagesizes import letter, landscape
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate,
    Table,
    TableStyle,
    Paragraph,
    Spacer,
)
from xml.sax.saxutils import escape as xml_escape
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch

from flask.views import MethodView
from flask import g, request, jsonify, Response

try:
    from unidecode import unidecode as _unidecode
except ImportError:
    _unidecode = None

from ..utils import requires_team_admin_or_above
from ..utils.tz import (
    org_month_bounds_utc,
    org_week_compare_bounds_utc,
    parse_filter_datetime,
)
from sqlalchemy import func, or_, and_
from ..database import (
    TimeEntry,
    User,
    UserHourlyRate,
    Project,
    Task,
    Team,
    TeamUser,
    TeamLead,
    CustomTopic,
    ActivitySubcategory,
    HourlyPayment,
    db,
)
from ..auth import (
    is_org_admin_or_above,
    managed_team_ids_for,
    team_admin_can_access_user,
    UserScope,
)

from ..time_tracking import (
    TimeTrackingHelpers,
    ACTIVITY_SLUGS,
    ACTIVITY_DISPLAY_MAP,
    LONG_SESSION_THRESHOLD_SECONDS,
    TimeEntryQuery,
    UserHistoryQuery,
    AggregateQuery,
    TimeEntryService,
    DiscardWindowError,
)
from ..services.hourly_rate_history import HourlyRateHistoryService
from .. import comms_client
from ..comms_client import NotificationType
from ..targeting import org_admin_users

logger = logging.getLogger(__name__)


def _ascii_safe(s):
    """Transliterate a string to printable ASCII for the PDF export.

    Why: reportlab's default fonts (Helvetica/Times) don't ship glyphs
    for non-Latin scripts; an OSM username like "Łukasz" or one with
    Cyrillic/CJK characters renders as a row of black boxes (■). Pre-
    transliterating gives a readable ASCII approximation that's also
    safe to paste into payment processors that don't accept Unicode.

    Prefers Unidecode (handles Cyrillic / CJK / Arabic / accented
    Latin etc.); falls back to NFKD + ASCII-encode-ignore if the
    library isn't installed (handles accented Latin only — the rest
    drops out).
    """
    if s is None:
        return ""
    s = str(s)
    if _unidecode is not None:
        return _unidecode(s)
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")


# ─── Subcategory helpers (SSOT for visibility / management) ─────────
#
# These live at module level so the Time Categories admin endpoints,
# the clock-in/edit write paths, and any future read sites (reports,
# CSV export) all go through the same gate. Do not duplicate the
# visibility or permission logic inline anywhere.


def _visible_subcategories_query(user, activity=None):
    """SQLAlchemy query returning `ActivitySubcategory` rows visible to `user`.

    Visibility rules (a sub is visible iff any of these match):
      - global (org_id IS NULL AND team_id IS NULL), OR
      - org-scoped to the user's own org, with no team, OR
      - team-scoped where the user is a member of the team, OR
      - org-scoped/team-scoped within the user's org AND the user is
        org_admin or above (admins can see every sub in their org).

    Only `is_active = TRUE` rows are returned. Sorted by sort_order,
    then name. If `activity` is given, narrows to that activity.
    """
    user_org_id = getattr(user, "org_id", None)
    is_admin = is_org_admin_or_above(user)

    # Team IDs the user is a MEMBER of (TeamUser rows). team_admin
    # often has membership in the teams they lead, but not always; we
    # only show personal subs for teams the user actually belongs to.
    member_team_ids = [
        tu.team_id for tu in TeamUser.query.filter_by(user_id=user.id).all()
    ]

    visibility_clauses = [
        # Global subs — every user sees these.
        (ActivitySubcategory.org_id.is_(None))
        & (ActivitySubcategory.team_id.is_(None)),
    ]
    if user_org_id:
        # Org-scoped, no team — anyone in that org.
        visibility_clauses.append(
            (ActivitySubcategory.org_id == user_org_id)
            & (ActivitySubcategory.team_id.is_(None))
        )
        # Team-scoped — user must be a member of that team.
        if member_team_ids:
            visibility_clauses.append(
                (ActivitySubcategory.org_id == user_org_id)
                & (ActivitySubcategory.team_id.in_(member_team_ids))
            )
        # Admins see EVERY sub in their org (including team subs they
        # aren't members of) — they're managing the catalog.
        if is_admin:
            visibility_clauses.append(ActivitySubcategory.org_id == user_org_id)

    q = ActivitySubcategory.query.filter(
        ActivitySubcategory.is_active.is_(True),
        or_(*visibility_clauses),
    )
    if activity:
        q = q.filter(ActivitySubcategory.activity == activity)
    return q.order_by(
        ActivitySubcategory.sort_order.asc(),
        ActivitySubcategory.name.asc(),
    )


def _team_admin_led_team_ids(user):
    """Return the set of team IDs `user` LEADS (via TeamLead).

    Distinct from team_member_ids_for / managed_team_ids_for: this is
    the strict "I am a lead of this team" set used for subcategory
    management permissions. Returns empty set for non-team_admins.
    """
    if getattr(user, "role", None) != "team_admin":
        return set()
    return {tl.team_id for tl in TeamLead.query.filter_by(user_id=user.id).all()}


def _can_manage_subcategory(user, *, org_id=None, team_id=None, sub=None):
    """Permission gate for create/update/delete on a subcategory row.

    Either pass a `sub` (an ActivitySubcategory instance) OR `org_id` +
    `team_id` (for new-row checks before insertion).

    Rules:
      - super_admin: can manage anything (including global subs).
      - admin (org_admin): can manage anything in their org. Cannot
        manage global subs.
      - team_admin (authorship-based, updated 2026-05-21):
          * CREATE: can create subs in their own org at either org-scope
            or team-scope (any team in their own org). Global is denied.
          * EDIT / DELETE: can only manage subs they CREATED themselves
            (sub.created_by == user.id). PLUS, the team-scoped subs for
            teams they LEAD remain manageable for the team-lead path.
            Seeded rows that were re-stamped to a team_admin's id via
            the e6c4d5b6f7a8 migration become editable by that admin
            under this rule.
      - others (user / validator): no management.
    """
    if sub is not None:
        org_id = sub.org_id
        team_id = sub.team_id
        sub_created_by = sub.created_by
    else:
        sub_created_by = None  # create path — no row exists yet

    role = getattr(user, "role", None)
    if role == "super_admin":
        return True
    if role == "admin":
        # Org admin: must scope to their own org; cannot touch global.
        return org_id is not None and org_id == getattr(user, "org_id", None)
    if role == "team_admin":
        # Team admin: never touches global, never touches another org.
        if org_id is None or org_id != getattr(user, "org_id", None):
            return False
        # Editing an existing row: authorship rule (or led-team fallback).
        if sub is not None:
            if sub_created_by == user.id:
                return True
            if team_id is not None and team_id in _team_admin_led_team_ids(user):
                return True
            return False
        # Creating a new row: allowed in own org at org-scope or any
        # team-scope IF the team belongs to this org (FK already
        # constrains that; we just need the org_id match above).
        return True
    return False


def _resolve_subcategory_for_write(
    user,
    activity,
    subcategory_id,
    retained_participants,
    new_participants,
):
    """Validate subcategory + event fields for a clock-in / edit write.

    Returns a dict suitable for assigning into a TimeEntry:
        {
            "subcategory_id": int | None,
            "subcategory_name": str | None,
            "retained_participants": int | None,
            "new_participants": int | None,
        }

    Raises ValueError with a human-readable message on any rejection
    so callers can return a 400 response.

    Rules:
      - `subcategory_id` is optional. If provided, the row must be
        visible to `user`, its `activity` must match the entry's
        activity, and its `is_active` must be true.
      - `retained_participants` / `new_participants` accepted only when
        the chosen subcategory has `allow_event_fields=true`. Each
        must parse as a non-negative integer. Anything else: reject.
    """
    # Coerce empty/missing inputs to None so callers can pass through
    # request JSON unchanged.
    sub_id_in = subcategory_id if subcategory_id not in ("", 0) else None
    retained_in = retained_participants
    new_in = new_participants

    sub_row = None
    if sub_id_in is not None:
        try:
            sub_id_int = int(sub_id_in)
        except (TypeError, ValueError):
            raise ValueError("subcategoryId must be an integer")
        sub_row = (
            _visible_subcategories_query(user)
            .filter(
                ActivitySubcategory.id == sub_id_int,
                ActivitySubcategory.activity == activity,
            )
            .first()
        )
        if sub_row is None:
            raise ValueError("Selected subcategory is not available for this activity")

    # Event-field validation.
    def _coerce_count(value, field_name):
        if value is None or value == "":
            return None
        try:
            n = int(value)
        except (TypeError, ValueError):
            raise ValueError(f"{field_name} must be a non-negative integer")
        if n < 0:
            raise ValueError(f"{field_name} must be a non-negative integer")
        return n

    retained = _coerce_count(retained_in, "retainedParticipants")
    new_p = _coerce_count(new_in, "newParticipants")

    allows_events = bool(sub_row and sub_row.allow_event_fields)
    if (retained is not None or new_p is not None) and not allows_events:
        raise ValueError(
            "retainedParticipants / newParticipants are only accepted "
            "for subcategories with allow_event_fields enabled"
        )

    return {
        "subcategory_id": sub_row.id if sub_row else None,
        "subcategory_name": sub_row.name if sub_row else None,
        "retained_participants": retained,
        "new_participants": new_p,
    }


class TimeTrackingAPI(MethodView):
    """Time tracking management API endpoints."""

    def post(self, path: str):
        # User endpoints
        if path == "clock_in":
            return self.clock_in()
        elif path == "clock_out":
            return self.clock_out()
        elif path == "my_active_session":
            return self.my_active_session()
        elif path == "my_history":
            return self.my_history()
        elif path == "my_monthly_summary":
            return self.my_monthly_summary()
        # Admin endpoints
        elif path == "active_sessions":
            return self.admin_active_sessions()
        elif path == "long_sessions":
            return self.admin_long_sessions()
        elif path == "history":
            return self.admin_history()
        elif path == "force_clock_out":
            return self.admin_force_clock_out()
        elif path == "void_entry":
            return self.admin_void_entry()
        elif path == "edit_entry":
            return self.admin_edit_entry()
        elif path == "admin_add_entry":
            return self.admin_add_entry()
        elif path == "request_adjustment":
            return self.request_adjustment()
        elif path == "pending_adjustments":
            return self.admin_pending_adjustments()
        elif path == "update_my_notes":
            return self.update_my_notes()
        elif path == "discard_active":
            return self.discard_active()
        elif path == "export":
            return self.admin_export()
        elif path == "fetch_custom_topics":
            return self.fetch_custom_topics()
        elif path == "time_stats":
            return self.admin_time_stats()
        elif path == "aggregate_stats":
            return self.admin_aggregate_stats()
        elif path == "hourly_summary":
            return self.admin_hourly_summary()
        elif path == "mark_hourly_paid":
            return self.admin_mark_hourly_paid()
        # ─── Subcategory management (tier-2 catalog) ────────────
        elif path == "subcategories_list":
            return self.subcategories_list()
        elif path == "subcategories_admin_list":
            return self.subcategories_admin_list()
        elif path == "subcategories_create":
            return self.subcategories_create()
        elif path == "subcategories_update":
            return self.subcategories_update()
        elif path == "subcategories_delete":
            return self.subcategories_delete()

        return jsonify({"message": "Endpoint not found", "status": 404}), 404

    # Self-service "discard active record" is allowed within this window
    # only. Past it, users must clock out and request an adjustment so the
    # admin has visibility on retroactive changes.
    DISCARD_WINDOW_SECONDS = 300  # 5 minutes

    # ─── User Endpoints ───────────────────────────────────────

    def clock_in(self):
        """Clock in the current user."""
        if not hasattr(g, "user") or not g.user:
            return jsonify({"message": "Unauthorized", "status": 401}), 401

        data = request.get_json() or {}
        project_id = data.get("project_id")
        # Frontend payload key still "category" (tier-1 activity slug).
        activity = data.get("category", "").lower()

        logger.info(
            f"[CLOCK] clock_in called by user={g.user.id} "
            f"({g.user.osm_username or g.user.email}) "
            f"project_id={project_id} activity={activity}"
        )

        # Validate activity (tier 1)
        if activity not in ACTIVITY_SLUGS:
            return (
                jsonify(
                    {
                        "message": f"Invalid category. Must be one of: {', '.join(ACTIVITY_SLUGS)}",
                        "status": 400,
                    }
                ),
                400,
            )

        # Validate subcategory (tier 2) + event fields through the SSOT helper.
        try:
            sub_fields = _resolve_subcategory_for_write(
                g.user,
                activity,
                data.get("subcategoryId"),
                None,
                None,
            )
        except ValueError as e:
            return jsonify({"message": str(e), "status": 400}), 400

        # requires_project gating: if the chosen sub demands a project and the
        # caller didn't provide one, reject up-front.
        if sub_fields["subcategory_id"] is not None:
            sub_row = ActivitySubcategory.query.get(sub_fields["subcategory_id"])
            if sub_row and sub_row.requires_project and not project_id:
                return (
                    jsonify(
                        {
                            "message": (
                                f"Subcategory '{sub_row.name}' requires a project — "
                                f"please pick a project before clocking in."
                            ),
                            "status": 400,
                        }
                    ),
                    400,
                )

        # Validate project if provided
        if project_id:
            project = Project.query.get(project_id)
            if not project:
                return (
                    jsonify(
                        {
                            "message": "Project not found",
                            "status": 404,
                        }
                    ),
                    404,
                )

        try:
            user_notes = TimeTrackingHelpers._normalize_user_notes(
                data.get("userNotes")
            )
        except ValueError as e:
            return jsonify({"message": str(e), "status": 400}), 400

        # Check for existing active session
        active = TimeEntry.query.filter_by(user_id=g.user.id, status="active").first()
        if active:
            logger.info(
                f"[CLOCK] clock_in REJECTED — user={g.user.id} already has active session "
                f"id={active.id} clock_in={active.clock_in}"
            )
            return (
                jsonify(
                    {
                        "message": "You already have an active session. Clock out first.",
                        "status": 409,
                    }
                ),
                409,
            )

        entry = TimeEntryService().clock_in(
            user_id=g.user.id,
            org_id=g.user.org_id,
            activity=activity,
            sub_fields=sub_fields,
            project_id=project_id,
            task_name=data.get("task_name"),
            task_ref_type=data.get("task_ref_type"),
            task_ref_id=data.get("task_ref_id"),
            user_notes=user_notes,
        )

        logger.info(
            f"[CLOCK] clock_in SUCCESS — user={g.user.id} session_id={entry.id} "
            f"clock_in={entry.clock_in} project={project_id} activity={activity} "
            f"subcategory_id={entry.subcategory_id}"
        )

        session_data = TimeTrackingHelpers._format_entry(entry)
        session_data["elapsedSeconds"] = 0  # Just clocked in

        return (
            jsonify(
                {
                    "message": "Clocked in successfully",
                    "status": 200,
                    "session_id": entry.id,
                    "session": session_data,
                }
            ),
            200,
        )

    def clock_out(self):
        """Clock out the current user."""
        if not hasattr(g, "user") or not g.user:
            return jsonify({"message": "Unauthorized", "status": 401}), 401

        data = request.get_json() or {}
        # session_id is optional: when omitted, the service closes the
        # caller's active session. The frontend relies on this fallback.
        session_id = data.get("session_id")

        logger.info(
            f"[CLOCK] clock_out called by user={g.user.id} "
            f"({g.user.osm_username or g.user.email}) session_id={session_id}"
        )

        update_notes = "userNotes" in data
        try:
            entry = TimeEntryService().clock_out(
                session_id,
                g.user.id,
                user_notes=data.get("userNotes"),
                update_notes=update_notes,
            )
        except ValueError as e:
            return jsonify({"message": str(e), "status": 400}), 400

        if not entry:
            logger.warning(
                f"[CLOCK] clock_out FAILED — no active session found for user={g.user.id} "
                f"session_id_requested={session_id}"
            )
            return (
                jsonify(
                    {
                        "message": "No active session found",
                        "status": 404,
                    }
                ),
                404,
            )

        logger.info(
            f"[CLOCK] clock_out SUCCESS — user={g.user.id} session_id={entry.id} "
            f"duration={entry.duration_seconds}s changesets={entry.changeset_count} "
            f"changes={entry.changes_count}"
        )

        return (
            jsonify(
                {
                    "message": "Clocked out successfully",
                    "status": 200,
                    "duration_seconds": entry.duration_seconds,
                    "session": TimeTrackingHelpers._format_entry(entry),
                }
            ),
            200,
        )

    def my_active_session(self):
        """Get the current user's active session."""
        if not hasattr(g, "user") or not g.user:
            return jsonify({"message": "Unauthorized", "status": 401}), 401

        entry = TimeEntry.query.filter_by(user_id=g.user.id, status="active").first()

        if entry:
            logger.debug(
                f"[CLOCK] active_session CHECK — user={g.user.id} "
                f"found session_id={entry.id} clock_in={entry.clock_in}"
            )
        else:
            logger.debug(
                f"[CLOCK] active_session CHECK — user={g.user.id} NO active session"
            )

        session_data = TimeTrackingHelpers._format_entry(entry) if entry else None

        # Include server-computed elapsed seconds so the frontend never
        # compares server timestamps against the client clock.
        if entry and entry.clock_in:
            elapsed = int((datetime.utcnow() - entry.clock_in).total_seconds())
            session_data["elapsedSeconds"] = max(0, elapsed)

        return (
            jsonify(
                {
                    "status": 200,
                    "session": session_data,
                }
            ),
            200,
        )

    def my_history(self):
        """Get the current user's time entry history with cursor-based pagination.

        Returns PAGE_SIZE entries per page ordered newest-first. Pass the
        returned ``nextCursor`` as ``cursor`` in the next request to fetch
        the following page. Omit ``cursor`` (or pass null) to start from
        the most recent entries.
        """
        if not hasattr(g, "user") or not g.user:
            return jsonify({"message": "Unauthorized", "status": 401}), 401

        data = request.get_json() or {}
        # Always scope to the caller's own entries — admin org-wide views
        # use the dedicated admin endpoints, not this one. UserHistoryQuery
        # forces userId to the viewer.
        query = UserHistoryQuery(g.user.org_id, data, viewer=g.user)
        page, next_cursor = query.fetch_page()

        return (
            jsonify(
                {
                    "status": 200,
                    "entries": [TimeTrackingHelpers._format_entry(e) for e in page],
                    "nextCursor": next_cursor,
                }
            ),
            200,
        )

    def my_monthly_summary(self):
        """Self-scoped monthly pay+hours summary for the current user.

        Body: `{ startDate, endDate }` as ISO UTC instants aligned to
        the user's local month (see lib/timeTracking.ts helpers). One
        round-trip powering F13's "This month" card.
        """
        if not hasattr(g, "user") or not g.user:
            return jsonify({"message": "Unauthorized", "status": 401}), 401

        data = request.get_json() or {}
        start_dt, _ = parse_filter_datetime(data.get("startDate"))
        end_dt, end_was_date_only = parse_filter_datetime(data.get("endDate"))
        if start_dt is None or end_dt is None:
            return (
                jsonify(
                    {
                        "message": "startDate and endDate are required (ISO 8601).",
                        "status": 400,
                    }
                ),
                400,
            )
        if end_was_date_only:
            end_dt = end_dt + timedelta(days=1)

        user = g.user

        # Hours: sum of completed time entries in the window. AggregateQuery
        # re-derives the same [start, end) window (incl. the date-only +1d
        # rule) and completed-only filter from the raw request strings.
        total_seconds = AggregateQuery(
            user.org_id,
            {
                "userId": user.id,
                "startDate": data.get("startDate"),
                "endDate": data.get("endDate"),
            },
            viewer=user,
        ).total_seconds()
        total_hours = round(total_seconds / 3600, 2)

        # Tasks mapped/validated by this user in the window. Tasks track
        # the actor by osm_username (not user_id), so users without one
        # linked just get zero — honest.
        tasks_mapped = 0
        tasks_validated = 0
        mapping_earnings = 0.0
        validation_earnings = 0.0
        if user.osm_username:
            mapped_row = (
                db.session.query(
                    func.count(Task.id),
                    func.coalesce(func.sum(Task.mapping_rate), 0),
                )
                .filter(
                    Task.mapped_by == user.osm_username,
                    Task.mapped == True,  # noqa: E712
                    Task.date_mapped >= start_dt,
                    Task.date_mapped < end_dt,
                )
                .first()
            )
            tasks_mapped = int(mapped_row[0] or 0)
            mapping_earnings = float(mapped_row[1] or 0)

            validated_row = (
                db.session.query(
                    func.count(Task.id),
                    func.coalesce(func.sum(Task.validation_rate), 0),
                )
                .filter(
                    Task.validated_by == user.osm_username,
                    Task.validated == True,  # noqa: E712
                    Task.date_validated >= start_dt,
                    Task.date_validated < end_dt,
                )
                .first()
            )
            tasks_validated = int(validated_row[0] or 0)
            validation_earnings = float(validated_row[1] or 0)

        # "Amount owed" = the relevant earnings for this user's pay model.
        # Hourly contractors → hours × rate. Per-task mappers → sum of
        # task rates. If neither applies → zero, with pay_mode="none".
        _rate_entry = HourlyRateHistoryService().get_active_rate(
            user.id, date(start_dt.year, start_dt.month, 1)
        )
        hourly_rate = float(_rate_entry.rate) if _rate_entry else None
        hourly_earnings = round(total_hours * hourly_rate, 2) if hourly_rate else None
        task_earnings = round(mapping_earnings + validation_earnings, 2)
        if hourly_rate:
            amount_owed = hourly_earnings or 0.0
            pay_mode = "hourly"
        elif task_earnings > 0:
            amount_owed = task_earnings
            pay_mode = "per_task"
        else:
            amount_owed = 0.0
            pay_mode = "none"

        return (
            jsonify(
                {
                    "status": 200,
                    "start_date": start_dt.isoformat() + "Z",
                    "end_date": end_dt.isoformat() + "Z",
                    "total_seconds": int(total_seconds),
                    "total_hours": total_hours,
                    "hourly_rate": hourly_rate,
                    "hourly_earnings": hourly_earnings,
                    "tasks_mapped": tasks_mapped,
                    "tasks_validated": tasks_validated,
                    "mapping_earnings": round(mapping_earnings, 2),
                    "validation_earnings": round(validation_earnings, 2),
                    "amount_owed": amount_owed,
                    "pay_mode": pay_mode,
                }
            ),
            200,
        )

    @requires_team_admin_or_above
    def admin_pending_adjustments(self):
        """Return every entry in the admin's org that has a pending
        adjustment request, regardless of date — these are admin
        action items and must not get hidden by the page's current
        date filter.

        Honors optional `teamId` so the dashboard team-scope dropdown
        carries through. team_admin is force-scoped to managed teams.
        """
        data = request.get_json(silent=True) or {}
        team_id = data.get("teamId")

        query = TimeEntry.query.filter(
            TimeEntry.org_id == g.user.org_id,
            TimeEntry.notes.like("[ADJUSTMENT REQUESTED]%"),
            TimeEntry.status != "voided",
        )

        if team_id:
            member_ids = [
                tu.user_id for tu in TeamUser.query.filter_by(team_id=team_id).all()
            ]
            if member_ids:
                query = query.filter(TimeEntry.user_id.in_(member_ids))
            else:
                query = query.filter(TimeEntry.user_id == None)  # noqa: E711

        # team_admin: force-narrow to managed teams
        query = TimeTrackingHelpers._apply_team_admin_scope(query, g.user, team_id)

        entries = query.order_by(TimeEntry.clock_in.desc()).limit(100).all()

        return (
            jsonify(
                {
                    "status": 200,
                    "entries": [TimeTrackingHelpers._format_entry(e) for e in entries],
                }
            ),
            200,
        )

    def request_adjustment(self):
        """Request an adjustment to a time entry."""
        if not hasattr(g, "user") or not g.user:
            return jsonify({"message": "Unauthorized", "status": 401}), 401

        data = request.get_json() or {}
        entry_id = data.get("entry_id")
        reason = data.get("reason", "").strip()

        if not entry_id:
            return (
                jsonify(
                    {
                        "message": "entry_id is required",
                        "status": 400,
                    }
                ),
                400,
            )

        if not reason:
            return (
                jsonify(
                    {
                        "message": "reason is required",
                        "status": 400,
                    }
                ),
                400,
            )

        entry = TimeEntry.query.filter_by(id=entry_id, user_id=g.user.id).first()

        if not entry:
            return (
                jsonify(
                    {
                        "message": "Entry not found",
                        "status": 404,
                    }
                ),
                404,
            )

        if entry.status == "voided":
            return (
                jsonify(
                    {
                        "message": "Cannot request adjustment for a voided entry",
                        "status": 400,
                    }
                ),
                400,
            )

        entry.notes = f"[ADJUSTMENT REQUESTED] {reason}"
        entry.save()

        # Notify every org admin that a review was requested.
        try:
            admins = org_admin_users(g.user.org_id, exclude_user_id=g.user.id)
            requester_name = g.user.full_name or g.user.email or "A user"
            snippet = reason[:120] + ("…" if len(reason) > 120 else "")
            comms_client.emit_batch(
                user_ids=[a.id for a in admins],
                org_id=g.user.org_id,
                type=NotificationType.ADJUSTMENT_REQUESTED,
                message=(
                    f"{requester_name} requested a time-entry adjustment: {snippet}"
                ),
                link="/admin/time",
                actor_id=g.user.id,
                entity_type="time_entry",
                entity_id=entry.id,
            )
        except Exception:
            pass

        return (
            jsonify(
                {
                    "message": "Adjustment request submitted",
                    "status": 200,
                }
            ),
            200,
        )

    def discard_active(self):
        """Hard-delete the user's active session if it's still inside the
        DISCARD_WINDOW. Past the window the request is rejected and the
        user is pointed at the Request Adjustment flow.
        """
        if not hasattr(g, "user") or not g.user:
            return jsonify({"message": "Unauthorized", "status": 401}), 401

        data = request.get_json() or {}
        session_id = data.get("session_id")

        if not session_id:
            active = TimeEntry.query.filter_by(
                user_id=g.user.id, status="active"
            ).first()
            if not active:
                return (
                    jsonify(
                        {
                            "message": "No active session to discard",
                            "status": 404,
                        }
                    ),
                    404,
                )
            session_id = active.id

        try:
            elapsed = TimeEntryService().discard(
                session_id, g.user.id, self.DISCARD_WINDOW_SECONDS
            )
        except DiscardWindowError as e:
            return (
                jsonify(
                    {
                        "message": str(e),
                        "status": 400,
                        "elapsed_seconds": e.elapsed_seconds,
                        "max_seconds": e.max_seconds,
                    }
                ),
                400,
            )

        if elapsed is None:
            return (
                jsonify(
                    {
                        "message": "No active session to discard",
                        "status": 404,
                    }
                ),
                404,
            )

        logger.info(
            f"[CLOCK] discard_active by user={g.user.id} "
            f"({g.user.osm_username or g.user.email}) "
            f"session_id={session_id} elapsed={elapsed}s"
        )

        return (
            jsonify(
                {
                    "message": "Active session discarded",
                    "status": 200,
                }
            ),
            200,
        )

    def update_my_notes(self):
        """Set or clear the current user's user_notes on one of their entries.

        Owner-scoped: only the entry's user_id == g.user.id can edit. Admins
        do not use this endpoint — admin endpoints intentionally ignore
        user_notes per the read-only-for-admins policy.
        """
        if not hasattr(g, "user") or not g.user:
            return jsonify({"message": "Unauthorized", "status": 401}), 401

        data = request.get_json() or {}
        entry_id = data.get("entry_id")

        if not entry_id:
            return (
                jsonify(
                    {
                        "message": "entry_id is required",
                        "status": 400,
                    }
                ),
                400,
            )

        try:
            user_notes = TimeTrackingHelpers._normalize_user_notes(
                data.get("userNotes")
            )
        except ValueError as e:
            return jsonify({"message": str(e), "status": 400}), 400

        entry = TimeEntry.query.filter_by(id=entry_id, user_id=g.user.id).first()

        if not entry:
            return (
                jsonify(
                    {
                        "message": "Entry not found",
                        "status": 404,
                    }
                ),
                404,
            )

        entry.user_notes = user_notes
        entry.save()

        return (
            jsonify(
                {
                    "status": 200,
                    "session": TimeTrackingHelpers._format_entry(entry),
                }
            ),
            200,
        )

    def fetch_custom_topics(self):
        """Fetch all custom topics for the user's org."""
        if not hasattr(g, "user") or not g.user:
            return jsonify({"message": "Unauthorized", "status": 401}), 401

        topics = (
            CustomTopic.query.filter_by(org_id=g.user.org_id)
            .order_by(CustomTopic.name)
            .all()
        )

        return (
            jsonify(
                {
                    "status": 200,
                    "topics": [
                        {
                            "id": t.id,
                            "name": t.name,
                            "createdBy": t.created_by,
                        }
                        for t in topics
                    ],
                }
            ),
            200,
        )

    # ─── Admin Endpoints ──────────────────────────────────────

    @requires_team_admin_or_above
    def admin_active_sessions(self):
        """Get all active sessions for the admin's org.

        Accepts optional `teamId` in the request body to scope to members
        of that team — used by the dashboard's team-scope dropdown (F22).
        For team_admin, forces scope to their managed teams.
        """
        data = request.get_json(silent=True) or {}
        team_id = data.get("teamId")

        query = TimeEntry.query.filter_by(org_id=g.user.org_id, status="active")

        if team_id:
            member_ids = [
                tu.user_id for tu in TeamUser.query.filter_by(team_id=team_id).all()
            ]
            if member_ids:
                query = query.filter(TimeEntry.user_id.in_(member_ids))
            else:
                # Team has no members — return empty rather than the whole org.
                query = query.filter(TimeEntry.user_id == None)  # noqa: E711

        # team_admin: force-narrow to managed teams
        query = TimeTrackingHelpers._apply_team_admin_scope(query, g.user, team_id)

        entries = query.order_by(TimeEntry.clock_in.asc()).all()

        return (
            jsonify(
                {
                    "status": 200,
                    "sessions": [TimeTrackingHelpers._format_entry(e) for e in entries],
                }
            ),
            200,
        )

    @requires_team_admin_or_above
    def admin_long_sessions(self):
        """Sessions that ran longer than the long-session threshold.

        Covers BOTH currently-active sessions open longer than the
        threshold AND already-closed sessions whose recorded duration
        exceeded it, within the last 30 days. This is what surfaces a
        forgotten clock-out even after the session has been closed.

        Accepts optional `teamId`; for team_admin, forces scope to their
        managed teams (mirrors admin_active_sessions).
        """
        data = request.get_json(silent=True) or {}
        team_id = data.get("teamId")

        now = datetime.utcnow()
        active_cutoff = now - timedelta(seconds=LONG_SESSION_THRESHOLD_SECONDS)
        window_start = now - timedelta(days=30)

        query = TimeEntry.query.filter(
            TimeEntry.org_id == g.user.org_id,
            TimeEntry.status != "voided",
            TimeEntry.clock_in >= window_start,
            or_(
                and_(
                    TimeEntry.status == "active",
                    TimeEntry.clock_in <= active_cutoff,
                ),
                and_(
                    TimeEntry.duration_seconds.isnot(None),
                    TimeEntry.duration_seconds > LONG_SESSION_THRESHOLD_SECONDS,
                ),
            ),
        )

        if team_id:
            member_ids = [
                tu.user_id for tu in TeamUser.query.filter_by(team_id=team_id).all()
            ]
            if member_ids:
                query = query.filter(TimeEntry.user_id.in_(member_ids))
            else:
                query = query.filter(TimeEntry.user_id == None)  # noqa: E711

        query = TimeTrackingHelpers._apply_team_admin_scope(query, g.user, team_id)

        entries = query.all()
        sessions = [TimeTrackingHelpers._format_entry(e) for e in entries]
        # Longest first (effective duration handles still-open sessions).
        sessions.sort(
            key=lambda s: s.get("effectiveDurationSeconds") or 0, reverse=True
        )

        return jsonify({"status": 200, "sessions": sessions}), 200

    @requires_team_admin_or_above
    def admin_time_stats(self):
        """Aggregate time stats for the admin dashboard.

        Returns exact this-week/last-week sums computed via DB aggregation —
        not limited by pagination. Weeks are Sunday-start, anchored to the org
        timezone (Grand Junction / Mountain Time). The last-week figure spans
        only the same number of fully completed days that have elapsed this
        week, so a partial week isn't compared against a complete one.

        Body: { teamId? }
        """
        data = request.get_json() or {}

        # Grand-Junction-anchored Sunday-start week. ``today_start`` is local
        # midnight today (the end of this week's completed days); the previous
        # week's window covers that same number of completed days.
        (
            week_start,
            today_start,
            prev_week_start,
            prev_week_compare_end,
        ) = org_week_compare_bounds_utc()

        # Build user-scope conditions once, reused across all queries.
        scope = [TimeEntry.org_id == g.user.org_id]
        team_id = data.get("teamId")

        if not is_org_admin_or_above(g.user):
            managed = managed_team_ids_for(g.user)
            member_ids = (
                [
                    tu.user_id
                    for tu in TeamUser.query.filter(TeamUser.team_id.in_(managed)).all()
                ]
                if managed
                else []
            )
            scope.append(
                TimeEntry.user_id.in_(member_ids)
                if member_ids
                else (TimeEntry.user_id == None)  # noqa: E711
            )
        elif team_id:
            member_ids = [
                tu.user_id for tu in TeamUser.query.filter_by(team_id=team_id).all()
            ]
            scope.append(
                TimeEntry.user_id.in_(member_ids)
                if member_ids
                else (TimeEntry.user_id == None)  # noqa: E711
            )

        def sum_hours(start_dt, end_dt=None):
            conds = scope + [
                TimeEntry.status == "completed",
                TimeEntry.clock_in >= start_dt,
            ]
            if end_dt:
                conds.append(TimeEntry.clock_in < end_dt)
            seconds = (
                db.session.query(func.coalesce(func.sum(TimeEntry.duration_seconds), 0))
                .filter(*conds)
                .scalar()
                or 0
            )
            return round((seconds / 3600) * 10) / 10

        def count_adjustments(start_dt, end_dt=None):
            conds = scope + [
                TimeEntry.status == "completed",
                TimeEntry.notes.like("[ADJUSTMENT REQUESTED]%"),
                TimeEntry.clock_in >= start_dt,
            ]
            if end_dt:
                conds.append(TimeEntry.clock_in < end_dt)
            return (
                db.session.query(func.count(TimeEntry.id)).filter(*conds).scalar() or 0
            )

        # Short-session clusters: user-day pairs with 3+ sessions < 5 min
        # (covers both this week and last week)
        cluster_conds = scope + [
            TimeEntry.status == "completed",
            TimeEntry.duration_seconds < 300,
            TimeEntry.clock_in >= prev_week_start,
        ]
        cluster_subq = (
            db.session.query(
                TimeEntry.user_id,
                func.date(TimeEntry.clock_in).label("day"),
            )
            .filter(*cluster_conds)
            .group_by(
                TimeEntry.user_id,
                func.date(TimeEntry.clock_in),
            )
            .having(func.count(TimeEntry.id) >= 3)
            .subquery()
        )
        short_clusters = (
            db.session.query(func.count()).select_from(cluster_subq).scalar() or 0
        )

        return (
            jsonify(
                {
                    "status": 200,
                    # weekHours: this week so far (incl. today) — the headline.
                    "weekHours": sum_hours(week_start),
                    # weekHoursToDate / lastWeekHours: equal completed-day spans,
                    # this week vs last week — the apples-to-apples comparison.
                    "weekHoursToDate": sum_hours(week_start, today_start),
                    "lastWeekHours": sum_hours(prev_week_start, prev_week_compare_end),
                    "pendingAdjustments": count_adjustments(week_start),
                    "lastWeekPendingAdjustments": count_adjustments(
                        prev_week_start, week_start
                    ),
                    "shortSessionClusters": short_clusters,
                }
            ),
            200,
        )

    @requires_team_admin_or_above
    def admin_aggregate_stats(self):
        """Aggregate stats for the active filter set on the time page.

        Accepts the same body as /timetracking/history (startDate, endDate,
        category, filters, teamId) and returns exact totals computed via SQL
        aggregation — no pagination limit.
        """
        data = request.get_json() or {}
        query = TimeEntryQuery(g.user.org_id, data, viewer=g.user)
        return jsonify({"status": 200, **query.fetch_stats()}), 200

    @requires_team_admin_or_above
    def admin_history(self):
        """Get time entry history for the admin's org with cursor-based pagination.

        Returns PAGE_SIZE entries per page ordered newest-first. Pass the
        returned ``nextCursor`` as ``cursor`` in the next request to fetch
        the following page. Omit ``cursor`` (or pass null) to start from
        the most recent entries.
        """
        data = request.get_json() or {}

        query = TimeEntryQuery(g.user.org_id, data, viewer=g.user)
        page, next_cursor = query.fetch_page()

        return (
            jsonify(
                {
                    "status": 200,
                    "entries": [TimeTrackingHelpers._format_entry(e) for e in page],
                    "nextCursor": next_cursor,
                }
            ),
            200,
        )

    @requires_team_admin_or_above
    def admin_force_clock_out(self):
        """Force clock out a user's session."""
        data = request.get_json() or {}
        session_id = data.get("session_id")

        if not session_id:
            return (
                jsonify(
                    {
                        "message": "session_id is required",
                        "status": 400,
                    }
                ),
                400,
            )

        entry = TimeEntry.query.filter_by(
            id=session_id, org_id=g.user.org_id, status="active"
        ).first()

        if not entry:
            return (
                jsonify(
                    {
                        "message": "Active session not found",
                        "status": 404,
                    }
                ),
                404,
            )

        # team_admin: target user must be on a managed team
        if not is_org_admin_or_above(g.user):
            if not team_admin_can_access_user(g.user, entry.user_id):
                return (
                    jsonify(
                        {
                            "message": "Not in your managed teams",
                            "status": 403,
                        }
                    ),
                    403,
                )

        logger.warning(
            f"[CLOCK] FORCE clock_out — admin={g.user.id} ({g.user.osm_username or g.user.email}) "
            f"forcing clock_out on session_id={entry.id} owned by user={entry.user_id} "
            f"clock_in={entry.clock_in}"
        )

        target_user_id = entry.user_id
        entry = TimeEntryService().clock_out(
            session_id, target_user_id, force_clocked_out_by=g.user.id
        )

        # Notify the editor whose session got force-closed.
        try:
            comms_client.emit(
                user_id=entry.user_id,
                org_id=entry.org_id or g.user.org_id,
                type=NotificationType.ENTRY_FORCE_CLOSED,
                message=(
                    f"An admin ended your {entry.activity or 'active'} session "
                    f"(duration {entry.duration_seconds or 0}s)."
                ),
                link="/user/time",
                actor_id=g.user.id,
                entity_type="time_entry",
                entity_id=entry.id,
            )
        except Exception:
            pass

        return (
            jsonify(
                {
                    "message": "Force clock out successful",
                    "status": 200,
                    "session": TimeTrackingHelpers._format_entry(entry),
                }
            ),
            200,
        )

    @requires_team_admin_or_above
    def admin_void_entry(self):
        """Void a time entry."""
        data = request.get_json() or {}
        entry_id = data.get("entry_id")

        if not entry_id:
            return (
                jsonify(
                    {
                        "message": "entry_id is required",
                        "status": 400,
                    }
                ),
                400,
            )

        entry = TimeEntry.query.filter_by(id=entry_id, org_id=g.user.org_id).first()

        if not entry:
            return (
                jsonify(
                    {
                        "message": "Entry not found",
                        "status": 404,
                    }
                ),
                404,
            )

        # team_admin: target user must be on a managed team
        if not is_org_admin_or_above(g.user):
            if not team_admin_can_access_user(g.user, entry.user_id):
                return (
                    jsonify(
                        {
                            "message": "Not in your managed teams",
                            "status": 403,
                        }
                    ),
                    403,
                )

        if entry.status == "voided":
            return (
                jsonify(
                    {
                        "message": "Entry is already voided",
                        "status": 400,
                    }
                ),
                400,
            )

        logger.warning(
            f"[CLOCK] VOID entry — admin={g.user.id} voiding entry_id={entry.id} "
            f"owned by user={entry.user_id} status_was={entry.status}"
        )
        entry = TimeEntryService().void(entry_id, g.user.org_id, g.user.id)

        # Notify the owner that one of their entries was voided.
        try:
            comms_client.emit(
                user_id=entry.user_id,
                org_id=entry.org_id or g.user.org_id,
                type=NotificationType.ENTRY_ADJUSTED,
                message="An admin voided one of your time entries.",
                link="/user/time",
                actor_id=g.user.id,
                entity_type="time_entry",
                entity_id=entry.id,
            )
        except Exception:
            pass

        return (
            jsonify(
                {
                    "message": "Entry voided",
                    "status": 200,
                    "entry": TimeTrackingHelpers._format_entry(entry),
                }
            ),
            200,
        )

    @requires_team_admin_or_above
    def admin_edit_entry(self):
        """Edit a time entry's times or category."""
        data = request.get_json() or {}
        entry_id = data.get("entry_id")

        if not entry_id:
            return (
                jsonify(
                    {
                        "message": "entry_id is required",
                        "status": 400,
                    }
                ),
                400,
            )

        entry = TimeEntry.query.filter_by(id=entry_id, org_id=g.user.org_id).first()

        if not entry:
            return (
                jsonify(
                    {
                        "message": "Entry not found",
                        "status": 404,
                    }
                ),
                404,
            )

        # team_admin: target user must be on a managed team
        if not is_org_admin_or_above(g.user):
            if not team_admin_can_access_user(g.user, entry.user_id):
                return (
                    jsonify(
                        {
                            "message": "Not in your managed teams",
                            "status": 403,
                        }
                    ),
                    403,
                )

        # Parse optional fields
        if "clockIn" in data:
            try:
                entry.clock_in = datetime.fromisoformat(
                    data["clockIn"].replace("Z", "+00:00")
                ).replace(tzinfo=None)
            except (ValueError, AttributeError):
                return (
                    jsonify(
                        {
                            "message": "Invalid clockIn format. Use ISO 8601.",
                            "status": 400,
                        }
                    ),
                    400,
                )

        if "clockOut" in data:
            try:
                entry.clock_out = datetime.fromisoformat(
                    data["clockOut"].replace("Z", "+00:00")
                ).replace(tzinfo=None)
            except (ValueError, AttributeError):
                return (
                    jsonify(
                        {
                            "message": "Invalid clockOut format. Use ISO 8601.",
                            "status": 400,
                        }
                    ),
                    400,
                )

        if "category" in data:
            cat = data["category"].lower()
            if cat not in ACTIVITY_SLUGS:
                return (
                    jsonify(
                        {
                            "message": f"Invalid category. Must be one of: {', '.join(ACTIVITY_SLUGS)}",
                            "status": 400,
                        }
                    ),
                    400,
                )
            entry.activity = cat

        if "taskName" in data:
            entry.task_name = data["taskName"]
        if "taskRefType" in data:
            entry.task_ref_type = data["taskRefType"]
        if "taskRefId" in data:
            entry.task_ref_id = data["taskRefId"]

        # Subcategory + event fields (only re-validate when any of the
        # three are explicitly in the payload — admins editing only
        # times shouldn't have to send the sub again).
        if "subcategoryId" in data:
            try:
                sub_fields = _resolve_subcategory_for_write(
                    # Subcategory visibility check uses the entry's owner, not
                    # the editing admin — a team_admin editing entries for
                    # a member should be able to pick subs that member sees.
                    User.query.get(entry.user_id) or g.user,
                    entry.activity,
                    (
                        data.get("subcategoryId")
                        if "subcategoryId" in data
                        else entry.subcategory_id
                    ),
                    None,
                    None,
                )
            except ValueError as e:
                return jsonify({"message": str(e), "status": 400}), 400
            entry.subcategory_id = sub_fields["subcategory_id"]
            entry.subcategory_name = sub_fields["subcategory_name"]
            entry.retained_participants = sub_fields["retained_participants"]
            entry.new_participants = sub_fields["new_participants"]

        # Recalculate duration if both times present
        if entry.clock_in and entry.clock_out:
            entry.duration_seconds = int(
                (entry.clock_out - entry.clock_in).total_seconds()
            )

        # Mark adjustment requests as fulfilled
        if entry.notes and entry.notes.startswith("[ADJUSTMENT REQUESTED]"):
            entry.notes = entry.notes.replace("[ADJUSTMENT REQUESTED]", "[ADJUSTED]", 1)

        entry.edited_by = g.user.id
        entry.edited_at = datetime.utcnow()
        entry.save()

        return (
            jsonify(
                {
                    "message": "Entry updated",
                    "status": 200,
                    "entry": TimeTrackingHelpers._format_entry(entry),
                }
            ),
            200,
        )

    @requires_team_admin_or_above
    def admin_add_entry(self):
        """Manually create a time entry for a user."""
        data = request.get_json() or {}
        user_id = data.get("userId")
        clock_in_str = data.get("clockIn")
        clock_out_str = data.get("clockOut")
        category = (data.get("category") or "").lower()
        project_id = data.get("projectId")
        notes = data.get("notes", "")

        if not user_id or not clock_in_str or not clock_out_str or not category:
            return (
                jsonify(
                    {
                        "message": "userId, clockIn, clockOut, and category are required",
                        "status": 400,
                    }
                ),
                400,
            )

        if category not in ACTIVITY_SLUGS:
            return (
                jsonify(
                    {
                        "message": f"Invalid category. Must be one of: {', '.join(ACTIVITY_SLUGS)}",
                        "status": 400,
                    }
                ),
                400,
            )

        # Validate user exists in same org
        user = User.query.get(user_id)
        if not user or user.org_id != g.user.org_id:
            return (
                jsonify(
                    {
                        "message": "User not found in your organization",
                        "status": 404,
                    }
                ),
                404,
            )

        # Subcategory + event fields (validated against the TARGET user's
        # visibility scope, not the admin's).
        try:
            sub_fields = _resolve_subcategory_for_write(
                user,
                category,
                data.get("subcategoryId"),
                data.get("retainedParticipants"),
                data.get("newParticipants"),
            )
        except ValueError as e:
            return jsonify({"message": str(e), "status": 400}), 400

        # team_admin: target user must be on a managed team
        if not is_org_admin_or_above(g.user):
            if not team_admin_can_access_user(g.user, user_id):
                return (
                    jsonify(
                        {
                            "message": "Not in your managed teams",
                            "status": 403,
                        }
                    ),
                    403,
                )

        # Parse times
        try:
            clock_in = datetime.fromisoformat(
                clock_in_str.replace("Z", "+00:00")
            ).replace(tzinfo=None)
        except (ValueError, AttributeError):
            return (
                jsonify(
                    {
                        "message": "Invalid clockIn format. Use ISO 8601.",
                        "status": 400,
                    }
                ),
                400,
            )

        try:
            clock_out = datetime.fromisoformat(
                clock_out_str.replace("Z", "+00:00")
            ).replace(tzinfo=None)
        except (ValueError, AttributeError):
            return (
                jsonify(
                    {
                        "message": "Invalid clockOut format. Use ISO 8601.",
                        "status": 400,
                    }
                ),
                400,
            )

        if clock_out <= clock_in:
            return (
                jsonify(
                    {
                        "message": "Clock out must be after clock in",
                        "status": 400,
                    }
                ),
                400,
            )

        # Validate project if provided
        if project_id:
            project = Project.query.get(project_id)
            if not project:
                return (
                    jsonify(
                        {
                            "message": "Project not found",
                            "status": 404,
                        }
                    ),
                    404,
                )

        entry = TimeEntryService().create_completed(
            user_id=user_id,
            org_id=g.user.org_id,
            created_by=g.user.id,
            activity=category,
            sub_fields=sub_fields,
            clock_in=clock_in,
            clock_out=clock_out,
            project_id=project_id,
            task_name=data.get("taskName"),
            task_ref_type=data.get("taskRefType"),
            task_ref_id=data.get("taskRefId"),
            notes=notes,
        )

        return (
            jsonify(
                {
                    "message": "Entry created",
                    "status": 200,
                    "entry": TimeTrackingHelpers._format_entry(entry),
                }
            ),
            200,
        )

    @requires_team_admin_or_above
    def admin_export(self):
        """Export time entries as CSV, JSON, or PDF with the same filters as history."""
        data = request.get_json() or {}
        export_format = (data.get("format") or "csv").lower()

        if export_format not in ("csv", "json", "pdf"):
            return (
                jsonify(
                    {
                        "message": "Invalid format. Must be csv, json, or pdf.",
                        "status": 400,
                    }
                ),
                400,
            )

        omit_columns = data.get("omit_columns") or []
        if not isinstance(omit_columns, list):
            omit_columns = []

        entries = TimeEntryQuery(g.user.org_id, data, viewer=g.user).fetch_all()

        today_str = datetime.utcnow().strftime("%Y-%m-%d")

        if export_format == "csv":
            return self._export_csv(entries, today_str, omit_columns=omit_columns)
        elif export_format == "json":
            return self._export_json(entries, today_str)
        elif export_format == "pdf":
            return self._export_pdf(entries, data, today_str, omit_columns=omit_columns)

    def _export_columns(self):
        """Single source of truth for export column order, labels, and value
        extractors. Each entry: (key, label, value_fn(user, project, entry)).

        Both CSV and PDF iterate this list; `omit_columns` filters by `key`.
        """
        return [
            ("user_name", "User", lambda u, p, e: u.full_name if u else "Unknown"),
            (
                "osm_username",
                "OSM Username",
                lambda u, p, e: (u.osm_username if u else "") or "",
            ),
            ("project", "Project", lambda u, p, e: (p.name if p else "") or ""),
            (
                "category",
                "Category",
                lambda u, p, e: ACTIVITY_DISPLAY_MAP.get(
                    e.activity, e.activity.capitalize() if e.activity else ""
                ),
            ),
            ("subcategory", "Subcategory", lambda u, p, e: e.subcategory_name or ""),
            ("task", "Task", lambda u, p, e: e.task_name or ""),
            (
                "clock_in",
                "Clock In",
                lambda u, p, e: e.clock_in.isoformat() + "Z" if e.clock_in else "",
            ),
            (
                "clock_out",
                "Clock Out",
                lambda u, p, e: e.clock_out.isoformat() + "Z" if e.clock_out else "",
            ),
            (
                "duration_hours",
                "Duration (hours)",
                lambda u, p, e: TimeTrackingHelpers._format_duration_hours(
                    e.duration_seconds
                ),
            ),
            ("status", "Status", lambda u, p, e: e.status or ""),
            ("changesets", "Changesets", lambda u, p, e: e.changeset_count or 0),
            ("changes", "Changes", lambda u, p, e: e.changes_count or 0),
            ("notes", "Notes", lambda u, p, e: e.notes or ""),
            ("user_notes", "User Notes", lambda u, p, e: e.user_notes or ""),
        ]

    def _export_csv(self, entries, today_str, omit_columns=None):
        """Generate a CSV export of time entries.

        - QUOTE_ALL so non-ASCII / multi-byte OSM usernames can never
          break column alignment in Excel/Numbers.
        - UTF-8 BOM prefix (\\ufeff) so Excel opens the file as UTF-8
          rather than Latin-1 (without BOM, multi-byte chars render as
          mojibake).
        """
        omit = set(omit_columns or [])
        active = [c for c in self._export_columns() if c[0] not in omit]

        output = io.StringIO()
        output.write("﻿")  # UTF-8 BOM — Excel needs this for non-ASCII
        writer = csv.writer(output, quoting=csv.QUOTE_ALL)
        writer.writerow([label for _, label, _ in active])

        for entry in entries:
            user = User.query.get(entry.user_id)
            project = Project.query.get(entry.project_id) if entry.project_id else None
            writer.writerow([fn(user, project, entry) for _, _, fn in active])

        csv_data = output.getvalue()
        output.close()

        return Response(
            csv_data.encode("utf-8"),
            mimetype="text/csv; charset=utf-8",
            headers={
                "Content-Disposition": f'attachment; filename="time-report-{today_str}.csv"'
            },
        )

    def _export_json(self, entries, today_str):
        """Generate a JSON export of time entries."""
        formatted = [TimeTrackingHelpers._format_entry(e) for e in entries]
        resp = jsonify(formatted)
        resp.headers["Content-Disposition"] = (
            f'attachment; filename="time-report-{today_str}.json"'
        )
        return resp

    def _export_pdf(self, entries, data, today_str, omit_columns=None):
        """Generate a PDF export of time entries.

        - Notes / User Notes are excluded from PDF by default (too long
          for a printable table); request other columns via omit_columns.
        - Text-heavy cells (User, OSM Username, Project, Task) wrap with
          reportlab Paragraph so multi-byte / long values flow into
          multiple lines instead of being chopped at 20 chars.
        """

        buffer = io.BytesIO()
        doc = SimpleDocTemplate(
            buffer,
            pagesize=landscape(letter),
            leftMargin=0.5 * inch,
            rightMargin=0.5 * inch,
            topMargin=0.5 * inch,
            bottomMargin=0.5 * inch,
        )
        styles = getSampleStyleSheet()
        cell_style = ParagraphStyle(
            "Cell",
            parent=styles["Normal"],
            fontSize=7,
            leading=8,
            wordWrap="CJK",  # break anywhere — works for non-spaced scripts too
        )
        elements = []

        # Title
        elements.append(Paragraph("Mikro Time Report", styles["Title"]))

        # Filter summary
        summary_parts = []
        if data.get("startDate"):
            summary_parts.append(f"From: {data['startDate']}")
        if data.get("endDate"):
            summary_parts.append(f"To: {data['endDate']}")
        if data.get("category"):
            summary_parts.append(f"Category: {data['category']}")
        if data.get("teamId"):
            summary_parts.append(f"Team ID: {data['teamId']}")
        if data.get("userId"):
            summary_parts.append(f"User ID: {data['userId']}")
        if summary_parts:
            elements.append(Paragraph(" | ".join(summary_parts), styles["Normal"]))
        elements.append(Spacer(1, 12))

        # Column subset for PDF: registry minus notes/user_notes (too long)
        # plus any keys explicitly omitted by the caller.
        pdf_skip = set(omit_columns or []) | {"notes", "user_notes"}
        active = [c for c in self._export_columns() if c[0] not in pdf_skip]

        PDF_WIDTHS = {
            "user_name": 1.2 * inch,
            "osm_username": 1.3 * inch,
            "project": 1.4 * inch,
            "category": 0.85 * inch,
            "task": 1.4 * inch,
            "clock_in": 1.05 * inch,
            "clock_out": 1.05 * inch,
            "duration_hours": 0.7 * inch,
            "status": 0.75 * inch,
            "changesets": 0.65 * inch,
            "changes": 0.65 * inch,
        }
        # Cells that may contain long / multi-byte text — wrap in Paragraph.
        PDF_WRAPPED_COLS = {"user_name", "osm_username", "project", "task"}

        # Override clock_in/clock_out value fns so PDF gets the shorter
        # "YYYY-MM-DD HH:MM" string instead of the ISO8601 the registry
        # returns by default (the registry is shared with CSV).
        def pdf_value(key, fn, user, project, entry):
            if key == "clock_in":
                return (
                    entry.clock_in.strftime("%Y-%m-%d %H:%M") if entry.clock_in else ""
                )
            if key == "clock_out":
                return (
                    entry.clock_out.strftime("%Y-%m-%d %H:%M")
                    if entry.clock_out
                    else ""
                )
            return fn(user, project, entry)

        headers = [label for _, label, _ in active]
        table_data = [headers]

        total_seconds = 0
        total_changesets = 0
        total_changes = 0

        for entry in entries:
            user = User.query.get(entry.user_id)
            project = Project.query.get(entry.project_id) if entry.project_id else None
            total_seconds += entry.duration_seconds or 0
            total_changesets += entry.changeset_count or 0
            total_changes += entry.changes_count or 0

            row = []
            for key, _label, fn in active:
                val = pdf_value(key, fn, user, project, entry)
                if key in PDF_WRAPPED_COLS:
                    # Transliterate to ASCII so non-Latin OSM usernames
                    # / user names render readably instead of as a row
                    # of black boxes (Helvetica lacks the glyphs).
                    row.append(
                        Paragraph(
                            xml_escape(_ascii_safe(val)),
                            cell_style,
                        )
                    )
                else:
                    row.append(str(val))
            table_data.append(row)

        # Totals row keyed by column so it stays aligned no matter what
        # was omitted.
        totals_by_key = {
            "user_name": "TOTALS",
            "duration_hours": TimeTrackingHelpers._format_duration_hours(total_seconds),
            "status": f"{len(entries)} entries",
            "changesets": str(total_changesets),
            "changes": str(total_changes),
        }
        table_data.append([totals_by_key.get(key, "") for key, _, _ in active])

        col_widths = [PDF_WIDTHS.get(key, 1.0 * inch) for key, _, _ in active]
        table = Table(table_data, colWidths=col_widths, repeatRows=1)
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2563eb")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("FONTSIZE", (0, 0), (-1, -1), 7),
                    ("ALIGN", (0, 0), (-1, -1), "LEFT"),
                    ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                    (
                        "ROWBACKGROUNDS",
                        (0, 1),
                        (-1, -2),
                        [colors.white, colors.HexColor("#f0f4ff")],
                    ),
                    ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#e2e8f0")),
                    ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("TOPPADDING", (0, 0), (-1, -1), 3),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ]
            )
        )
        elements.append(table)

        # Footer
        elements.append(Spacer(1, 12))
        elements.append(
            Paragraph(
                f"Generated: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}",
                styles["Normal"],
            )
        )

        doc.build(elements)
        pdf_data = buffer.getvalue()
        buffer.close()

        return Response(
            pdf_data,
            mimetype="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="time-report-{today_str}.pdf"'
            },
        )

    # ─── Hourly Contractor Payments ──────────────────────────────

    @requires_team_admin_or_above
    def admin_hourly_summary(self):
        """Get monthly hours and payment status for all hourly contractors."""
        data = request.get_json(silent=True) or {}
        year = data.get("year", datetime.now().year)
        org_id = g.user.org_id

        today = date.today()

        # Get all hourly contractors: users with an active rate today
        active_rate_user_ids = {
            r.user_id
            for r in UserHourlyRate.query.filter(
                UserHourlyRate.org_id == org_id,
                UserHourlyRate.start_date <= today,
                or_(
                    UserHourlyRate.end_date.is_(None), UserHourlyRate.end_date >= today
                ),
            ).all()
        }
        if not active_rate_user_ids:
            return jsonify({"status": 200, "year": year, "contractors": []})
        contractors = User.query.filter(
            User.org_id == org_id,
            User.id.in_(active_rate_user_ids),
        ).all()

        # Narrow to the viewer's scope (team_admin → managed-team contractors;
        # org-admin+ → unrestricted). visible_user_ids() is None for the
        # unrestricted case and a member-id set (possibly empty) otherwise.
        visible = UserScope(g.user).visible_user_ids()
        if visible is not None:
            contractors = [c for c in contractors if c.id in visible]

        if not contractors:
            return jsonify({"status": 200, "year": year, "contractors": []})

        contractor_ids = [c.id for c in contractors]
        _rate_svc = HourlyRateHistoryService()
        monthly_rate_maps = {
            m: _rate_svc.rate_map_for_users(contractor_ids, date(year, m, 1))
            for m in range(1, 13)
        }
        today_rate_map = _rate_svc.rate_map_for_users(contractor_ids, today)

        # Months are bucketed against the org timezone (America/Denver), not
        # UTC. A session worked Mar 31 9pm Manila (= Apr 1 01:00 UTC) lands
        # in March for payroll because Kaart runs one monthly close from
        # Denver. Without this, those hours would silently cross the month.
        time_lookup = {}
        for m in range(1, 13):
            m_start, m_end = org_month_bounds_utc(year, m)
            rows = (
                db.session.query(
                    TimeEntry.user_id,
                    func.sum(TimeEntry.duration_seconds).label("total_seconds"),
                )
                .filter(
                    TimeEntry.org_id == org_id,
                    TimeEntry.status == "completed",
                    TimeEntry.clock_in >= m_start,
                    TimeEntry.clock_in < m_end,
                    TimeEntry.user_id.in_(contractor_ids),
                )
                .group_by(TimeEntry.user_id)
                .all()
            )
            for row in rows:
                time_lookup.setdefault(row.user_id, {})[m] = row.total_seconds or 0

        # Get existing HourlyPayment records for this year
        payments = HourlyPayment.query.filter(
            HourlyPayment.org_id == org_id,
            HourlyPayment.year == year,
        ).all()

        # Build lookup: {(user_id, month): HourlyPayment}
        payment_lookup = {}
        for hp in payments:
            payment_lookup[(hp.user_id, hp.month)] = hp

        # Build response
        result = []
        for c in contractors:
            months = {}
            year_total_seconds = 0
            year_total_earnings = 0.0

            for m in range(1, 13):
                hp = payment_lookup.get((c.id, m))
                if hp and hp.paid:
                    # Paid month: use snapshot values
                    secs = hp.total_seconds
                    hrs = round(secs / 3600, 2)
                    earnings = hp.amount_due
                    months[str(m)] = {
                        "totalSeconds": secs,
                        "hours": hrs,
                        "earnings": round(earnings, 2),
                        "paid": True,
                        "paidAt": hp.paid_at.isoformat() if hp.paid_at else None,
                        "notes": hp.notes,
                    }
                else:
                    # Unpaid: compute live from time entries + rate active that month
                    secs = time_lookup.get(c.id, {}).get(m, 0)
                    hrs = round(secs / 3600, 2)
                    rate = monthly_rate_maps[m].get(c.id) or 0
                    earnings = round(hrs * rate, 2)
                    months[str(m)] = {
                        "totalSeconds": secs,
                        "hours": hrs,
                        "earnings": earnings,
                        "paid": False,
                        "paidAt": None,
                        "notes": hp.notes if hp else None,
                    }

                year_total_seconds += secs
                year_total_earnings += earnings

            year_hours = round(year_total_seconds / 3600, 2)

            result.append(
                {
                    "userId": c.id,
                    "name": c.full_name,
                    "osmUsername": c.osm_username or "",
                    "country": c.country or "",
                    "hourlyRate": today_rate_map.get(c.id),
                    "months": months,
                    "yearTotal": {
                        "totalSeconds": year_total_seconds,
                        "hours": year_hours,
                        "earnings": round(year_total_earnings, 2),
                    },
                }
            )

        return jsonify({"status": 200, "year": year, "contractors": result})

    @requires_team_admin_or_above
    def admin_mark_hourly_paid(self):
        """Mark or unmark an hourly contractor's month as paid."""
        data = request.get_json(silent=True) or {}
        user_id = data.get("userId")
        year = data.get("year")
        month = data.get("month")
        paid = data.get("paid", True)
        notes = data.get("notes")

        if not all([user_id, year, month]):
            return (
                jsonify(
                    {"message": "userId, year, and month are required", "status": 400}
                ),
                400,
            )

        user = User.query.get(user_id)
        if not user or user.org_id != g.user.org_id:
            return jsonify({"message": "User not found", "status": 404}), 404

        # team_admin: target user must be on a managed team
        if not is_org_admin_or_above(g.user):
            if not team_admin_can_access_user(g.user, user_id):
                return (
                    jsonify({"message": "Not in your managed teams", "status": 403}),
                    403,
                )

        org_id = g.user.org_id

        # Find or create the HourlyPayment record
        hp = HourlyPayment.query.filter_by(
            user_id=user_id, year=year, month=month
        ).first()

        if paid:
            # Month window is org-TZ anchored (America/Denver), matching the
            # payroll summary view so snapshots and live totals agree.
            month_start, month_end = org_month_bounds_utc(year, month)

            total_seconds = (
                db.session.query(func.coalesce(func.sum(TimeEntry.duration_seconds), 0))
                .filter(
                    TimeEntry.user_id == user_id,
                    TimeEntry.org_id == org_id,
                    TimeEntry.status == "completed",
                    TimeEntry.clock_in >= month_start,
                    TimeEntry.clock_in < month_end,
                )
                .scalar()
                or 0
            )

            _rate_entry = HourlyRateHistoryService().get_active_rate(
                user_id, date(year, month, 1)
            )
            rate = float(_rate_entry.rate) if _rate_entry else 0
            hours = total_seconds / 3600
            amount = round(hours * rate, 2)

            if hp:
                hp.total_seconds = total_seconds
                hp.hourly_rate = rate
                hp.amount_due = amount
                hp.paid = True
                hp.paid_at = datetime.now()
                hp.paid_by = g.user.id
                if notes is not None:
                    hp.notes = notes
            else:
                hp = HourlyPayment(
                    user_id=user_id,
                    org_id=org_id,
                    year=year,
                    month=month,
                    total_seconds=total_seconds,
                    hourly_rate=rate,
                    amount_due=amount,
                    paid=True,
                    paid_at=datetime.now(),
                    paid_by=g.user.id,
                    notes=notes,
                )
                db.session.add(hp)
        else:
            # Unmark as paid
            if hp:
                hp.paid = False
                hp.paid_at = None
                hp.paid_by = None
                if notes is not None:
                    hp.notes = notes

        db.session.commit()

        # Notify the contractor when their month is freshly marked paid.
        if paid:
            try:
                comms_client.emit(
                    user_id=user_id,
                    org_id=user.org_id or g.user.org_id,
                    type=NotificationType.PAYMENT_SENT,
                    message=(
                        f"Your {year}-{month:02d} hourly payment has been "
                        f"marked paid."
                    ),
                    link="/user/payments",
                    actor_id=g.user.id,
                    entity_type="hourly_payment",
                    entity_id=hp.id if hp else None,
                )
            except Exception:
                pass

        return jsonify(
            {
                "status": 200,
                "message": f"{'Marked' if paid else 'Unmarked'} {user.full_name} {year}-{month:02d} as paid",
            }
        )

    # ─── Subcategory management endpoints ────────────────────────
    #
    # Tier-2 catalog. Visibility rules and management permissions are
    # SSOT'd in the module-level helpers `_visible_subcategories_query`
    # and `_can_manage_subcategory` above — do not reimplement here.

    def subcategories_list(self):
        """List subcategories visible to the caller (clock-in dropdown).

        Body: optional ``activity`` to narrow. Returns sorted list.
        """
        if not hasattr(g, "user") or not g.user:
            return jsonify({"message": "Unauthorized", "status": 401}), 401
        data = request.get_json() or {}
        activity = data.get("activity")
        if activity and activity not in ACTIVITY_SLUGS:
            return (
                jsonify(
                    {
                        "message": "Invalid activity",
                        "status": 400,
                    }
                ),
                400,
            )
        subs = _visible_subcategories_query(g.user, activity=activity).all()
        return jsonify(
            {
                "status": 200,
                "subcategories": [
                    TimeTrackingHelpers._format_subcategory(s) for s in subs
                ],
            }
        )

    @requires_team_admin_or_above
    def subcategories_admin_list(self):
        """List subcategories the caller can SEE on the admin page.

        Visibility-on-admin-tab rules (echoes _can_manage_subcategory):
        - super_admin: every sub in the system (incl. global).
        - admin (org_admin): every sub in their org.
        - team_admin (updated 2026-05-21): every sub in their own org
          that's either org-scoped OR team-scoped to a team they lead.
          Edit/disable is then gated row-by-row by _can_manage_subcategory
          (authorship rule), so rows they didn't create render in the
          table but their action buttons are no-ops server-side. The
          frontend can decide to render them disabled.

        Optional ``activity`` filter narrows.
        """
        data = request.get_json() or {}
        activity = data.get("activity")
        if activity and activity not in ACTIVITY_SLUGS:
            return jsonify({"message": "Invalid activity", "status": 400}), 400

        role = getattr(g.user, "role", None)
        q = ActivitySubcategory.query
        if role == "super_admin":
            pass  # see everything
        elif role == "admin":
            q = q.filter(ActivitySubcategory.org_id == g.user.org_id)
        elif role == "team_admin":
            led = _team_admin_led_team_ids(g.user)
            # Org-scoped subs in own org + team-scoped subs for teams led.
            scope_clauses = [ActivitySubcategory.team_id.is_(None)]
            if led:
                scope_clauses.append(ActivitySubcategory.team_id.in_(list(led)))
            q = q.filter(
                ActivitySubcategory.org_id == g.user.org_id,
                or_(*scope_clauses),
            )
        else:
            return jsonify({"message": "Forbidden", "status": 403}), 403

        if activity:
            q = q.filter(ActivitySubcategory.activity == activity)
        subs = q.order_by(
            ActivitySubcategory.activity.asc(),
            ActivitySubcategory.sort_order.asc(),
            ActivitySubcategory.name.asc(),
        ).all()
        return jsonify(
            {
                "status": 200,
                "subcategories": [
                    TimeTrackingHelpers._format_subcategory(s) for s in subs
                ],
            }
        )

    @requires_team_admin_or_above
    def subcategories_create(self):
        """Create a subcategory row.

        Body:
            activity: required, must be in ACTIVITY_SLUGS
            name: required, ≤100 chars
            scope: "global" | "org" | "team" (super_admin only for global)
            teamId: required when scope == "team"
            sortOrder?: int (default 0)
            requiresProject?: bool (default false)
            allowEventFields?: bool (default false)
        """
        data = request.get_json() or {}
        activity = (data.get("activity") or "").lower()
        name = (data.get("name") or "").strip()
        scope = (data.get("scope") or "").lower()

        if activity not in ACTIVITY_SLUGS:
            return jsonify({"message": "Invalid activity", "status": 400}), 400
        if not name:
            return jsonify({"message": "Name is required", "status": 400}), 400
        if len(name) > 100:
            return (
                jsonify(
                    {
                        "message": "Name must be 100 characters or fewer",
                        "status": 400,
                    }
                ),
                400,
            )
        if scope not in ("global", "org", "team"):
            return (
                jsonify(
                    {
                        "message": "scope must be one of: global, org, team",
                        "status": 400,
                    }
                ),
                400,
            )

        # Resolve target org_id / team_id from scope, then permission-check
        # through the SSOT helper.
        if scope == "global":
            org_id_target = None
            team_id_target = None
        elif scope == "org":
            org_id_target = g.user.org_id
            team_id_target = None
        else:  # team
            try:
                team_id_target = int(data.get("teamId"))
            except (TypeError, ValueError):
                return (
                    jsonify(
                        {
                            "message": "teamId is required for team-scoped subcategories",
                            "status": 400,
                        }
                    ),
                    400,
                )
            team = Team.query.get(team_id_target)
            if team is None or team.org_id != g.user.org_id:
                return jsonify({"message": "Team not found", "status": 404}), 404
            org_id_target = g.user.org_id

        if not _can_manage_subcategory(
            g.user,
            org_id=org_id_target,
            team_id=team_id_target,
        ):
            return (
                jsonify(
                    {
                        "message": "You don't have permission to create subcategories in that scope",
                        "status": 403,
                    }
                ),
                403,
            )

        slug = TimeTrackingHelpers._slugify(name)
        if not slug:
            return (
                jsonify(
                    {
                        "message": "Name must contain at least one alphanumeric character",
                        "status": 400,
                    }
                ),
                400,
            )

        # Reject duplicate within the (activity, slug, scope) uniqueness.
        dup = ActivitySubcategory.query.filter_by(
            activity=activity,
            slug=slug,
            org_id=org_id_target,
            team_id=team_id_target,
        ).first()
        if dup is not None:
            return (
                jsonify(
                    {
                        "message": "A subcategory with that name already exists in this scope",
                        "status": 409,
                    }
                ),
                409,
            )

        sub = ActivitySubcategory()
        sub.activity = activity
        sub.name = name
        sub.slug = slug
        sub.org_id = org_id_target
        sub.team_id = team_id_target
        sub.is_active = True
        sub.sort_order = int(data.get("sortOrder") or 0)
        sub.requires_project = bool(data.get("requiresProject"))
        sub.allow_event_fields = bool(data.get("allowEventFields"))
        sub.created_by = g.user.id
        sub.save()

        return jsonify(
            {
                "status": 200,
                "message": "Subcategory created",
                "subcategory": TimeTrackingHelpers._format_subcategory(sub),
            }
        )

    @requires_team_admin_or_above
    def subcategories_update(self):
        """Update a subcategory's mutable fields.

        Scope (org_id / team_id) and parent activity cannot be changed
        in-place — delete + recreate for that. Mutable: name, is_active,
        sort_order, requires_project, allow_event_fields.
        """
        data = request.get_json() or {}
        try:
            sub_id = int(data.get("id"))
        except (TypeError, ValueError):
            return jsonify({"message": "id is required", "status": 400}), 400

        sub = ActivitySubcategory.query.get(sub_id)
        if sub is None:
            return jsonify({"message": "Subcategory not found", "status": 404}), 404
        if not _can_manage_subcategory(g.user, sub=sub):
            return jsonify({"message": "Forbidden", "status": 403}), 403

        if "name" in data:
            new_name = (data.get("name") or "").strip()
            if not new_name:
                return jsonify({"message": "Name cannot be empty", "status": 400}), 400
            if len(new_name) > 100:
                return (
                    jsonify(
                        {
                            "message": "Name must be 100 characters or fewer",
                            "status": 400,
                        }
                    ),
                    400,
                )
            sub.name = new_name
            # slug stays — renames don't break historical snapshots and
            # changing the slug would be confusing in URLs/filters.

        if "isActive" in data:
            sub.is_active = bool(data.get("isActive"))
        if "sortOrder" in data:
            try:
                sub.sort_order = int(data.get("sortOrder"))
            except (TypeError, ValueError):
                return (
                    jsonify({"message": "sortOrder must be an integer", "status": 400}),
                    400,
                )
        if "requiresProject" in data:
            sub.requires_project = bool(data.get("requiresProject"))
        if "allowEventFields" in data:
            sub.allow_event_fields = bool(data.get("allowEventFields"))

        sub.save()
        return jsonify(
            {
                "status": 200,
                "message": "Subcategory updated",
                "subcategory": TimeTrackingHelpers._format_subcategory(sub),
            }
        )

    @requires_team_admin_or_above
    def subcategories_delete(self):
        """Soft-delete a subcategory (is_active = false).

        We never hard-delete: time_entries snapshot `subcategory_name`
        already, but keeping the row around preserves the link from
        `time_entries.subcategory_id` for joins (audit, drilldowns).
        """
        data = request.get_json() or {}
        try:
            sub_id = int(data.get("id"))
        except (TypeError, ValueError):
            return jsonify({"message": "id is required", "status": 400}), 400

        sub = ActivitySubcategory.query.get(sub_id)
        if sub is None:
            return jsonify({"message": "Subcategory not found", "status": 404}), 404
        if not _can_manage_subcategory(g.user, sub=sub):
            return jsonify({"message": "Forbidden", "status": 403}), 403

        sub.is_active = False
        sub.save()
        return jsonify(
            {
                "status": 200,
                "message": "Subcategory disabled",
                "subcategory": TimeTrackingHelpers._format_subcategory(sub),
            }
        )
