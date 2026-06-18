#!/usr/bin/env python3
"""
TimeEntry presentation + small pure helpers for the TimeTracking views.

``TimeTrackingHelpers`` is the serialization/normalization half of the
time-tracking domain: ``_format_entry`` (the wire shape every time view
returns), notes normalization, duration formatting, subcategory
serialization, and the team-admin scope back-compat wrapper. The activity
taxonomy it renders against lives in :mod:`.constants`.
"""

import logging
from datetime import datetime

from ..database import Project
from .. import users_repo
from .constants import ACTIVITY_DISPLAY_MAP
from .scope import TimeEntryScope

logger = logging.getLogger(__name__)


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
        user = users_repo.by_id(entry.user_id)
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
            # IANA zone of the entry's owner (nullable). Lets admin
            # adjustment UIs render/edit clock times in the user's wall
            # clock rather than the admin's browser timezone.
            "timezone": user.timezone if user else None,
            "projectId": entry.project_id,
            "projectName": project.name if project else "No Project",
            "projectShortName": (project.short_name or "") if project else "",
            # The "category" JSON key is preserved for frontend backward
            # compat; it reads from entry.activity now (DB column was
            # renamed in migration c4f8a9b0d1e2). Display label still
            # comes from ACTIVITY_DISPLAY_MAP.
            "category": ACTIVITY_DISPLAY_MAP.get(
                entry.activity, entry.activity.capitalize() if entry.activity else ""
            ),
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
            "longSessionReviewedBy": entry.long_session_reviewed_by,
            "longSessionReviewedAt": (
                entry.long_session_reviewed_at.isoformat() + "Z"
                if entry.long_session_reviewed_at
                else None
            ),
        }

    @staticmethod
    def _apply_team_admin_scope(query, viewer, team_id_in_request=None):
        """Force a TimeEntry query to managed-team members for team_admin.

        Thin back-compat wrapper — the policy now lives in
        ``TimeEntryScope.apply_team_admin_scope`` (single source of truth).
        Existing call sites that pass ``(query, viewer, team_id)`` keep
        working unchanged.
        """
        scope = TimeEntryScope(viewer, getattr(viewer, "org_id", None))
        return scope.apply_team_admin_scope(query, team_id_in_request)

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
