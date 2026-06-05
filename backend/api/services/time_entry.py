#!/usr/bin/env python3
"""
TimeEntryService — session lifecycle and admin time-entry operations.

Extracted from ``api/views/TimeTracking.py``. The Flask view retains
input validation, subcategory resolution, permission checks, and
response building; this service owns all TimeEntry DB writes.

Usage::

    svc = TimeEntryService(g.user.org_id)
    entry = svc.open_session(user, project_id, activity, sub_fields, task_name, user_notes)
    entry = svc.close_session(user, session_id=None, user_notes=None)
    entry = svc.void_entry(entry_id, voided_by)
"""

from datetime import datetime

from ..database import CustomTopic, TimeEntry, db
from ..utils.time_tracking_helpers import TimeTrackingHelpers


class TimeEntryService:
    """TimeEntry DB operations, org-scoped by construction.

    All datetimes stored as **naive UTC** — the TimeEntry model predates
    timezone-aware columns and all existing rows are naive UTC. Do not change
    to ``datetime.now(timezone.utc)`` without a migration that strips tzinfo
    from all existing ``clock_in``/``clock_out`` values.
    """

    def __init__(self, org_id: str):
        self.org_id = org_id

    def open_session(
        self,
        user,
        project_id,
        activity: str,
        sub_fields: dict,
        task_name: str = None,
        task_ref_type: str = None,
        task_ref_id=None,
        user_notes: str = None,
    ) -> TimeEntry:
        """Create and return a new active TimeEntry.

        ``sub_fields`` must be the dict returned by
        ``_resolve_subcategory_for_write()`` (already validated by the view).
        If the entry is for an ``activity='other'`` with a free-form
        ``task_name`` and no subcategory, a CustomTopic row is upserted as
        a legacy side-effect.
        """
        entry = TimeEntry()
        entry.user_id = user.id
        entry.project_id = project_id
        entry.org_id = self.org_id
        entry.activity = activity
        entry.subcategory_id = sub_fields["subcategory_id"]
        entry.subcategory_name = sub_fields["subcategory_name"]
        entry.retained_participants = sub_fields["retained_participants"]
        entry.new_participants = sub_fields["new_participants"]
        entry.task_name = task_name
        entry.task_ref_type = task_ref_type
        entry.task_ref_id = task_ref_id
        entry.clock_in = datetime.utcnow()
        entry.status = "active"
        entry.user_notes = user_notes
        entry.save()

        # Legacy: "other" with a free-form task_name upserts into custom_topics
        if activity == "other" and task_name and sub_fields["subcategory_id"] is None:
            if not CustomTopic.query.filter_by(name=task_name, org_id=self.org_id).first():
                topic = CustomTopic()
                topic.name = task_name
                topic.org_id = self.org_id
                topic.created_by = user.id
                topic.save()

        return entry

    def close_session(
        self,
        user,
        session_id=None,
        user_notes: str = None,
        force_by: str = None,
    ) -> TimeEntry | None:
        """Complete an active session and return the updated entry.

        Finds the session by ``session_id`` (or the latest active session if
        None), records clock_out/duration, fetches OSM changesets best-effort.
        If ``force_by`` is set, stamps ``force_clocked_out_by`` (admin force).

        Returns None if no active session is found.
        """
        if session_id:
            entry = TimeEntry.query.filter_by(
                id=session_id, user_id=user.id, status="active"
            ).first()
        else:
            entry = TimeEntry.query.filter_by(
                user_id=user.id, status="active"
            ).first()

        if not entry:
            return None

        if user_notes is not None:
            entry.user_notes = user_notes

        now = datetime.utcnow()
        entry.clock_out = now
        entry.duration_seconds = int((now - entry.clock_in).total_seconds())
        entry.status = "completed"

        if force_by:
            entry.force_clocked_out_by = force_by

        osm_username = getattr(user, "osm_username", None)
        if osm_username:
            changeset_count, changes_count = TimeTrackingHelpers._fetch_osm_changesets(
                osm_username, entry.clock_in
            )
            entry.changeset_count = changeset_count
            entry.changes_count = changes_count

        entry.save()
        return entry

    def force_close_session(
        self, session_id, forced_user, closed_by: str
    ) -> TimeEntry | None:
        """Admin force-close of any active session in the org.

        Fetches OSM changesets using the session owner's osm_username.
        Returns None if no matching active session is found.
        """
        entry = TimeEntry.query.filter_by(
            id=session_id, org_id=self.org_id, status="active"
        ).first()
        if not entry:
            return None

        now = datetime.utcnow()
        entry.clock_out = now
        entry.duration_seconds = int((now - entry.clock_in).total_seconds())
        entry.status = "completed"
        entry.force_clocked_out_by = closed_by

        if forced_user and forced_user.osm_username:
            cc, changes = TimeTrackingHelpers._fetch_osm_changesets(
                forced_user.osm_username, entry.clock_in
            )
            entry.changeset_count = cc
            entry.changes_count = changes

        entry.save()
        return entry

    def void_entry(
        self, entry_id, voided_by: str
    ) -> TimeEntry | None:
        """Set a time entry's status to 'voided'.

        Returns the updated row, or None if not found in this org.
        Callers must check that the entry is not already voided before calling.
        """
        entry = TimeEntry.query.filter_by(id=entry_id, org_id=self.org_id).first()
        if not entry:
            return None
        entry.status = "voided"
        entry.voided_by = voided_by
        entry.voided_at = datetime.utcnow()
        entry.save()
        return entry

    def edit_entry(
        self,
        entry_id,
        fields: dict,
        edited_by: str,
    ) -> TimeEntry | None:
        """Apply mutable-field updates to a time entry.

        ``fields`` keys may include:
        - ``clock_in``, ``clock_out``: naive UTC datetimes (already parsed by view)
        - ``activity``: validated activity slug
        - ``task_name``, ``task_ref_type``, ``task_ref_id``
        - ``sub_fields``: dict from ``_resolve_subcategory_for_write()``

        Duration is recalculated when both clock_in and clock_out are present.
        Returns the updated row, or None if not found in this org.
        """
        entry = TimeEntry.query.filter_by(id=entry_id, org_id=self.org_id).first()
        if not entry:
            return None

        for key in ("clock_in", "clock_out", "activity", "task_name", "task_ref_type", "task_ref_id"):
            if key in fields:
                setattr(entry, key, fields[key])

        if "sub_fields" in fields:
            sf = fields["sub_fields"]
            entry.subcategory_id = sf["subcategory_id"]
            entry.subcategory_name = sf["subcategory_name"]
            entry.retained_participants = sf["retained_participants"]
            entry.new_participants = sf["new_participants"]

        if entry.clock_in and entry.clock_out:
            entry.duration_seconds = int((entry.clock_out - entry.clock_in).total_seconds())

        if entry.notes and entry.notes.startswith("[ADJUSTMENT REQUESTED]"):
            entry.notes = entry.notes.replace("[ADJUSTMENT REQUESTED]", "[ADJUSTED]", 1)

        entry.edited_by = edited_by
        entry.edited_at = datetime.utcnow()
        entry.save()
        return entry

    def add_entry(
        self,
        user,
        project_id,
        activity: str,
        clock_in: datetime,
        clock_out: datetime,
        sub_fields: dict,
        task_name: str = None,
        task_ref_type: str = None,
        task_ref_id=None,
        notes: str = "",
        created_by: str = None,
    ) -> TimeEntry:
        """Manually create a completed TimeEntry for a user.

        ``clock_in`` and ``clock_out`` must be naive UTC datetimes (already
        parsed and validated by the view). ``sub_fields`` must be the dict
        from ``_resolve_subcategory_for_write()``.
        """
        entry = TimeEntry()
        entry.user_id = user.id
        entry.org_id = self.org_id
        entry.project_id = project_id
        entry.activity = activity
        entry.subcategory_id = sub_fields["subcategory_id"]
        entry.subcategory_name = sub_fields["subcategory_name"]
        entry.retained_participants = sub_fields["retained_participants"]
        entry.new_participants = sub_fields["new_participants"]
        entry.task_name = task_name
        entry.task_ref_type = task_ref_type
        entry.task_ref_id = task_ref_id
        entry.clock_in = clock_in
        entry.clock_out = clock_out
        entry.duration_seconds = int((clock_out - clock_in).total_seconds())
        entry.status = "completed"
        entry.notes = f"[ADMIN CREATED] {notes}".strip()
        entry.edited_by = created_by
        entry.edited_at = datetime.utcnow()
        entry.save()

        if activity == "other" and task_name and sub_fields["subcategory_id"] is None:
            if not CustomTopic.query.filter_by(name=task_name, org_id=self.org_id).first():
                topic = CustomTopic()
                topic.name = task_name
                topic.org_id = self.org_id
                topic.created_by = created_by
                topic.save()

        return entry
