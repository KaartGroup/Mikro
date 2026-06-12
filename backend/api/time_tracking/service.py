"""
TimeEntry command service — all writes to ``time_entries`` in one place.

This is the command half of a command/query split: reads live in
``queries.TimeEntryQuery`` (and its workflow subclasses), every mutation
lives here. Keeping them apart means a caller that only wants to clock
someone out no longer constructs a full filter/scope pipeline (and a
``ChangesetFetcher``) just to reach a write method, and the invariants —
single duration formula, the best-effort changeset fetch on close, the
legacy ``custom_topics`` upsert, the void/discard stamping — are defined
exactly once.

The OSM ``ChangesetFetcher`` is injected (defaulting to a fresh instance)
so tests can substitute a fake without monkeypatching the network.
"""

from datetime import datetime

from ..database import TimeEntry, User, CustomTopic, db
from ..utils.changeset_fetcher import ChangesetFetcher
from .presenter import TimeTrackingHelpers


class DiscardWindowError(ValueError):
    """Raised by ``TimeEntryService.discard`` when the session is past the
    self-service discard window. Carries the elapsed/limit seconds so the
    view can surface them in the 400 response body."""

    def __init__(self, elapsed_seconds: int, max_seconds: int):
        self.elapsed_seconds = elapsed_seconds
        self.max_seconds = max_seconds
        m, s = divmod(elapsed_seconds, 60)
        super().__init__(
            f"Cannot discard — this session is {m}m {s}s old. Discard is "
            f"only allowed within the first {max_seconds // 60} minutes. "
            f"Clock out and use Request Adjustment instead."
        )


class TimeEntryService:
    """All state-changing operations on TimeEntry rows."""

    def __init__(self, changeset_fetcher=None):
        self.changeset_fetcher = changeset_fetcher or ChangesetFetcher()

    # ── creation ────────────────────────────────────────────────────
    def clock_in(
        self,
        user_id: str,
        org_id: str,
        activity: str,
        sub_fields: dict,
        project_id=None,
        task_name=None,
        task_ref_type=None,
        task_ref_id=None,
        user_notes=None,
    ):
        entry = TimeEntry()
        entry.user_id = user_id
        entry.project_id = project_id
        entry.org_id = org_id
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

        self._maybe_upsert_custom_topic(
            activity, task_name, sub_fields, org_id, user_id
        )
        return entry

    def create_completed(
        self,
        user_id: str,
        org_id: str,
        created_by: str,
        activity: str,
        sub_fields: dict,
        clock_in,
        clock_out,
        project_id=None,
        task_name=None,
        task_ref_type=None,
        task_ref_id=None,
        notes="",
    ):
        entry = TimeEntry()
        entry.user_id = user_id
        entry.org_id = org_id
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

        self._maybe_upsert_custom_topic(
            activity, task_name, sub_fields, org_id, created_by
        )
        return entry

    # ── mutation ────────────────────────────────────────────────────
    def clock_out(
        self,
        session_id: int,
        user_id: str,
        user_notes=None,
        update_notes: bool = False,
        force_clocked_out_by: str = None,
    ):
        entry = TimeEntry.query.filter_by(
            id=session_id, user_id=user_id, status="active"
        ).first()

        if not entry:
            return None

        now = datetime.utcnow()
        entry.clock_out = now
        entry.duration_seconds = int((now - entry.clock_in).total_seconds())
        entry.status = "completed"
        if force_clocked_out_by:
            entry.force_clocked_out_by = force_clocked_out_by
        if update_notes:
            entry.user_notes = TimeTrackingHelpers._normalize_user_notes(user_notes)

        # Fetch OSM changesets (best-effort).
        user = User.query.get(entry.user_id)
        if user and user.osm_username:
            changeset_count, changes_count = self.changeset_fetcher._fetch_for_user(
                user.osm_username, entry.clock_in
            )
            entry.changeset_count = changeset_count
            entry.changes_count = changes_count

        entry.save()
        return entry

    def void(self, entry_id: int, org_id: str, voided_by: str):
        entry = TimeEntry.query.filter_by(id=entry_id, org_id=org_id).first()
        if not entry:
            return None
        entry.status = "voided"
        entry.voided_by = voided_by
        entry.voided_at = datetime.utcnow()
        entry.save()
        return entry

    def discard(self, session_id: int, user_id: str, window_seconds: int):
        entry = TimeEntry.query.filter_by(
            id=session_id, user_id=user_id, status="active"
        ).first()
        if not entry:
            return None
        elapsed = int((datetime.utcnow() - entry.clock_in).total_seconds())
        if elapsed > window_seconds:
            raise DiscardWindowError(elapsed, window_seconds)
        db.session.delete(entry)
        db.session.commit()
        return elapsed

    # ── shared helpers ──────────────────────────────────────────────
    @staticmethod
    def _maybe_upsert_custom_topic(activity, task_name, sub_fields, org_id, created_by):
        """Legacy: an "other" entry with a free-form task_name and no real
        subcategory upserts a CustomTopic row. Superseded by
        ActivitySubcategory but kept so older clients keep working."""
        if activity == "other" and task_name and sub_fields["subcategory_id"] is None:
            existing = CustomTopic.query.filter_by(
                name=task_name, org_id=org_id
            ).first()
            if not existing:
                topic = CustomTopic()
                topic.name = task_name
                topic.org_id = org_id
                topic.created_by = created_by
                topic.save()
