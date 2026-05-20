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
from datetime import datetime, timedelta

import requests as http_requests
from flask.views import MethodView
from flask import g, request, jsonify, Response

try:
    from unidecode import unidecode as _unidecode
except ImportError:
    _unidecode = None

from ..utils import requires_admin, requires_team_admin_or_above
from ..utils.tz import org_month_bounds_utc, parse_filter_datetime
from sqlalchemy import func, or_
from ..database import (
    TimeEntry, User, Project, Task, Team, TeamUser, TeamLead,
    CustomTopic, ActivitySubcategory, HourlyPayment, db,
)
from ..filters import resolve_filtered_user_ids
from ..auth import (
    is_org_admin_or_above,
    managed_team_ids_for,
    team_admin_can_access_team,
    team_admin_can_access_user,
    team_member_ids_for,
)

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
    return (
        unicodedata.normalize("NFKD", s)
        .encode("ascii", "ignore")
        .decode("ascii")
    )

# Tier-1 activity slugs (the renamed `category` enum). Stored in
# `time_entries.activity`. Mirrors the SSOT on the frontend at
# `lib/timeTracking.ts` — keep these two lists in sync; any new
# activity needs to be added in BOTH places (and seeded with a
# default set of subcategories via the Time Categories admin page
# or a follow-up migration).
ACTIVITY_SLUGS = {
    "editing", "validating", "training", "checklist",
    "qc_review", "meeting", "documentation", "imagery_capture",
    "project_creation", "community", "other",
    # Legacy values still accepted for backward compat (clock-in payloads
    # from older clients). Normalized to canonical slugs on display.
    "mapping", "validation", "review",
}

# Map stored activity slug -> display label. User-facing UI strings.
ACTIVITY_DISPLAY_MAP = {
    "editing": "Editing",
    "validating": "Validating",
    "training": "Training",
    "checklist": "Checklist",
    "qc_review": "QC / Review",
    "meeting": "Meeting",
    "documentation": "Documentation",
    "imagery_capture": "Imagery Capture",
    "project_creation": "Project Creation",
    "community": "Community",
    "other": "Other",
    # Legacy mappings -> canonical labels
    "mapping": "Editing",
    "validation": "Validating",
    "review": "QC / Review",
}


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
        tu.team_id
        for tu in TeamUser.query.filter_by(user_id=user.id).all()
    ]

    visibility_clauses = [
        # Global subs — every user sees these.
        (ActivitySubcategory.org_id.is_(None)) &
        (ActivitySubcategory.team_id.is_(None)),
    ]
    if user_org_id:
        # Org-scoped, no team — anyone in that org.
        visibility_clauses.append(
            (ActivitySubcategory.org_id == user_org_id) &
            (ActivitySubcategory.team_id.is_(None))
        )
        # Team-scoped — user must be a member of that team.
        if member_team_ids:
            visibility_clauses.append(
                (ActivitySubcategory.org_id == user_org_id) &
                (ActivitySubcategory.team_id.in_(member_team_ids))
            )
        # Admins see EVERY sub in their org (including team subs they
        # aren't members of) — they're managing the catalog.
        if is_admin:
            visibility_clauses.append(
                ActivitySubcategory.org_id == user_org_id
            )

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
    return {
        tl.team_id
        for tl in TeamLead.query.filter_by(user_id=user.id).all()
    }


def _can_manage_subcategory(user, *, org_id=None, team_id=None, sub=None):
    """Permission gate for create/update/delete on a subcategory row.

    Either pass a `sub` (an ActivitySubcategory instance) OR `org_id` +
    `team_id` (for new-row checks before insertion).

    Rules:
      - super_admin: can manage anything (including global subs).
      - admin (org_admin): can manage anything in their org. Cannot
        manage global subs.
      - team_admin: can manage only subs scoped to teams they LEAD.
        Cannot create org-scoped or global subs.
      - others (user / validator): no management.
    """
    if sub is not None:
        org_id = sub.org_id
        team_id = sub.team_id

    role = getattr(user, "role", None)
    if role == "super_admin":
        return True
    if role == "admin":
        # Org admin: must scope to their own org; cannot touch global.
        return org_id is not None and org_id == getattr(user, "org_id", None)
    if role == "team_admin":
        # Team admin: must be a team-scoped sub for a team they lead,
        # in their own org.
        if org_id is None or org_id != getattr(user, "org_id", None):
            return False
        if team_id is None:
            return False
        return team_id in _team_admin_led_team_ids(user)
    return False


def _resolve_subcategory_for_write(
    user, activity, subcategory_id, retained_participants, new_participants,
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
        sub_row = _visible_subcategories_query(user).filter(
            ActivitySubcategory.id == sub_id_int,
            ActivitySubcategory.activity == activity,
        ).first()
        if sub_row is None:
            raise ValueError(
                "Selected subcategory is not available for this activity"
            )

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
        elif path == "admin_add_test_entry":
            return self.admin_add_test_entry()
        elif path == "purge_all_time_entries":
            return self.purge_all_time_entries()
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
        elif path == "hourly_summary":
            return self.admin_hourly_summary()
        elif path == "set_hourly_rate":
            return self.admin_set_hourly_rate()
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

    # ─── Helpers ───────────────────────────────────────────────

    USER_NOTES_MAX_LEN = 500

    # Self-service "discard active record" is allowed within this window
    # only. Past it, users must clock out and request an adjustment so the
    # admin has visibility on retroactive changes.
    DISCARD_WINDOW_SECONDS = 300  # 5 minutes

    @staticmethod
    def _normalize_user_notes(value):
        """Coerce incoming user_notes payload into a clean column value.

        Returns None for missing / empty input so we don't store empty
        strings. Raises ValueError if the trimmed value exceeds the
        500-char limit — caller turns that into a 400 response.
        """
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("user_notes must be a string")
        trimmed = value.strip()
        if not trimmed:
            return None
        if len(trimmed) > TimeTrackingAPI.USER_NOTES_MAX_LEN:
            raise ValueError(
                f"user_notes exceeds {TimeTrackingAPI.USER_NOTES_MAX_LEN}-character limit"
            )
        return trimmed

    @staticmethod
    def _format_entry(entry):
        """Format a TimeEntry for JSON response."""
        user = User.query.get(entry.user_id)
        project = Project.query.get(entry.project_id) if entry.project_id else None

        duration = None
        if entry.duration_seconds is not None:
            hours = entry.duration_seconds // 3600
            minutes = (entry.duration_seconds % 3600) // 60
            seconds = entry.duration_seconds % 60
            duration = f"{hours:02d}:{minutes:02d}:{seconds:02d}"

        return {
            "id": entry.id,
            "userId": entry.user_id,
            "userName": user.full_name if user else "Unknown",
            "firstName": (user.first_name or "") if user else "",
            "lastName": (user.last_name or "") if user else "",
            "projectId": entry.project_id,
            "projectName": project.name if project else "No Project",
            "projectShortName": (project.short_name or "") if project else "",
            # The "category" JSON key is preserved for frontend backward
            # compat; it reads from entry.activity now (DB column was
            # renamed in migration c4f8a9b0d1e2). Display label still
            # comes from ACTIVITY_DISPLAY_MAP.
            "category": ACTIVITY_DISPLAY_MAP.get(entry.activity, entry.activity.capitalize() if entry.activity else ""),
            "activity": entry.activity,  # raw slug (new — preferred for filters)
            "subcategoryId": entry.subcategory_id,
            "subcategoryName": entry.subcategory_name,
            "retainedParticipants": entry.retained_participants,
            "newParticipants": entry.new_participants,
            "taskName": entry.task_name,
            "taskRefType": entry.task_ref_type,
            "taskRefId": entry.task_ref_id,
            "clockIn": entry.clock_in.isoformat() + "Z" if entry.clock_in else None,
            "clockOut": entry.clock_out.isoformat() + "Z" if entry.clock_out else None,
            "duration": duration,
            "durationSeconds": entry.duration_seconds,
            "status": entry.status,
            "changesetCount": entry.changeset_count or 0,
            "changesCount": entry.changes_count or 0,
            "notes": entry.notes,
            "userNotes": entry.user_notes,
            "voidedBy": entry.voided_by,
            "voidedAt": entry.voided_at.isoformat() + "Z" if entry.voided_at else None,
            "editedBy": entry.edited_by,
            "editedAt": entry.edited_at.isoformat() + "Z" if entry.edited_at else None,
            "forceClockedOutBy": entry.force_clocked_out_by,
        }

    @staticmethod
    def _fetch_osm_changesets(osm_username, clock_in_time):
        """
        Fetch OSM changesets for a user since clock_in_time.

        Returns (changeset_count, changes_count) tuple.
        Best-effort: returns (0, 0) on any failure.
        """
        if not osm_username:
            return 0, 0

        time_str = clock_in_time.strftime("%Y-%m-%dT%H:%M:%SZ")
        url = (
            f"https://api.openstreetmap.org/api/0.6/changesets.json"
            f"?display_name={osm_username}&time={time_str}"
        )

        for attempt in range(3):
            try:
                resp = http_requests.get(url, timeout=30)
                if resp.status_code == 429:
                    import time
                    time.sleep(2 ** attempt)
                    continue
                resp.raise_for_status()
                data = resp.json()
                changesets = data.get("changesets", [])
                changeset_count = len(changesets)
                changes_count = sum(
                    cs.get("changes_count", 0) for cs in changesets
                )
                return changeset_count, changes_count
            except Exception as e:
                logger.warning(
                    f"OSM changeset fetch attempt {attempt + 1} failed for "
                    f"{osm_username}: {e}"
                )
                if attempt < 2:
                    import time
                    time.sleep(2 ** attempt)

        logger.error(f"OSM changeset fetch failed after 3 attempts for {osm_username}")
        return 0, 0

    # _parse_date: thin wrapper around the shared parser so existing in-file
    # callers keep working. New code should use parse_filter_datetime directly.
    _parse_date = staticmethod(parse_filter_datetime)

    @staticmethod
    def _apply_team_admin_scope(query, viewer, team_id_in_request=None):
        """Force a TimeEntry query to managed-team members for team_admin.

        Returns the (possibly empty-result) query. Org Admin / super_admin
        get the query untouched. If a team_admin sends a `teamId` outside
        their managed set, we silently drop it back to the union of their
        managed teams — same effect as if they never sent the param.
        """
        if viewer is None or getattr(viewer, "role", None) != "team_admin":
            return query

        managed = managed_team_ids_for(viewer)
        if not managed:
            # Zero-team team_admin → empty result
            return query.filter(TimeEntry.user_id == None)  # noqa: E711

        if team_id_in_request and team_id_in_request not in managed:
            # Requested team is outside their managed set — refuse the team
            # narrow and fall back to the union of managed teams.
            team_id_in_request = None

        if team_id_in_request:
            member_ids = [
                tu.user_id
                for tu in TeamUser.query.filter_by(team_id=team_id_in_request).all()
            ]
        else:
            member_ids = list(team_member_ids_for(managed))

        if not member_ids:
            return query.filter(TimeEntry.user_id == None)  # noqa: E711
        return query.filter(TimeEntry.user_id.in_(member_ids))

    @staticmethod
    def _build_filtered_query(org_id, data, restrict_user_id=None):
        """
        Build a filtered TimeEntry query from request data.

        Args:
            org_id: Organization ID to scope entries
            data: Request JSON dict with optional filter params
            restrict_user_id: If set, always filter to this user only

        Returns:
            SQLAlchemy query object (not yet executed)
        """
        conditions = [
            TimeEntry.org_id == org_id,
            TimeEntry.status.in_(["completed", "voided"]),
        ]

        # Always restrict to a single user if specified
        if restrict_user_id:
            conditions.append(TimeEntry.user_id == restrict_user_id)
        else:
            # Admin-level filters
            filters = data.get("filters")
            user_id = data.get("userId")
            team_id = data.get("teamId")

            if filters:
                filtered_ids = resolve_filtered_user_ids(filters, org_id)
                if filtered_ids is not None:
                    conditions.append(TimeEntry.user_id.in_(filtered_ids))
            elif user_id:
                conditions.append(TimeEntry.user_id == user_id)
            elif team_id:
                member_ids = [
                    tu.user_id
                    for tu in TeamUser.query.filter_by(team_id=team_id).all()
                ]
                if member_ids:
                    conditions.append(TimeEntry.user_id.in_(member_ids))
                else:
                    # Team has no members — return empty result
                    conditions.append(TimeEntry.user_id == None)  # noqa: E711

        # Date filters. Frontend usually sends ISO UTC instants aligned to
        # the user's local midnights — in that case we use the explicit
        # instant as-is. Legacy date-only strings ("2026-04-23") still work
        # and get the add-a-day upper bound for back-compat.
        start_date, _ = TimeTrackingAPI._parse_date(data.get("startDate"))
        end_date, end_was_date_only = TimeTrackingAPI._parse_date(data.get("endDate"))
        if start_date:
            conditions.append(TimeEntry.clock_in >= start_date)
        if end_date:
            if end_was_date_only:
                end_date = end_date + timedelta(days=1)
            conditions.append(TimeEntry.clock_in < end_date)

        # Activity filter (JSON key still "category" for frontend back-compat).
        category = data.get("category") or data.get("activity")
        if category:
            conditions.append(TimeEntry.activity == category.lower())

        # Subcategory filter — matches the snapshot name on the entry.
        # Frontend sends the display name (e.g. "Kaart Project") as-is.
        subcategory_name = data.get("subcategoryName")
        if subcategory_name:
            conditions.append(TimeEntry.subcategory_name == subcategory_name)

        return TimeEntry.query.filter(*conditions).order_by(TimeEntry.clock_in.desc())

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
            return jsonify({
                "message": f"Invalid category. Must be one of: {', '.join(ACTIVITY_SLUGS)}",
                "status": 400,
            }), 400

        # Validate subcategory (tier 2) + event fields through the SSOT helper.
        try:
            sub_fields = _resolve_subcategory_for_write(
                g.user,
                activity,
                data.get("subcategoryId"),
                data.get("retainedParticipants"),
                data.get("newParticipants"),
            )
        except ValueError as e:
            return jsonify({"message": str(e), "status": 400}), 400

        # requires_project gating: if the chosen sub demands a project and the
        # caller didn't provide one, reject up-front.
        if sub_fields["subcategory_id"] is not None:
            sub_row = ActivitySubcategory.query.get(sub_fields["subcategory_id"])
            if sub_row and sub_row.requires_project and not project_id:
                return jsonify({
                    "message": (
                        f"Subcategory '{sub_row.name}' requires a project — "
                        f"please pick a project before clocking in."
                    ),
                    "status": 400,
                }), 400

        # Validate project if provided
        if project_id:
            project = Project.query.get(project_id)
            if not project:
                return jsonify({
                    "message": "Project not found",
                    "status": 404,
                }), 404

        try:
            user_notes = self._normalize_user_notes(data.get("userNotes"))
        except ValueError as e:
            return jsonify({"message": str(e), "status": 400}), 400

        # Check for existing active session
        active = TimeEntry.query.filter_by(
            user_id=g.user.id, status="active"
        ).first()
        if active:
            logger.info(
                f"[CLOCK] clock_in REJECTED — user={g.user.id} already has active session "
                f"id={active.id} clock_in={active.clock_in}"
            )
            return jsonify({
                "message": "You already have an active session. Clock out first.",
                "status": 409,
            }), 409

        # Create new time entry
        entry = TimeEntry()
        entry.user_id = g.user.id
        entry.project_id = project_id
        entry.org_id = g.user.org_id
        entry.activity = activity
        entry.subcategory_id = sub_fields["subcategory_id"]
        entry.subcategory_name = sub_fields["subcategory_name"]
        entry.retained_participants = sub_fields["retained_participants"]
        entry.new_participants = sub_fields["new_participants"]
        entry.task_name = data.get("task_name")
        entry.task_ref_type = data.get("task_ref_type")
        entry.task_ref_id = data.get("task_ref_id")
        entry.clock_in = datetime.utcnow()
        entry.status = "active"
        entry.user_notes = user_notes
        entry.save()

        # Legacy: "other" with a free-form task_name upserts into custom_topics.
        # Going forward, free-form names should be added as ActivitySubcategory
        # rows via the Time Categories admin page — but we still upsert here so
        # older clients that haven't migrated keep working.
        if activity == "other" and entry.task_name and sub_fields["subcategory_id"] is None:
            existing = CustomTopic.query.filter_by(
                name=entry.task_name, org_id=g.user.org_id
            ).first()
            if not existing:
                topic = CustomTopic()
                topic.name = entry.task_name
                topic.org_id = g.user.org_id
                topic.created_by = g.user.id
                topic.save()

        logger.info(
            f"[CLOCK] clock_in SUCCESS — user={g.user.id} session_id={entry.id} "
            f"clock_in={entry.clock_in} project={project_id} activity={activity} "
            f"subcategory_id={entry.subcategory_id}"
        )

        session_data = self._format_entry(entry)
        session_data["elapsedSeconds"] = 0  # Just clocked in

        return jsonify({
            "message": "Clocked in successfully",
            "status": 200,
            "session_id": entry.id,
            "session": session_data,
        }), 200

    def clock_out(self):
        """Clock out the current user."""
        if not hasattr(g, "user") or not g.user:
            return jsonify({"message": "Unauthorized", "status": 401}), 401

        data = request.get_json() or {}
        session_id = data.get("session_id")

        logger.info(
            f"[CLOCK] clock_out called by user={g.user.id} "
            f"({g.user.osm_username or g.user.email}) session_id={session_id}"
        )

        # Find active session
        if session_id:
            entry = TimeEntry.query.filter_by(
                id=session_id, user_id=g.user.id, status="active"
            ).first()
        else:
            entry = TimeEntry.query.filter_by(
                user_id=g.user.id, status="active"
            ).first()

        if not entry:
            logger.warning(
                f"[CLOCK] clock_out FAILED — no active session found for user={g.user.id} "
                f"session_id_requested={session_id}"
            )
            return jsonify({
                "message": "No active session found",
                "status": 404,
            }), 404

        # Optional notes update at clock-out. If the key is absent we leave
        # whatever the user typed during the session intact; if present we
        # apply the same normalize/validate path as elsewhere.
        if "userNotes" in data:
            try:
                entry.user_notes = self._normalize_user_notes(data.get("userNotes"))
            except ValueError as e:
                return jsonify({"message": str(e), "status": 400}), 400

        logger.info(
            f"[CLOCK] clock_out PROCESSING — user={g.user.id} session_id={entry.id} "
            f"clock_in={entry.clock_in} project={entry.project_id} activity={entry.activity}"
        )

        # Clock out
        now = datetime.utcnow()
        entry.clock_out = now
        entry.duration_seconds = int((now - entry.clock_in).total_seconds())
        entry.status = "completed"

        # Fetch OSM changesets (best-effort)
        osm_username = getattr(g.user, "osm_username", None)
        if osm_username:
            changeset_count, changes_count = self._fetch_osm_changesets(
                osm_username, entry.clock_in
            )
            entry.changeset_count = changeset_count
            entry.changes_count = changes_count

        entry.save()

        logger.info(
            f"[CLOCK] clock_out SUCCESS — user={g.user.id} session_id={entry.id} "
            f"duration={entry.duration_seconds}s changesets={entry.changeset_count} "
            f"changes={entry.changes_count}"
        )

        return jsonify({
            "message": "Clocked out successfully",
            "status": 200,
            "duration_seconds": entry.duration_seconds,
            "session": self._format_entry(entry),
        }), 200

    def my_active_session(self):
        """Get the current user's active session."""
        if not hasattr(g, "user") or not g.user:
            return jsonify({"message": "Unauthorized", "status": 401}), 401

        entry = TimeEntry.query.filter_by(
            user_id=g.user.id, status="active"
        ).first()

        if entry:
            logger.debug(
                f"[CLOCK] active_session CHECK — user={g.user.id} "
                f"found session_id={entry.id} clock_in={entry.clock_in}"
            )
        else:
            logger.debug(
                f"[CLOCK] active_session CHECK — user={g.user.id} NO active session"
            )

        session_data = self._format_entry(entry) if entry else None

        # Include server-computed elapsed seconds so the frontend never
        # compares server timestamps against the client clock.
        if entry and entry.clock_in:
            elapsed = int((datetime.utcnow() - entry.clock_in).total_seconds())
            session_data["elapsedSeconds"] = max(0, elapsed)

        return jsonify({
            "status": 200,
            "session": session_data,
        }), 200

    def my_history(self):
        """Get the current user's time entry history with optional filters."""
        if not hasattr(g, "user") or not g.user:
            return jsonify({"message": "Unauthorized", "status": 401}), 401

        data = request.get_json() or {}
        limit = data.get("limit", 500)
        offset = data.get("offset", 0)

        query = self._build_filtered_query(
            g.user.org_id, data, restrict_user_id=g.user.id
        )

        total = query.count()
        entries = query.limit(limit).offset(offset).all()

        return jsonify({
            "status": 200,
            "entries": [self._format_entry(e) for e in entries],
            "total": total,
        }), 200

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
            return jsonify({
                "message": "startDate and endDate are required (ISO 8601).",
                "status": 400,
            }), 400
        if end_was_date_only:
            end_dt = end_dt + timedelta(days=1)

        user = g.user

        # Hours: sum of completed time entries in the window
        total_seconds = db.session.query(
            func.coalesce(func.sum(TimeEntry.duration_seconds), 0)
        ).filter(
            TimeEntry.user_id == user.id,
            TimeEntry.status == "completed",
            TimeEntry.clock_in >= start_dt,
            TimeEntry.clock_in < end_dt,
        ).scalar() or 0
        total_hours = round(total_seconds / 3600, 2)

        # Tasks mapped/validated by this user in the window. Tasks track
        # the actor by osm_username (not user_id), so users without one
        # linked just get zero — honest.
        tasks_mapped = 0
        tasks_validated = 0
        mapping_earnings = 0.0
        validation_earnings = 0.0
        if user.osm_username:
            mapped_row = db.session.query(
                func.count(Task.id),
                func.coalesce(func.sum(Task.mapping_rate), 0),
            ).filter(
                Task.mapped_by == user.osm_username,
                Task.mapped == True,  # noqa: E712
                Task.date_mapped >= start_dt,
                Task.date_mapped < end_dt,
            ).first()
            tasks_mapped = int(mapped_row[0] or 0)
            mapping_earnings = float(mapped_row[1] or 0)

            validated_row = db.session.query(
                func.count(Task.id),
                func.coalesce(func.sum(Task.validation_rate), 0),
            ).filter(
                Task.validated_by == user.osm_username,
                Task.validated == True,  # noqa: E712
                Task.date_validated >= start_dt,
                Task.date_validated < end_dt,
            ).first()
            tasks_validated = int(validated_row[0] or 0)
            validation_earnings = float(validated_row[1] or 0)

        # "Amount owed" = the relevant earnings for this user's pay model.
        # Hourly contractors → hours × rate. Per-task mappers → sum of
        # task rates. If neither applies → zero, with pay_mode="none".
        hourly_rate = user.hourly_rate
        hourly_earnings = (
            round(total_hours * hourly_rate, 2) if hourly_rate else None
        )
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

        return jsonify({
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
        }), 200

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
                tu.user_id
                for tu in TeamUser.query.filter_by(team_id=team_id).all()
            ]
            if member_ids:
                query = query.filter(TimeEntry.user_id.in_(member_ids))
            else:
                query = query.filter(TimeEntry.user_id == None)  # noqa: E711

        # team_admin: force-narrow to managed teams
        query = self._apply_team_admin_scope(query, g.user, team_id)

        entries = query.order_by(TimeEntry.clock_in.desc()).limit(100).all()

        return jsonify({
            "status": 200,
            "entries": [self._format_entry(e) for e in entries],
        }), 200

    def request_adjustment(self):
        """Request an adjustment to a time entry."""
        if not hasattr(g, "user") or not g.user:
            return jsonify({"message": "Unauthorized", "status": 401}), 401

        data = request.get_json() or {}
        entry_id = data.get("entry_id")
        reason = data.get("reason", "").strip()

        if not entry_id:
            return jsonify({
                "message": "entry_id is required",
                "status": 400,
            }), 400

        if not reason:
            return jsonify({
                "message": "reason is required",
                "status": 400,
            }), 400

        entry = TimeEntry.query.filter_by(
            id=entry_id, user_id=g.user.id
        ).first()

        if not entry:
            return jsonify({
                "message": "Entry not found",
                "status": 404,
            }), 404

        if entry.status == "voided":
            return jsonify({
                "message": "Cannot request adjustment for a voided entry",
                "status": 400,
            }), 400

        entry.notes = f"[ADJUSTMENT REQUESTED] {reason}"
        entry.save()

        return jsonify({
            "message": "Adjustment request submitted",
            "status": 200,
        }), 200

    def discard_active(self):
        """Hard-delete the user's active session if it's still inside the
        DISCARD_WINDOW. Past the window the request is rejected and the
        user is pointed at the Request Adjustment flow.
        """
        if not hasattr(g, "user") or not g.user:
            return jsonify({"message": "Unauthorized", "status": 401}), 401

        data = request.get_json() or {}
        session_id = data.get("session_id")

        if session_id:
            entry = TimeEntry.query.filter_by(
                id=session_id, user_id=g.user.id, status="active"
            ).first()
        else:
            entry = TimeEntry.query.filter_by(
                user_id=g.user.id, status="active"
            ).first()

        if not entry:
            return jsonify({
                "message": "No active session to discard",
                "status": 404,
            }), 404

        elapsed = int((datetime.utcnow() - entry.clock_in).total_seconds())
        if elapsed > self.DISCARD_WINDOW_SECONDS:
            return jsonify({
                "message": (
                    f"Cannot discard — this session is "
                    f"{elapsed // 60}m {elapsed % 60}s old. Discard is "
                    f"only allowed within the first "
                    f"{self.DISCARD_WINDOW_SECONDS // 60} minutes. "
                    f"Clock out and use Request Adjustment instead."
                ),
                "status": 400,
                "elapsed_seconds": elapsed,
                "max_seconds": self.DISCARD_WINDOW_SECONDS,
            }), 400

        logger.info(
            f"[CLOCK] discard_active by user={g.user.id} "
            f"({g.user.osm_username or g.user.email}) "
            f"session_id={entry.id} elapsed={elapsed}s"
        )

        db.session.delete(entry)
        db.session.commit()

        return jsonify({
            "message": "Active session discarded",
            "status": 200,
        }), 200

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
            return jsonify({
                "message": "entry_id is required",
                "status": 400,
            }), 400

        try:
            user_notes = self._normalize_user_notes(data.get("userNotes"))
        except ValueError as e:
            return jsonify({"message": str(e), "status": 400}), 400

        entry = TimeEntry.query.filter_by(
            id=entry_id, user_id=g.user.id
        ).first()

        if not entry:
            return jsonify({
                "message": "Entry not found",
                "status": 404,
            }), 404

        entry.user_notes = user_notes
        entry.save()

        return jsonify({
            "status": 200,
            "session": self._format_entry(entry),
        }), 200

    def fetch_custom_topics(self):
        """Fetch all custom topics for the user's org."""
        if not hasattr(g, "user") or not g.user:
            return jsonify({"message": "Unauthorized", "status": 401}), 401

        topics = (
            CustomTopic.query
            .filter_by(org_id=g.user.org_id)
            .order_by(CustomTopic.name)
            .all()
        )

        return jsonify({
            "status": 200,
            "topics": [
                {
                    "id": t.id,
                    "name": t.name,
                    "createdBy": t.created_by,
                }
                for t in topics
            ],
        }), 200

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

        query = TimeEntry.query.filter_by(
            org_id=g.user.org_id, status="active"
        )

        if team_id:
            member_ids = [
                tu.user_id
                for tu in TeamUser.query.filter_by(team_id=team_id).all()
            ]
            if member_ids:
                query = query.filter(TimeEntry.user_id.in_(member_ids))
            else:
                # Team has no members — return empty rather than the whole org.
                query = query.filter(TimeEntry.user_id == None)  # noqa: E711

        # team_admin: force-narrow to managed teams
        query = self._apply_team_admin_scope(query, g.user, team_id)

        entries = query.order_by(TimeEntry.clock_in.asc()).all()

        return jsonify({
            "status": 200,
            "sessions": [self._format_entry(e) for e in entries],
        }), 200

    @requires_team_admin_or_above
    def admin_history(self):
        """Get time entry history for the admin's org with optional filters."""
        data = request.get_json() or {}
        limit = data.get("limit", 500)
        offset = data.get("offset", 0)

        query = self._build_filtered_query(g.user.org_id, data)

        # team_admin: force-narrow to managed teams (overrides whatever
        # teamId/userId filter the request specified)
        query = self._apply_team_admin_scope(query, g.user, data.get("teamId"))

        total = query.count()
        entries = query.limit(limit).offset(offset).all()

        return jsonify({
            "status": 200,
            "entries": [self._format_entry(e) for e in entries],
            "total": total,
        }), 200

    @requires_team_admin_or_above
    def admin_force_clock_out(self):
        """Force clock out a user's session."""
        data = request.get_json() or {}
        session_id = data.get("session_id")

        if not session_id:
            return jsonify({
                "message": "session_id is required",
                "status": 400,
            }), 400

        entry = TimeEntry.query.filter_by(
            id=session_id, org_id=g.user.org_id, status="active"
        ).first()

        if not entry:
            return jsonify({
                "message": "Active session not found",
                "status": 404,
            }), 404

        # team_admin: target user must be on a managed team
        if not is_org_admin_or_above(g.user):
            if not team_admin_can_access_user(g.user, entry.user_id):
                return jsonify({
                    "message": "Not in your managed teams",
                    "status": 403,
                }), 403

        logger.warning(
            f"[CLOCK] FORCE clock_out — admin={g.user.id} ({g.user.osm_username or g.user.email}) "
            f"forcing clock_out on session_id={entry.id} owned by user={entry.user_id} "
            f"clock_in={entry.clock_in}"
        )

        now = datetime.utcnow()
        entry.clock_out = now
        entry.duration_seconds = int((now - entry.clock_in).total_seconds())
        entry.status = "completed"
        entry.force_clocked_out_by = g.user.id

        # Fetch OSM changesets (best-effort)
        user = User.query.get(entry.user_id)
        if user and user.osm_username:
            changeset_count, changes_count = self._fetch_osm_changesets(
                user.osm_username, entry.clock_in
            )
            entry.changeset_count = changeset_count
            entry.changes_count = changes_count

        entry.save()

        return jsonify({
            "message": "Force clock out successful",
            "status": 200,
            "session": self._format_entry(entry),
        }), 200

    @requires_team_admin_or_above
    def admin_void_entry(self):
        """Void a time entry."""
        data = request.get_json() or {}
        entry_id = data.get("entry_id")

        if not entry_id:
            return jsonify({
                "message": "entry_id is required",
                "status": 400,
            }), 400

        entry = TimeEntry.query.filter_by(
            id=entry_id, org_id=g.user.org_id
        ).first()

        if not entry:
            return jsonify({
                "message": "Entry not found",
                "status": 404,
            }), 404

        # team_admin: target user must be on a managed team
        if not is_org_admin_or_above(g.user):
            if not team_admin_can_access_user(g.user, entry.user_id):
                return jsonify({
                    "message": "Not in your managed teams",
                    "status": 403,
                }), 403

        if entry.status == "voided":
            return jsonify({
                "message": "Entry is already voided",
                "status": 400,
            }), 400

        logger.warning(
            f"[CLOCK] VOID entry — admin={g.user.id} voiding entry_id={entry.id} "
            f"owned by user={entry.user_id} status_was={entry.status}"
        )
        entry.status = "voided"
        entry.voided_by = g.user.id
        entry.voided_at = datetime.utcnow()
        entry.save()

        return jsonify({
            "message": "Entry voided",
            "status": 200,
            "entry": self._format_entry(entry),
        }), 200

    @requires_team_admin_or_above
    def admin_edit_entry(self):
        """Edit a time entry's times or category."""
        data = request.get_json() or {}
        entry_id = data.get("entry_id")

        if not entry_id:
            return jsonify({
                "message": "entry_id is required",
                "status": 400,
            }), 400

        entry = TimeEntry.query.filter_by(
            id=entry_id, org_id=g.user.org_id
        ).first()

        if not entry:
            return jsonify({
                "message": "Entry not found",
                "status": 404,
            }), 404

        # team_admin: target user must be on a managed team
        if not is_org_admin_or_above(g.user):
            if not team_admin_can_access_user(g.user, entry.user_id):
                return jsonify({
                    "message": "Not in your managed teams",
                    "status": 403,
                }), 403

        # Parse optional fields
        if "clockIn" in data:
            try:
                entry.clock_in = datetime.fromisoformat(
                    data["clockIn"].replace("Z", "+00:00")
                ).replace(tzinfo=None)
            except (ValueError, AttributeError):
                return jsonify({
                    "message": "Invalid clockIn format. Use ISO 8601.",
                    "status": 400,
                }), 400

        if "clockOut" in data:
            try:
                entry.clock_out = datetime.fromisoformat(
                    data["clockOut"].replace("Z", "+00:00")
                ).replace(tzinfo=None)
            except (ValueError, AttributeError):
                return jsonify({
                    "message": "Invalid clockOut format. Use ISO 8601.",
                    "status": 400,
                }), 400

        if "category" in data:
            cat = data["category"].lower()
            if cat not in ACTIVITY_SLUGS:
                return jsonify({
                    "message": f"Invalid category. Must be one of: {', '.join(ACTIVITY_SLUGS)}",
                    "status": 400,
                }), 400
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
        if (
            "subcategoryId" in data
            or "retainedParticipants" in data
            or "newParticipants" in data
        ):
            try:
                sub_fields = _resolve_subcategory_for_write(
                    # Subcategory visibility check uses the entry's owner, not
                    # the editing admin — a team_admin editing entries for
                    # a member should be able to pick subs that member sees.
                    User.query.get(entry.user_id) or g.user,
                    entry.activity,
                    data.get("subcategoryId") if "subcategoryId" in data else entry.subcategory_id,
                    data.get("retainedParticipants") if "retainedParticipants" in data else entry.retained_participants,
                    data.get("newParticipants") if "newParticipants" in data else entry.new_participants,
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
            entry.notes = entry.notes.replace(
                "[ADJUSTMENT REQUESTED]", "[ADJUSTED]", 1
            )

        entry.edited_by = g.user.id
        entry.edited_at = datetime.utcnow()
        entry.save()

        return jsonify({
            "message": "Entry updated",
            "status": 200,
            "entry": self._format_entry(entry),
        }), 200

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
            return jsonify({
                "message": "userId, clockIn, clockOut, and category are required",
                "status": 400,
            }), 400

        if category not in ACTIVITY_SLUGS:
            return jsonify({
                "message": f"Invalid category. Must be one of: {', '.join(ACTIVITY_SLUGS)}",
                "status": 400,
            }), 400

        # Validate user exists in same org
        user = User.query.get(user_id)
        if not user or user.org_id != g.user.org_id:
            return jsonify({
                "message": "User not found in your organization",
                "status": 404,
            }), 404

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
                return jsonify({
                    "message": "Not in your managed teams",
                    "status": 403,
                }), 403

        # Parse times
        try:
            clock_in = datetime.fromisoformat(
                clock_in_str.replace("Z", "+00:00")
            ).replace(tzinfo=None)
        except (ValueError, AttributeError):
            return jsonify({
                "message": "Invalid clockIn format. Use ISO 8601.",
                "status": 400,
            }), 400

        try:
            clock_out = datetime.fromisoformat(
                clock_out_str.replace("Z", "+00:00")
            ).replace(tzinfo=None)
        except (ValueError, AttributeError):
            return jsonify({
                "message": "Invalid clockOut format. Use ISO 8601.",
                "status": 400,
            }), 400

        if clock_out <= clock_in:
            return jsonify({
                "message": "Clock out must be after clock in",
                "status": 400,
            }), 400

        # Validate project if provided
        if project_id:
            project = Project.query.get(project_id)
            if not project:
                return jsonify({
                    "message": "Project not found",
                    "status": 404,
                }), 404

        entry = TimeEntry()
        entry.user_id = user_id
        entry.org_id = g.user.org_id
        entry.project_id = project_id
        entry.activity = category
        entry.subcategory_id = sub_fields["subcategory_id"]
        entry.subcategory_name = sub_fields["subcategory_name"]
        entry.retained_participants = sub_fields["retained_participants"]
        entry.new_participants = sub_fields["new_participants"]
        entry.task_name = data.get("taskName")
        entry.task_ref_type = data.get("taskRefType")
        entry.task_ref_id = data.get("taskRefId")
        entry.clock_in = clock_in
        entry.clock_out = clock_out
        entry.duration_seconds = int((clock_out - clock_in).total_seconds())
        entry.status = "completed"
        entry.notes = f"[ADMIN CREATED] {notes}".strip()
        entry.edited_by = g.user.id
        entry.edited_at = datetime.utcnow()
        entry.save()

        # Legacy custom_topics upsert — same gating as clock_in: only
        # when no real subcategory was selected.
        if category == "other" and entry.task_name and sub_fields["subcategory_id"] is None:
            existing = CustomTopic.query.filter_by(
                name=entry.task_name, org_id=g.user.org_id
            ).first()
            if not existing:
                topic = CustomTopic()
                topic.name = entry.task_name
                topic.org_id = g.user.org_id
                topic.created_by = g.user.id
                topic.save()

        return jsonify({
            "message": "Entry created",
            "status": 200,
            "entry": self._format_entry(entry),
        }), 200

    @requires_admin
    def admin_add_test_entry(self):
        """Create an 8-hour test entry for a user (dev tool)."""
        data = request.get_json() or {}
        user_id = data.get("userId")
        project_id = data.get("projectId")
        category = (data.get("category") or "mapping").lower()

        if not user_id:
            return jsonify({
                "message": "userId is required",
                "status": 400,
            }), 400

        if category not in ACTIVITY_SLUGS:
            category = "mapping"

        # Validate user exists in same org
        user = User.query.get(user_id)
        if not user or user.org_id != g.user.org_id:
            return jsonify({
                "message": "User not found in your organization",
                "status": 404,
            }), 404

        now = datetime.utcnow()
        entry = TimeEntry()
        entry.user_id = user_id
        entry.org_id = g.user.org_id
        entry.project_id = project_id
        entry.activity = category
        entry.clock_in = now - timedelta(hours=8)
        entry.clock_out = now
        entry.duration_seconds = 28800
        entry.status = "completed"
        entry.notes = "[DEV TEST ENTRY]"
        entry.edited_by = g.user.id
        entry.edited_at = now
        entry.save()

        return jsonify({
            "message": "Test entry created",
            "status": 200,
            "entry": self._format_entry(entry),
        }), 200

    @requires_team_admin_or_above
    def admin_export(self):
        """Export time entries as CSV, JSON, or PDF with the same filters as history."""
        data = request.get_json() or {}
        export_format = (data.get("format") or "csv").lower()

        if export_format not in ("csv", "json", "pdf"):
            return jsonify({
                "message": "Invalid format. Must be csv, json, or pdf.",
                "status": 400,
            }), 400

        omit_columns = data.get("omit_columns") or []
        if not isinstance(omit_columns, list):
            omit_columns = []

        # Build filtered query (no limit/offset for export — get all matching)
        query = self._build_filtered_query(g.user.org_id, data)

        # team_admin: force-narrow to managed teams
        query = self._apply_team_admin_scope(query, g.user, data.get("teamId"))

        entries = query.all()

        today_str = datetime.utcnow().strftime("%Y-%m-%d")

        if export_format == "csv":
            return self._export_csv(entries, today_str, omit_columns=omit_columns)
        elif export_format == "json":
            return self._export_json(entries, today_str)
        elif export_format == "pdf":
            return self._export_pdf(entries, data, today_str, omit_columns=omit_columns)

    @staticmethod
    def _format_duration_hours(duration_seconds):
        """Format duration in seconds to a human-readable hours string."""
        if duration_seconds is None:
            return ""
        hours = duration_seconds / 3600
        return f"{hours:.2f}"

    def _export_columns(self):
        """Single source of truth for export column order, labels, and value
        extractors. Each entry: (key, label, value_fn(user, project, entry)).

        Both CSV and PDF iterate this list; `omit_columns` filters by `key`.
        """
        return [
            ("user_name",     "User",             lambda u, p, e: u.full_name if u else "Unknown"),
            ("osm_username",  "OSM Username",     lambda u, p, e: (u.osm_username if u else "") or ""),
            ("project",       "Project",          lambda u, p, e: (p.name if p else "") or ""),
            ("category",      "Category",         lambda u, p, e: ACTIVITY_DISPLAY_MAP.get(e.activity, e.activity.capitalize() if e.activity else "")),
            ("subcategory",   "Subcategory",      lambda u, p, e: e.subcategory_name or ""),
            ("task",          "Task",             lambda u, p, e: e.task_name or ""),
            ("clock_in",      "Clock In",         lambda u, p, e: e.clock_in.isoformat() + "Z" if e.clock_in else ""),
            ("clock_out",     "Clock Out",        lambda u, p, e: e.clock_out.isoformat() + "Z" if e.clock_out else ""),
            ("duration_hours","Duration (hours)", lambda u, p, e: self._format_duration_hours(e.duration_seconds)),
            ("status",        "Status",           lambda u, p, e: e.status or ""),
            ("changesets",    "Changesets",       lambda u, p, e: e.changeset_count or 0),
            ("changes",       "Changes",          lambda u, p, e: e.changes_count or 0),
            ("notes",         "Notes",            lambda u, p, e: e.notes or ""),
            ("user_notes",    "User Notes",       lambda u, p, e: e.user_notes or ""),
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
        formatted = [self._format_entry(e) for e in entries]
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
        try:
            from reportlab.lib.pagesizes import letter, landscape
            from reportlab.lib import colors
            from reportlab.platypus import (
                SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer,
            )
            from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
            from reportlab.lib.units import inch
        except ImportError:
            return jsonify({
                "message": "PDF export requires the reportlab library. Install with: pip install reportlab",
                "status": 500,
            }), 500

        from xml.sax.saxutils import escape as xml_escape

        buffer = io.BytesIO()
        doc = SimpleDocTemplate(
            buffer, pagesize=landscape(letter),
            leftMargin=0.5 * inch, rightMargin=0.5 * inch,
            topMargin=0.5 * inch, bottomMargin=0.5 * inch,
        )
        styles = getSampleStyleSheet()
        cell_style = ParagraphStyle(
            "Cell", parent=styles["Normal"], fontSize=7, leading=8,
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
            elements.append(Paragraph(
                " | ".join(summary_parts), styles["Normal"]
            ))
        elements.append(Spacer(1, 12))

        # Column subset for PDF: registry minus notes/user_notes (too long)
        # plus any keys explicitly omitted by the caller.
        pdf_skip = set(omit_columns or []) | {"notes", "user_notes"}
        active = [c for c in self._export_columns() if c[0] not in pdf_skip]

        PDF_WIDTHS = {
            "user_name":      1.2 * inch,
            "osm_username":   1.3 * inch,
            "project":        1.4 * inch,
            "category":       0.85 * inch,
            "task":           1.4 * inch,
            "clock_in":       1.05 * inch,
            "clock_out":      1.05 * inch,
            "duration_hours": 0.7 * inch,
            "status":         0.75 * inch,
            "changesets":     0.65 * inch,
            "changes":        0.65 * inch,
        }
        # Cells that may contain long / multi-byte text — wrap in Paragraph.
        PDF_WRAPPED_COLS = {"user_name", "osm_username", "project", "task"}

        # Override clock_in/clock_out value fns so PDF gets the shorter
        # "YYYY-MM-DD HH:MM" string instead of the ISO8601 the registry
        # returns by default (the registry is shared with CSV).
        def pdf_value(key, fn, user, project, entry):
            if key == "clock_in":
                return entry.clock_in.strftime("%Y-%m-%d %H:%M") if entry.clock_in else ""
            if key == "clock_out":
                return entry.clock_out.strftime("%Y-%m-%d %H:%M") if entry.clock_out else ""
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
            "user_name":      "TOTALS",
            "duration_hours": self._format_duration_hours(total_seconds),
            "status":         f"{len(entries)} entries",
            "changesets":     str(total_changesets),
            "changes":        str(total_changes),
        }
        table_data.append([totals_by_key.get(key, "") for key, _, _ in active])

        col_widths = [PDF_WIDTHS.get(key, 1.0 * inch) for key, _, _ in active]
        table = Table(table_data, colWidths=col_widths, repeatRows=1)
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2563eb")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 7),
            ("ALIGN", (0, 0), (-1, -1), "LEFT"),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
            ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, colors.HexColor("#f0f4ff")]),
            ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#e2e8f0")),
            ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]))
        elements.append(table)

        # Footer
        elements.append(Spacer(1, 12))
        elements.append(Paragraph(
            f"Generated: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}",
            styles["Normal"],
        ))

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

    @requires_admin
    def purge_all_time_entries(self):
        """DEV ONLY: Delete all time entries for the admin's org."""
        entries = TimeEntry.query.filter_by(org_id=g.user.org_id).all()
        count = len(entries)
        for entry in entries:
            db.session.delete(entry)
        db.session.commit()

        return jsonify({
            "message": f"Purged {count} time entries",
            "entries_deleted": count,
            "status": 200,
        }), 200

    # ─── Hourly Contractor Payments ──────────────────────────────

    @requires_team_admin_or_above
    def admin_hourly_summary(self):
        """Get monthly hours and payment status for all hourly contractors."""
        data = request.get_json(silent=True) or {}
        year = data.get("year", datetime.now().year)
        org_id = g.user.org_id

        # Get all hourly contractors in org
        contractors = User.query.filter(
            User.org_id == org_id,
            User.hourly_rate.isnot(None),
        ).all()

        # team_admin: narrow to managed-team contractors only
        if g.user.role == "team_admin":
            managed = managed_team_ids_for(g.user)
            if not managed:
                return jsonify({"status": 200, "year": year, "contractors": []})
            member_ids = team_member_ids_for(managed)
            contractors = [c for c in contractors if c.id in member_ids]

        if not contractors:
            return jsonify({"status": 200, "year": year, "contractors": []})

        contractor_ids = [c.id for c in contractors]

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
                    # Unpaid: compute live from time entries + current rate
                    secs = time_lookup.get(c.id, {}).get(m, 0)
                    hrs = round(secs / 3600, 2)
                    rate = c.hourly_rate or 0
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

            result.append({
                "userId": c.id,
                "name": c.full_name,
                "osmUsername": c.osm_username or "",
                "country": c.country or "",
                "hourlyRate": c.hourly_rate,
                "months": months,
                "yearTotal": {
                    "totalSeconds": year_total_seconds,
                    "hours": year_hours,
                    "earnings": round(year_total_earnings, 2),
                },
            })

        return jsonify({"status": 200, "year": year, "contractors": result})

    @requires_admin
    def admin_set_hourly_rate(self):
        """Set or update an hourly rate for a user."""
        data = request.get_json(silent=True) or {}
        user_id = data.get("userId")
        hourly_rate = data.get("hourlyRate")

        if not user_id:
            return jsonify({"message": "userId is required", "status": 400}), 400

        user = User.query.get(user_id)
        if not user or user.org_id != g.user.org_id:
            return jsonify({"message": "User not found", "status": 404}), 404

        # Allow setting to None to remove hourly contractor status
        if hourly_rate is not None:
            try:
                hourly_rate = float(hourly_rate)
            except (ValueError, TypeError):
                return jsonify({"message": "Invalid hourly rate", "status": 400}), 400

        user.hourly_rate = hourly_rate
        db.session.commit()

        action = "removed" if hourly_rate is None else f"set to ${hourly_rate:.2f}"
        return jsonify({
            "status": 200,
            "message": f"Hourly rate {action} for {user.full_name}",
        })

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
            return jsonify({"message": "userId, year, and month are required", "status": 400}), 400

        user = User.query.get(user_id)
        if not user or user.org_id != g.user.org_id:
            return jsonify({"message": "User not found", "status": 404}), 404

        # team_admin: target user must be on a managed team
        if not is_org_admin_or_above(g.user):
            if not team_admin_can_access_user(g.user, user_id):
                return jsonify({"message": "Not in your managed teams", "status": 403}), 403

        org_id = g.user.org_id

        # Find or create the HourlyPayment record
        hp = HourlyPayment.query.filter_by(
            user_id=user_id, year=year, month=month
        ).first()

        if paid:
            # Month window is org-TZ anchored (America/Denver), matching the
            # payroll summary view so snapshots and live totals agree.
            month_start, month_end = org_month_bounds_utc(year, month)

            total_seconds = db.session.query(
                func.coalesce(func.sum(TimeEntry.duration_seconds), 0)
            ).filter(
                TimeEntry.user_id == user_id,
                TimeEntry.org_id == org_id,
                TimeEntry.status == "completed",
                TimeEntry.clock_in >= month_start,
                TimeEntry.clock_in < month_end,
            ).scalar() or 0

            rate = user.hourly_rate or 0
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

        return jsonify({
            "status": 200,
            "message": f"{'Marked' if paid else 'Unmarked'} {user.full_name} {year}-{month:02d} as paid",
        })

    # ─── Subcategory management endpoints ────────────────────────
    #
    # Tier-2 catalog. Visibility rules and management permissions are
    # SSOT'd in the module-level helpers `_visible_subcategories_query`
    # and `_can_manage_subcategory` above — do not reimplement here.

    @staticmethod
    def _format_subcategory(sub):
        """Format an ActivitySubcategory for JSON response."""
        if sub.team_id is not None:
            scope = "team"
        elif sub.org_id is not None:
            scope = "org"
        else:
            scope = "global"
        return {
            "id": sub.id,
            "activity": sub.activity,
            "name": sub.name,
            "slug": sub.slug,
            "scope": scope,
            "orgId": sub.org_id,
            "teamId": sub.team_id,
            "isActive": sub.is_active,
            "sortOrder": sub.sort_order,
            "requiresProject": sub.requires_project,
            "allowEventFields": sub.allow_event_fields,
            "createdBy": sub.created_by,
            "createdAt": sub.created_at.isoformat() + "Z" if sub.created_at else None,
            "updatedAt": sub.updated_at.isoformat() + "Z" if sub.updated_at else None,
        }

    @staticmethod
    def _slugify(name):
        """Lowercase + non-alphanumeric runs collapsed to underscore.

        Matches the SQL slug derivation in the d5a0b1c2e3f4 seed
        migration so subs created at runtime have the same shape as
        seeded ones.
        """
        if not name:
            return ""
        import re
        return re.sub(r"[^a-zA-Z0-9]+", "_", name.strip()).strip("_").lower()

    def subcategories_list(self):
        """List subcategories visible to the caller (clock-in dropdown).

        Body: optional ``activity`` to narrow. Returns sorted list.
        """
        if not hasattr(g, "user") or not g.user:
            return jsonify({"message": "Unauthorized", "status": 401}), 401
        data = request.get_json() or {}
        activity = data.get("activity")
        if activity and activity not in ACTIVITY_SLUGS:
            return jsonify({
                "message": "Invalid activity",
                "status": 400,
            }), 400
        subs = _visible_subcategories_query(g.user, activity=activity).all()
        return jsonify({
            "status": 200,
            "subcategories": [self._format_subcategory(s) for s in subs],
        })

    @requires_team_admin_or_above
    def subcategories_admin_list(self):
        """List subcategories the caller can MANAGE (admin page).

        - super_admin: every sub in the system (incl. global).
        - admin (org_admin): every sub in their org.
        - team_admin: only subs scoped to teams they LEAD (read-only
          access to wider org subs goes through subcategories_list).

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
            if not led:
                return jsonify({"status": 200, "subcategories": []})
            q = q.filter(
                ActivitySubcategory.org_id == g.user.org_id,
                ActivitySubcategory.team_id.in_(list(led)),
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
        return jsonify({
            "status": 200,
            "subcategories": [self._format_subcategory(s) for s in subs],
        })

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
            return jsonify({
                "message": "Name must be 100 characters or fewer",
                "status": 400,
            }), 400
        if scope not in ("global", "org", "team"):
            return jsonify({
                "message": "scope must be one of: global, org, team",
                "status": 400,
            }), 400

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
                return jsonify({
                    "message": "teamId is required for team-scoped subcategories",
                    "status": 400,
                }), 400
            team = Team.query.get(team_id_target)
            if team is None or team.org_id != g.user.org_id:
                return jsonify({"message": "Team not found", "status": 404}), 404
            org_id_target = g.user.org_id

        if not _can_manage_subcategory(
            g.user, org_id=org_id_target, team_id=team_id_target,
        ):
            return jsonify({
                "message": "You don't have permission to create subcategories in that scope",
                "status": 403,
            }), 403

        slug = self._slugify(name)
        if not slug:
            return jsonify({"message": "Name must contain at least one alphanumeric character", "status": 400}), 400

        # Reject duplicate within the (activity, slug, scope) uniqueness.
        dup = ActivitySubcategory.query.filter_by(
            activity=activity, slug=slug,
            org_id=org_id_target, team_id=team_id_target,
        ).first()
        if dup is not None:
            return jsonify({
                "message": "A subcategory with that name already exists in this scope",
                "status": 409,
            }), 409

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

        return jsonify({
            "status": 200,
            "message": "Subcategory created",
            "subcategory": self._format_subcategory(sub),
        })

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
                return jsonify({
                    "message": "Name must be 100 characters or fewer",
                    "status": 400,
                }), 400
            sub.name = new_name
            # slug stays — renames don't break historical snapshots and
            # changing the slug would be confusing in URLs/filters.

        if "isActive" in data:
            sub.is_active = bool(data.get("isActive"))
        if "sortOrder" in data:
            try:
                sub.sort_order = int(data.get("sortOrder"))
            except (TypeError, ValueError):
                return jsonify({"message": "sortOrder must be an integer", "status": 400}), 400
        if "requiresProject" in data:
            sub.requires_project = bool(data.get("requiresProject"))
        if "allowEventFields" in data:
            sub.allow_event_fields = bool(data.get("allowEventFields"))

        sub.save()
        return jsonify({
            "status": 200,
            "message": "Subcategory updated",
            "subcategory": self._format_subcategory(sub),
        })

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
        return jsonify({
            "status": 200,
            "message": "Subcategory disabled",
            "subcategory": self._format_subcategory(sub),
        })
