"""
NotificationsAPI tests — self-scoped fetch / unread_count / mark_read /
preferences / update_preferences.

JWT validation is bypassed: we push a test_request_context with the JSON
body the view reads via request.get_json(), set flask.g.identity to a
persisted Identity, then invoke the MethodView method directly. (The
@requires_auth decorator only checks that g.identity is set.)
"""

from contextlib import contextmanager

from flask import g

from comms.database import Notification, NOTIFY_PREF_COLUMNS, db
from comms.notifications import create_notification
from comms.notifications.types import NotificationType
from comms.views.notifications import NotificationsAPI


@contextmanager
def as_user(app, identity, body=None):
    """Enter a request context posing as `identity` with an optional JSON body."""
    with app.test_request_context(
        "/notifications/fetch",
        method="POST",
        json=body if body is not None else {},
    ):
        g.identity = identity
        g.current_user = {"sub": identity.sub}
        yield


def _seed(user_id, org_id, n, type=NotificationType.PAYMENT_SENT):
    for i in range(n):
        create_notification(
            user_id=user_id, org_id=org_id, type=type, message=f"msg {i}"
        )


def test_fetch_only_returns_callers_own_org(app, make_identity):
    """Two orgs, two users. Caller must see only their own org's rows."""
    alice = make_identity("auth0|alice", "orgA")
    make_identity("auth0|bob", "orgB")

    _seed("auth0|alice", "orgA", 3)
    _seed("auth0|bob", "orgB", 2)
    # A stray row for alice's sub but a DIFFERENT org — must be filtered out.
    create_notification(
        user_id="auth0|alice",
        org_id="orgB",
        type=NotificationType.PAYMENT_SENT,
        message="cross-org leak?",
    )

    with as_user(app, alice, body={"limit": 50, "offset": 0}):
        resp, status = NotificationsAPI().fetch()
    assert status == 200
    payload = resp.get_json()
    assert payload["total"] == 3
    assert len(payload["notifications"]) == 3
    # None of them should carry org leakage — all belong to alice@orgA.
    # (org_id isn't in to_dict, so we assert count == own-org count.)
    assert (
        Notification.query.filter_by(user_id="auth0|alice", org_id="orgA").count() == 3
    )


def test_fetch_dispatch_via_post(app, make_identity):
    alice = make_identity("auth0|alice", "orgA")
    _seed("auth0|alice", "orgA", 2)
    with as_user(app, alice, body={"limit": 10}):
        resp, status = NotificationsAPI().post("fetch")
    assert status == 200
    assert resp.get_json()["total"] == 2


def test_fetch_pagination(app, make_identity):
    alice = make_identity("auth0|alice", "orgA")
    _seed("auth0|alice", "orgA", 5)
    with as_user(app, alice, body={"limit": 2, "offset": 0}):
        resp, _ = NotificationsAPI().fetch()
    payload = resp.get_json()
    assert payload["total"] == 5
    assert len(payload["notifications"]) == 2


def test_unread_count_scoped(app, make_identity):
    alice = make_identity("auth0|alice", "orgA")
    make_identity("auth0|bob", "orgB")
    _seed("auth0|alice", "orgA", 4)
    _seed("auth0|bob", "orgB", 7)

    with as_user(app, alice):
        resp, status = NotificationsAPI().unread_count()
    assert status == 200
    assert resp.get_json()["unread_count"] == 4


def test_mark_read_all(app, make_identity):
    alice = make_identity("auth0|alice", "orgA")
    _seed("auth0|alice", "orgA", 3)

    with as_user(app, alice, body={}):
        resp, status = NotificationsAPI().mark_read()
    assert status == 200
    assert resp.get_json()["updated"] == 3
    assert (
        Notification.query.filter_by(user_id="auth0|alice", is_read=False).count() == 0
    )


def test_mark_read_specific_ids(app, make_identity):
    alice = make_identity("auth0|alice", "orgA")
    _seed("auth0|alice", "orgA", 3)
    rows = (
        Notification.query.filter_by(user_id="auth0|alice")
        .order_by(Notification.id)
        .all()
    )
    target_ids = [rows[0].id, rows[1].id]

    with as_user(app, alice, body={"ids": target_ids}):
        resp, status = NotificationsAPI().mark_read()
    assert status == 200
    assert resp.get_json()["updated"] == 2
    # The third remains unread.
    assert (
        Notification.query.filter_by(user_id="auth0|alice", is_read=False).count() == 1
    )


def test_mark_read_does_not_touch_other_org(app, make_identity):
    alice = make_identity("auth0|alice", "orgA")
    make_identity("auth0|bob", "orgB")
    _seed("auth0|alice", "orgA", 2)
    _seed("auth0|bob", "orgB", 2)

    with as_user(app, alice, body={}):
        NotificationsAPI().mark_read()
    # Bob's notifications untouched.
    assert Notification.query.filter_by(user_id="auth0|bob", is_read=False).count() == 2


def test_preferences_returns_all_columns(app, make_identity):
    alice = make_identity("auth0|alice", "orgA")
    with as_user(app, alice):
        resp, status = NotificationsAPI().preferences()
    assert status == 200
    prefs = resp.get_json()["preferences"]
    assert set(prefs.keys()) == set(NOTIFY_PREF_COLUMNS)
    # Defaults are all True.
    assert all(v is True for v in prefs.values())


def test_update_preferences_flips_and_persists(app, make_identity):
    alice = make_identity("auth0|alice", "orgA")
    with as_user(app, alice, body={"preferences": {"notify_announcement": False}}):
        resp, status = NotificationsAPI().update_preferences()
    assert status == 200
    assert resp.get_json()["preferences"]["notify_announcement"] is False

    # Reload from the DB to confirm persistence.
    db.session.expire_all()
    reloaded = db.session.get(type(alice), "auth0|alice")
    assert reloaded.notify_announcement is False


def test_update_preferences_ignores_unknown_keys(app, make_identity):
    alice = make_identity("auth0|alice", "orgA")
    with as_user(app, alice, body={"preferences": {"not_a_real_pref": False}}):
        resp, status = NotificationsAPI().update_preferences()
    assert status == 200
    # Real prefs all remain at their True default.
    prefs = resp.get_json()["preferences"]
    assert all(v is True for v in prefs.values())


def test_unknown_path_404(app, make_identity):
    alice = make_identity("auth0|alice", "orgA")
    with as_user(app, alice):
        resp, status = NotificationsAPI().post("nope")
    assert status == 404
