#!/usr/bin/env python3
import logging
from datetime import datetime

import requests as http_requests

from ..database import TimeEntry, User, Project, TeamUser
from ..auth import managed_team_ids_for, team_member_ids_for

logger = logging.getLogger(__name__)

# Long-session threshold (SSOT). A session running longer than this —
# whether still active or already closed — is flagged as a probable
# forgotten clock-out. Referenced by TimeTracking.admin_long_sessions and
# the effectiveDurationSeconds field below; never hardcode the value
# elsewhere.
LONG_SESSION_THRESHOLD_SECONDS = 10 * 3600

# Tier-1 activity slugs (the renamed `category` enum). Stored in
# `time_entries.activity`. Mirrors the SSOT on the frontend at
# `lib/timeTracking.ts` — keep these two lists in sync; any new
# activity needs to be added in BOTH places (and seeded with a
# default set of subcategories via the Time Categories admin page
# or a follow-up migration).
# 2026-05-21 Logan taxonomy pass: removed `validating`, `checklist`, and
# `community` from the accepted activity set per his request (Validating
# folded into QC/Validation; Checklist deprecated; Community's subs
# relocated under Other). The slugs are NOT in ACTIVITY_DISPLAY_MAP-less
# territory — historical entries with those values still render via the
# display map below — but new clock-ins with those slugs now 400. Legacy
# alias `validation` is also dropped from accepted slugs for the same
# reason. `mapping` (-> Editing) and `review` (-> QC/Validation) stay
# accepted for back-compat from older clients.
ACTIVITY_SLUGS = {
    "editing", "training",
    "qc_review", "meeting", "documentation", "imagery_capture",
    "project_creation", "other", "community_event",
    # Legacy values still accepted for backward compat (clock-in payloads
    # from older clients). Normalized to canonical slugs on display.
    "mapping", "review",
}

# Map stored activity slug -> display label. User-facing UI strings.
# Retired activities (`validating`, `checklist`, `community`) keep their
# display entries so historical time_entries continue to render their
# original label correctly even though new clock-ins can no longer pick
# them. `qc_review` was renamed from "QC / Review" -> "QC / Validation"
# in the same pass (Logan merged Validating into it).
ACTIVITY_DISPLAY_MAP = {
    "editing": "Editing",
    "training": "Training",
    "qc_review": "QC / Validation",
    "meeting": "Meeting",
    "documentation": "Documentation",
    "imagery_capture": "Imagery Capture",
    "project_creation": "Project Creation",
    "other": "Other",
    "community_event": "Community Event",
    # Retired activities — kept for display continuity on historical rows.
    "validating": "Validating",
    "checklist": "Checklist",
    "community": "Community",
    # Legacy mappings -> canonical labels (post-rename for review/validation).
    "mapping": "Editing",
    "validation": "Validating",
    "review": "QC / Validation",
}


class TimeTrackingHelpers:
    """Pure-function helpers for TimeTrackingAPI."""

    USER_NOTES_MAX_LEN = 500

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
        if len(trimmed) > TimeTrackingHelpers.USER_NOTES_MAX_LEN:
            raise ValueError(
                f"user_notes exceeds {TimeTrackingHelpers.USER_NOTES_MAX_LEN}-character limit"
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

        # Effective elapsed seconds: recorded duration for closed entries,
        # live elapsed for still-active ones, else None. Used by the
        # long-sessions endpoint to sort/flag across both cases.
        if entry.duration_seconds is not None:
            effective_duration_seconds = entry.duration_seconds
        elif entry.status == "active" and entry.clock_in:
            effective_duration_seconds = int(
                (datetime.utcnow() - entry.clock_in).total_seconds()
            )
        else:
            effective_duration_seconds = None

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
            "effectiveDurationSeconds": effective_duration_seconds,
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

        # TODO Fetch changset diff here will need to update cron job to make this work properly

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
    def _format_duration_hours(duration_seconds):
        """Format duration in seconds to a human-readable hours string."""
        if duration_seconds is None:
            return ""
        hours = duration_seconds / 3600
        return f"{hours:.2f}"

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
