"""
Tests for ``TimeEntryService.clock_in`` and the clock-in → clock-out lifecycle.

``clock_in`` opens an ``active`` TimeEntry and, for the legacy free-form
"other" activity, best-effort upserts a ``CustomTopic`` row. The round-trip
test pins the whole self-service lifecycle: a clock-in followed by a no-arg
clock-out (the frontend's ``clockOut({})``) closes that same session and
stamps a non-negative duration.
"""

from api.database import TimeEntry, CustomTopic, ActivitySubcategory
from api.time_tracking.service import TimeEntryService
from tests.conftest import USER_ID, ORG


class _NoopFetcher:
    """clock_out constructs a ChangesetFetcher by default; inject this so the
    round-trip never touches the network. (The fixture user has no
    osm_username, so fetch isn't reached anyway — this is belt-and-suspenders.)"""

    def fetch(self, osm_usernames, since, until=None, max_results=None):
        return []


def _sub_fields(subcategory_id=None, subcategory_name=None, retained=None, new=None):
    return {
        "subcategory_id": subcategory_id,
        "subcategory_name": subcategory_name,
        "retained_participants": retained,
        "new_participants": new,
    }


# ── clock_in opens an active session ─────────────────────────────────────────


def test_clock_in_creates_active_session(db_session):
    entry = TimeEntryService().clock_in(
        user_id=USER_ID,
        org_id=ORG,
        activity="editing",
        sub_fields=_sub_fields(subcategory_name="Buildings", retained=2, new=5),
        task_name="task-123",
        task_ref_type="project",
        task_ref_id=999,
        user_notes="starting work",
    )

    assert entry.id is not None
    assert entry.status == "active"
    assert entry.clock_in is not None
    assert entry.clock_out is None
    assert entry.duration_seconds is None

    assert entry.user_id == USER_ID
    assert entry.org_id == ORG
    assert entry.activity == "editing"
    assert entry.subcategory_name == "Buildings"
    assert entry.retained_participants == 2
    assert entry.new_participants == 5
    assert entry.task_name == "task-123"
    assert entry.task_ref_type == "project"
    assert entry.task_ref_id == 999
    assert entry.user_notes == "starting work"

    # Persisted (clock_in commits), so a fresh query finds it.
    assert TimeEntry.query.get(entry.id) is not None


# ── custom-topic upsert (legacy "other" path) ────────────────────────────────


def test_clock_in_other_activity_upserts_custom_topic(db_session):
    TimeEntryService().clock_in(
        user_id=USER_ID,
        org_id=ORG,
        activity="other",
        sub_fields=_sub_fields(subcategory_id=None),
        task_name="Field survey notes",
    )

    topic = CustomTopic.query.filter_by(name="Field survey notes", org_id=ORG).first()
    assert topic is not None
    assert topic.created_by == USER_ID


def test_clock_in_does_not_duplicate_existing_custom_topic(db_session):
    existing = CustomTopic(
        name="Recurring topic", org_id=ORG, created_by="auth0|someone-else"
    )
    db_session.add(existing)
    db_session.flush()

    TimeEntryService().clock_in(
        user_id=USER_ID,
        org_id=ORG,
        activity="other",
        sub_fields=_sub_fields(subcategory_id=None),
        task_name="Recurring topic",
    )

    topics = CustomTopic.query.filter_by(name="Recurring topic", org_id=ORG).all()
    assert len(topics) == 1
    assert topics[0].created_by == "auth0|someone-else"  # original untouched


def test_clock_in_non_other_activity_creates_no_topic(db_session):
    TimeEntryService().clock_in(
        user_id=USER_ID,
        org_id=ORG,
        activity="editing",
        sub_fields=_sub_fields(subcategory_id=None),
        task_name="Not a topic",
    )

    assert CustomTopic.query.filter_by(name="Not a topic").first() is None


def test_clock_in_with_subcategory_creates_no_topic(db_session):
    """A real subcategory means the entry isn't a free-form "other" — no
    CustomTopic should be upserted even with activity="other"."""
    sub = ActivitySubcategory(
        activity="other", name="Preset", slug="preset", org_id=ORG
    )
    db_session.add(sub)
    db_session.flush()

    TimeEntryService().clock_in(
        user_id=USER_ID,
        org_id=ORG,
        activity="other",
        sub_fields=_sub_fields(subcategory_id=sub.id, subcategory_name="Preset"),
        task_name="Preset",
    )

    assert CustomTopic.query.filter_by(name="Preset").first() is None


# ── full lifecycle: clock_in → clock_out ─────────────────────────────────────


def test_clock_in_then_clock_out_round_trip(db_session):
    service = TimeEntryService(changeset_fetcher=_NoopFetcher())

    opened = service.clock_in(
        user_id=USER_ID,
        org_id=ORG,
        activity="editing",
        sub_fields=_sub_fields(subcategory_name="Roads"),
    )
    assert opened.status == "active"

    # No-arg self clock-out resolves the caller's active session.
    closed = service.clock_out(None, USER_ID)

    assert closed is not None
    assert closed.id == opened.id
    assert closed.status == "completed"
    assert closed.clock_out is not None
    assert closed.clock_out >= closed.clock_in
    expected = int((closed.clock_out - closed.clock_in).total_seconds())
    assert closed.duration_seconds == expected
    assert closed.duration_seconds >= 0

    # Session is now closed: a second clock-out finds nothing active.
    assert service.clock_out(None, USER_ID) is None
