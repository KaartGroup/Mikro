"""Tests for dismissing ("marking reviewed") long-running session alerts.

Exercises ``TimeTrackingAPI.admin_dismiss_long_session`` and its effect on
``admin_long_sessions`` against real DB rows via the shared ``db_session``
fixture (rolled back per test). The key guarantee under test: dismissing
removes the entry from the queue WITHOUT touching the underlying time data
(clock_in / clock_out / duration_seconds / status).
"""

from datetime import datetime, timedelta

import pytest
from flask import g

from api.views.TimeTracking import TimeTrackingAPI
from api.time_tracking import LONG_SESSION_THRESHOLD_SECONDS
from api.database import TimeEntry, User

from tests.conftest import USER_ID, ORG

_APP = {}


@pytest.fixture(autouse=True)
def _bind_app(app):
    _APP["app"] = app
    yield
    _APP.pop("app", None)


def _admin(db_session):
    user = User.query.get(USER_ID)
    user.org_id = ORG
    user.role = "admin"
    user.is_active = True
    db_session.flush()
    return user


def _long_active_entry(db_session):
    """An active session open longer than the threshold."""
    entry = TimeEntry(
        user_id=USER_ID,
        org_id=ORG,
        activity="mapping",
        status="active",
        clock_in=datetime.utcnow()
        - timedelta(seconds=LONG_SESSION_THRESHOLD_SECONDS + 3600),
    )
    db_session.add(entry)
    db_session.flush()
    return entry


def _long_closed_entry(db_session):
    """A closed session whose recorded duration exceeded the threshold."""
    clock_in = datetime.utcnow() - timedelta(days=1)
    duration = LONG_SESSION_THRESHOLD_SECONDS + 3600
    entry = TimeEntry(
        user_id=USER_ID,
        org_id=ORG,
        activity="mapping",
        status="completed",
        clock_in=clock_in,
        clock_out=clock_in + timedelta(seconds=duration),
        duration_seconds=duration,
    )
    db_session.add(entry)
    db_session.flush()
    return entry


def _long_sessions(user):
    with _APP["app"].test_request_context(json={}):
        g.user = user
        resp, code = TimeTrackingAPI().admin_long_sessions()
        return code, resp.get_json()["sessions"]


def _dismiss(user, body):
    with _APP["app"].test_request_context(json=body):
        g.user = user
        return TimeTrackingAPI().admin_dismiss_long_session()


def test_dismiss_removes_entry_from_queue(db_session):
    user = _admin(db_session)
    entry = _long_active_entry(db_session)
    entry_id = entry.id

    code, sessions = _long_sessions(user)
    assert code == 200
    assert any(s["id"] == entry_id for s in sessions)

    resp, code = _dismiss(user, {"session_id": entry_id})
    assert code == 200

    code, sessions = _long_sessions(user)
    assert not any(s["id"] == entry_id for s in sessions)


def test_dismiss_does_not_modify_underlying_time_entry(db_session):
    user = _admin(db_session)
    entry = _long_closed_entry(db_session)
    entry_id = entry.id
    before = (entry.clock_in, entry.clock_out, entry.duration_seconds, entry.status)

    resp, code = _dismiss(user, {"session_id": entry_id})
    assert code == 200

    refreshed = TimeEntry.query.get(entry_id)
    assert (
        refreshed.clock_in,
        refreshed.clock_out,
        refreshed.duration_seconds,
        refreshed.status,
    ) == before
    # Only the review markers changed.
    assert refreshed.long_session_reviewed_at is not None
    assert refreshed.long_session_reviewed_by == user.id


def test_undo_restores_entry_to_queue(db_session):
    user = _admin(db_session)
    entry = _long_active_entry(db_session)
    entry_id = entry.id

    _dismiss(user, {"session_id": entry_id})
    code, sessions = _long_sessions(user)
    assert not any(s["id"] == entry_id for s in sessions)

    resp, code = _dismiss(user, {"session_id": entry_id, "reviewed": False})
    assert code == 200
    refreshed = TimeEntry.query.get(entry_id)
    assert refreshed.long_session_reviewed_at is None
    assert refreshed.long_session_reviewed_by is None

    code, sessions = _long_sessions(user)
    assert any(s["id"] == entry_id for s in sessions)


def test_dismiss_unknown_entry_404(db_session):
    user = _admin(db_session)
    resp, code = _dismiss(user, {"session_id": 999999999})
    assert code == 404
    assert resp.get_json()["status"] == 404


def test_dismiss_missing_session_id_400(db_session):
    user = _admin(db_session)
    resp, code = _dismiss(user, {})
    assert code == 400
    assert resp.get_json()["status"] == 400


def test_dismiss_accepts_entry_id_alias(db_session):
    user = _admin(db_session)
    entry = _long_active_entry(db_session)
    entry_id = entry.id

    resp, code = _dismiss(user, {"entry_id": entry_id})
    assert code == 200
    refreshed = TimeEntry.query.get(entry_id)
    assert refreshed.long_session_reviewed_at is not None
