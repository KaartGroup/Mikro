"""
Tests for the "Switch Task — deferred metadata" service behavior:
``TimeEntryService.switch_task`` and the ``finalize`` path on ``clock_out``.

The core contracts:

1. A switch is ATOMIC and gap-free: the outgoing session's ``clock_out``
   equals the new session's ``clock_in`` to the microsecond, so no tracked
   time is lost between tasks.

2. The new session starts PENDING: ``activity IS NULL`` and
   ``needs_metadata=True``. Its details are collected on the next exit.

3. Deferred metadata is applied on exit: when the outgoing/closing session is
   pending, a validated ``finalize`` dict fills its category/project/etc and
   clears the flag — via ``switch_task`` (switching again) or ``clock_out``.

Fetcher is injected (no network) per the service's design.
"""

from datetime import datetime, timedelta

from api.database import TimeEntry
from api.time_tracking.service import TimeEntryService
from tests.conftest import USER_ID, OTHER_USER_ID, ORG


class _FakeFetcher:
    def __init__(self, changesets=None, exc=None):
        self._changesets = [] if changesets is None else changesets
        self._exc = exc
        self.calls = []

    def fetch(self, osm_usernames, since, until=None, max_results=None):
        self.calls.append((list(osm_usernames), since, until))
        if self._exc is not None:
            raise self._exc
        return self._changesets


def _active_entry(db_session, user_id=USER_ID, **kwargs):
    defaults = dict(
        user_id=user_id,
        org_id=ORG,
        activity="editing",
        status="active",
        needs_metadata=False,
        clock_in=datetime.utcnow() - timedelta(minutes=30),
        clock_out=None,
        duration_seconds=None,
    )
    defaults.update(kwargs)
    entry = TimeEntry(**defaults)
    db_session.add(entry)
    db_session.flush()
    return entry


def _svc():
    return TimeEntryService(changeset_fetcher=_FakeFetcher())


def _finalize(**over):
    payload = dict(
        activity="editing",
        sub_fields={
            "subcategory_id": None,
            "subcategory_name": None,
            "retained_participants": None,
            "new_participants": None,
        },
        project_id=None,
        task_name=None,
        task_ref_type=None,
        task_ref_id=None,
        user_notes=None,
    )
    payload.update(over)
    return payload


# ── switch_task: atomic, gap-free, opens a pending session ───────────────────


def test_switch_from_detailed_session_opens_pending_no_gap(db_session):
    outgoing = _active_entry(db_session, activity="editing")

    closed, new_entry = _svc().switch_task(USER_ID, ORG)

    assert closed.id == outgoing.id
    assert closed.status == "completed"
    assert closed.clock_out is not None
    # New session is pending and gap-free.
    assert new_entry.id != outgoing.id
    assert new_entry.status == "active"
    assert new_entry.needs_metadata is True
    assert new_entry.activity is None
    assert new_entry.clock_in == closed.clock_out  # no lost time


def test_switch_with_no_active_session_returns_none(db_session):
    closed, new_entry = _svc().switch_task(USER_ID, ORG)
    assert closed is None
    assert new_entry is None


def test_switch_is_scoped_to_caller(db_session):
    outgoing = _active_entry(db_session, user_id=USER_ID)
    closed, new_entry = _svc().switch_task(OTHER_USER_ID, ORG)
    assert closed is None and new_entry is None
    assert outgoing.status == "active"  # untouched


def test_only_one_active_session_after_switch(db_session):
    _active_entry(db_session)
    _svc().switch_task(USER_ID, ORG)
    actives = TimeEntry.query.filter_by(user_id=USER_ID, status="active").all()
    assert len(actives) == 1
    assert actives[0].needs_metadata is True


# ── switch_task: finalizing a pending outgoing session ───────────────────────


def test_switch_finalizes_pending_outgoing(db_session):
    # User is currently in a pending session (switched into earlier).
    _active_entry(db_session, activity=None, needs_metadata=True)

    closed, new_entry = _svc().switch_task(
        USER_ID, ORG, finalize=_finalize(activity="meeting", task_name="Standup")
    )

    # Outgoing got its deferred metadata and is now categorized + closed.
    assert closed.activity == "meeting"
    assert closed.task_name == "Standup"
    assert closed.needs_metadata is False
    assert closed.status == "completed"
    # And a fresh pending session is running.
    assert new_entry.needs_metadata is True
    assert new_entry.activity is None


# ── clock_out: finalize path ─────────────────────────────────────────────────


def test_clock_out_finalizes_pending_session(db_session):
    entry = _active_entry(db_session, activity=None, needs_metadata=True)

    result = _svc().clock_out(
        None,
        USER_ID,
        finalize=_finalize(activity="documentation", task_name="Write notes"),
    )

    assert result.id == entry.id
    assert result.status == "completed"
    assert result.activity == "documentation"
    assert result.task_name == "Write notes"
    assert result.needs_metadata is False
    assert result.clock_out is not None


def test_clock_out_without_finalize_leaves_normal_session_untouched(db_session):
    entry = _active_entry(db_session, activity="editing", needs_metadata=False)

    result = _svc().clock_out(None, USER_ID)

    assert result.id == entry.id
    assert result.activity == "editing"  # unchanged
    assert result.needs_metadata is False
    assert result.status == "completed"
