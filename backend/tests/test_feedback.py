"""
Tests for the feedback / problem-report endpoint (``api/views/Feedback.py``)
and the discard-active hardening in ``api/views/TimeTracking.py``.

Feedback tests monkeypatch ``api.views.Feedback.translate_to_english`` and
``api.comms_client.send_email`` so NO real Anthropic or HTTP calls happen.

Discard tests exercise the optional-session_id resolution path against real
DB rows via the shared ``db_session`` fixture (rolled back per test).
"""

from datetime import datetime

import pytest
from flask import g

import api.comms_client as comms_client
import api.views.Feedback as feedback_mod
from api.views.Feedback import FeedbackAPI
from api.views.TimeTracking import TimeTrackingAPI
from api.database import TimeEntry, User

from tests.conftest import USER_ID, ORG

# ─── Shared app binding (see test_comms_targeting.py) ────────────────────────

_APP = {}


@pytest.fixture(autouse=True)
def _bind_app(app):
    _APP["app"] = app
    yield
    _APP.pop("app", None)


class _Spy:
    """Captures kwargs of each call and returns a canned dict."""

    def __init__(self, ret=None):
        self.calls = []
        self.ret = ret if ret is not None else {}

    def __call__(self, **kwargs):
        self.calls.append(kwargs)
        return self.ret

    @property
    def last(self):
        return self.calls[-1]


@pytest.fixture
def send_spy(monkeypatch):
    spy = _Spy(ret={"sent": 1})
    monkeypatch.setattr(comms_client, "send_email", spy)
    return spy


@pytest.fixture
def good_translate(monkeypatch):
    """translate_to_english -> ("TRANSLATED", None)."""
    monkeypatch.setattr(
        feedback_mod, "translate_to_english", lambda text: ("TRANSLATED", None)
    )


# ─── Feedback world: a reporter + an org admin ───────────────────────────────


@pytest.fixture
def feedback_world(db_session):
    """Make the seeded USER_ID the reporter (give it an org + email).

    Delivery goes to the dev address (FEEDBACK_EMAIL), NOT org admins, so no
    admin user is needed."""
    reporter = User.query.get(USER_ID)
    reporter.org_id = ORG
    reporter.email = "reporter@x.test"
    db_session.flush()
    return {"reporter": reporter}


def _submit(user, body):
    with _APP["app"].test_request_context(json=body):
        g.user = user
        return FeedbackAPI().submit()


# ─── Feedback tests ──────────────────────────────────────────────────────────


def test_submit_ok_delivers_with_translation(feedback_world, send_spy, good_translate):
    resp, code = _submit(
        feedback_world["reporter"],
        {"description": "Algo está roto", "category": "bug"},
    )
    assert code == 200
    assert resp.get_json()["status"] == 200

    assert len(send_spy.calls) == 1
    kwargs = send_spy.last
    # Delivered ONLY to the configured dev address — never org admins.
    assert kwargs["to"] == _APP["app"].config["FEEDBACK_EMAIL"]
    # Subject makes it clear this is a Mikro report.
    assert kwargs["subject"].startswith("[Mikro] Bug report")
    # Body carries both the original text and the translation.
    body = kwargs["body_html"]
    assert "Algo está roto" in body
    assert "TRANSLATED" in body


def test_submit_empty_description_400(feedback_world, send_spy, good_translate):
    resp, code = _submit(
        feedback_world["reporter"],
        {"description": "   ", "category": "bug"},
    )
    assert code == 400
    assert send_spy.calls == []


def test_submit_no_dev_email_configured_still_200(
    feedback_world, send_spy, good_translate, monkeypatch
):
    """If FEEDBACK_EMAIL isn't configured -> still 200, no send attempted."""
    monkeypatch.setitem(_APP["app"].config, "FEEDBACK_EMAIL", None)
    resp, code = _submit(feedback_world["reporter"], {"description": "help"})
    assert code == 200
    assert send_spy.calls == []


def test_submit_comms_error_still_200(feedback_world, monkeypatch, good_translate):
    def _boom(**kwargs):
        raise comms_client.CommsError("connection refused")

    monkeypatch.setattr(comms_client, "send_email", _boom)
    resp, code = _submit(feedback_world["reporter"], {"description": "still works"})
    assert code == 200


def test_submit_translation_unavailable_still_200(
    feedback_world, send_spy, monkeypatch
):
    monkeypatch.setattr(
        feedback_mod, "translate_to_english", lambda text: (None, "err")
    )
    resp, code = _submit(feedback_world["reporter"], {"description": "no translation"})
    assert code == 200
    assert len(send_spy.calls) == 1
    body = send_spy.last["body_html"]
    assert "(translation unavailable)" in body
    assert "no translation" in body


# ─── Discard hardening tests ─────────────────────────────────────────────────


def _discard(user, body):
    with _APP["app"].test_request_context(json=body):
        g.user = user
        return TimeTrackingAPI().discard_active()


def _active_entry(db_session, user_id=USER_ID, org_id=ORG):
    entry = TimeEntry(
        user_id=user_id,
        org_id=org_id,
        activity="mapping",
        status="active",
        clock_in=datetime.utcnow(),
    )
    db_session.add(entry)
    db_session.flush()
    return entry


def test_discard_no_session_id_resolves_and_deletes(db_session):
    user = User.query.get(USER_ID)
    user.org_id = ORG
    entry = _active_entry(db_session)
    entry_id = entry.id

    resp, code = _discard(user, {})
    assert code == 200
    assert TimeEntry.query.get(entry_id) is None


def test_discard_no_active_session_404(db_session):
    user = User.query.get(USER_ID)
    user.org_id = ORG
    db_session.flush()

    resp, code = _discard(user, {})
    assert code == 404
    assert resp.get_json()["status"] == 404


def test_discard_explicit_session_id_still_works(db_session):
    user = User.query.get(USER_ID)
    user.org_id = ORG
    entry = _active_entry(db_session)
    entry_id = entry.id

    resp, code = _discard(user, {"session_id": entry_id})
    assert code == 200
    assert TimeEntry.query.get(entry_id) is None
