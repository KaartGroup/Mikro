"""
MessagesAPI tests — DMs, group fanout, org broadcasts, threads, unread
watermark, and per-org self-scoping.

Same harness as test_notifications_api.py: JWT is bypassed by pushing a
test_request_context with the JSON body and setting flask.g.identity to a
persisted Identity, then invoking the MethodView method directly.

Email is never sent here — create_notification only emails when an Identity
has notify_message_received True AND a mailer is reachable; the mailer import
is monkeypatched to a no-op so a misconfigured mailer can't break the test.
"""

from contextlib import contextmanager

import pytest
from flask import g

from comms.database import Message, MessageRead, Notification, db
from comms.notifications.types import NotificationType
from comms.views.messages import MessagesAPI


@pytest.fixture(autouse=True)
def _no_email(monkeypatch):
    """Make every notification email a no-op regardless of prefs."""
    import comms.mail.mailer as mailer

    monkeypatch.setattr(
        mailer, "send_notification_email", lambda *a, **k: None, raising=False
    )


@contextmanager
def as_user(app, identity, body=None):
    with app.test_request_context(
        "/messages/send",
        method="POST",
        json=body if body is not None else {},
    ):
        g.identity = identity
        g.current_user = {"sub": identity.sub}
        yield


def _msg_notifs(user_id):
    return Notification.query.filter_by(
        user_id=user_id, type=NotificationType.MESSAGE_RECEIVED
    ).all()


def _spread_timestamps():
    """Rewrite every message's created_at to a strictly-increasing sequence.

    SQLite's now() server-default resolves to whole-second CURRENT_TIMESTAMP,
    so messages inserted within the same second tie — an artifact of the test
    DB, not production (Postgres now() is microsecond). Spread them by id so
    ordering / watermark tests reflect real distinct-timestamp behavior.
    """
    from datetime import datetime, timedelta

    base = datetime(2026, 1, 1, 0, 0, 0)
    for i, m in enumerate(Message.query.order_by(Message.id).all()):
        m.created_at = base + timedelta(seconds=i)
    db.session.commit()


# ─── DM send ──────────────────────────────────────────────────────


def test_dm_send_creates_message_and_notifies_peer(app, make_identity):
    alice = make_identity("auth0|alice", "orgA")
    make_identity("auth0|bob", "orgA")

    with as_user(
        app,
        alice,
        body={"target_type": "user", "target_user_id": "auth0|bob", "content": "hi"},
    ):
        resp, status = MessagesAPI().send()
    assert status == 200
    payload = resp.get_json()["message"]
    assert payload["sender_id"] == "auth0|alice"
    assert payload["target_user_id"] == "auth0|bob"
    assert payload["target_type"] == "user"

    assert Message.query.count() == 1
    # Peer got a MESSAGE_RECEIVED notification; sender did not.
    assert len(_msg_notifs("auth0|bob")) == 1
    assert len(_msg_notifs("auth0|alice")) == 0


def test_dm_cross_org_rejected(app, make_identity):
    alice = make_identity("auth0|alice", "orgA")
    make_identity("auth0|bob", "orgB")  # different org

    with as_user(
        app,
        alice,
        body={"target_type": "user", "target_user_id": "auth0|bob", "content": "hi"},
    ):
        resp, status = MessagesAPI().send()
    assert status == 403
    assert Message.query.count() == 0


def test_dm_unknown_peer_allowed(app, make_identity):
    # A recipient who hasn't signed into comms yet (no Identity row) can still
    # be DM'd — the message is stamped with the sender's org and only visible
    # in-org. They see it once they log in (Identity created) if same org.
    alice = make_identity("auth0|alice", "orgA")
    with as_user(
        app,
        alice,
        body={"target_type": "user", "target_user_id": "auth0|ghost", "content": "x"},
    ):
        resp, status = MessagesAPI().send()
    assert status == 200
    assert Message.query.count() == 1
    assert Message.query.first().org_id == "orgA"


def test_dm_self_rejected(app, make_identity):
    alice = make_identity("auth0|alice", "orgA")
    with as_user(
        app,
        alice,
        body={"target_type": "user", "target_user_id": "auth0|alice", "content": "x"},
    ):
        resp, status = MessagesAPI().send()
    assert status == 400


def test_send_requires_content(app, make_identity):
    alice = make_identity("auth0|alice", "orgA")
    make_identity("auth0|bob", "orgA")
    with as_user(
        app,
        alice,
        body={"target_type": "user", "target_user_id": "auth0|bob", "content": "  "},
    ):
        resp, status = MessagesAPI().send()
    assert status == 400


# ─── org broadcast ─────────────────────────────────────────────────


def test_org_broadcast_requires_admin(app, make_identity):
    alice = make_identity("auth0|alice", "orgA")  # plain user
    make_identity("auth0|bob", "orgA")
    with as_user(app, alice, body={"target_type": "org", "content": "all hands"}):
        resp, status = MessagesAPI().send()
    assert status == 403
    assert Message.query.count() == 0


def test_org_broadcast_admin_fans_out(app, make_identity):
    boss = make_identity("auth0|boss", "orgA", role="org_admin")
    make_identity("auth0|bob", "orgA")
    make_identity("auth0|carol", "orgA")
    make_identity("auth0|stranger", "orgB")  # other org — must NOT receive

    with as_user(app, boss, body={"target_type": "org", "content": "all hands"}):
        resp, status = MessagesAPI().send()
    assert status == 200
    assert Message.query.count() == 1
    # Both org members notified, sender excluded, other org excluded.
    assert len(_msg_notifs("auth0|bob")) == 1
    assert len(_msg_notifs("auth0|carol")) == 1
    assert len(_msg_notifs("auth0|boss")) == 0
    assert len(_msg_notifs("auth0|stranger")) == 0


# ─── group send ────────────────────────────────────────────────────


def test_group_send_fans_out_to_recipients(app, make_identity):
    alice = make_identity("auth0|alice", "orgA")
    make_identity("auth0|bob", "orgA")
    make_identity("auth0|carol", "orgA")

    with as_user(
        app,
        alice,
        body={
            "target_type": "group",
            "target_group_key": "team:5",
            "recipient_user_ids": ["auth0|bob", "auth0|carol", "auth0|alice"],
            "content": "standup at 9",
        },
    ):
        resp, status = MessagesAPI().send()
    assert status == 200
    msg = resp.get_json()["message"]
    assert msg["target_group_key"] == "team:5"
    assert msg["target_type"] == "group"
    # Recipients notified; sender (even if listed) excluded.
    assert len(_msg_notifs("auth0|bob")) == 1
    assert len(_msg_notifs("auth0|carol")) == 1
    assert len(_msg_notifs("auth0|alice")) == 0


def test_group_send_requires_recipients(app, make_identity):
    alice = make_identity("auth0|alice", "orgA")
    with as_user(
        app,
        alice,
        body={
            "target_type": "group",
            "target_group_key": "team:5",
            "recipient_user_ids": [],
            "content": "x",
        },
    ):
        resp, status = MessagesAPI().send()
    assert status == 400


def test_group_send_requires_group_key(app, make_identity):
    alice = make_identity("auth0|alice", "orgA")
    with as_user(
        app,
        alice,
        body={
            "target_type": "group",
            "recipient_user_ids": ["auth0|bob"],
            "content": "x",
        },
    ):
        resp, status = MessagesAPI().send()
    assert status == 400


# ─── thread ────────────────────────────────────────────────────────


def test_thread_returns_dm_both_directions(app, make_identity):
    alice = make_identity("auth0|alice", "orgA")
    bob = make_identity("auth0|bob", "orgA")

    with as_user(
        app,
        alice,
        body={"target_type": "user", "target_user_id": "auth0|bob", "content": "1"},
    ):
        MessagesAPI().send()
    with as_user(
        app,
        bob,
        body={"target_type": "user", "target_user_id": "auth0|alice", "content": "2"},
    ):
        MessagesAPI().send()
    with as_user(
        app,
        alice,
        body={"target_type": "user", "target_user_id": "auth0|bob", "content": "3"},
    ):
        MessagesAPI().send()

    _spread_timestamps()
    with as_user(app, alice, body={"scope_type": "user", "scope_key": "auth0|bob"}):
        resp, status = MessagesAPI().thread()
    assert status == 200
    payload = resp.get_json()
    assert payload["total"] == 3
    # Oldest-first window.
    assert [m["content"] for m in payload["messages"]] == ["1", "2", "3"]


def test_thread_org_scope(app, make_identity):
    boss = make_identity("auth0|boss", "orgA", role="org_admin")
    make_identity("auth0|bob", "orgA")
    with as_user(app, boss, body={"target_type": "org", "content": "hello org"}):
        MessagesAPI().send()

    # Bob (a plain member) can read the org thread.
    bob = make_identity("auth0|bob2", "orgA")
    with as_user(app, bob, body={"scope_type": "org", "scope_key": "orgA"}):
        resp, status = MessagesAPI().thread()
    assert status == 200
    assert resp.get_json()["total"] == 1


def test_thread_requires_scope(app, make_identity):
    alice = make_identity("auth0|alice", "orgA")
    with as_user(app, alice, body={"scope_type": "user"}):
        resp, status = MessagesAPI().thread()
    assert status == 400


# ─── unread + mark_read watermark ──────────────────────────────────


def test_unread_count_and_mark_read(app, make_identity):
    alice = make_identity("auth0|alice", "orgA")
    bob = make_identity("auth0|bob", "orgA")

    # Bob sends two DMs to Alice.
    for c in ("a", "b"):
        with as_user(
            app,
            bob,
            body={"target_type": "user", "target_user_id": "auth0|alice", "content": c},
        ):
            MessagesAPI().send()
    _spread_timestamps()

    # Alice has 2 unread.
    with as_user(app, alice, body={}):
        resp, status = MessagesAPI().unread_count()
    assert status == 200
    assert resp.get_json()["unread_count"] == 2

    # Alice marks the DM scope read (watermark = latest message's created_at).
    with as_user(app, alice, body={"scope_type": "user", "scope_key": "auth0|bob"}):
        resp, status = MessagesAPI().mark_read()
    assert status == 200
    assert MessageRead.query.filter_by(user_id="auth0|alice").count() == 1

    # Now 0 unread.
    with as_user(app, alice, body={}):
        resp, _ = MessagesAPI().unread_count()
    assert resp.get_json()["unread_count"] == 0

    # A new (strictly-later) message from Bob bumps it back to 1.
    with as_user(
        app,
        bob,
        body={"target_type": "user", "target_user_id": "auth0|alice", "content": "c"},
    ):
        MessagesAPI().send()
    _spread_timestamps()
    with as_user(app, alice, body={}):
        resp, _ = MessagesAPI().unread_count()
    assert resp.get_json()["unread_count"] == 1


def test_unread_excludes_own_messages(app, make_identity):
    alice = make_identity("auth0|alice", "orgA")
    make_identity("auth0|bob", "orgA")
    # Alice sends; her own messages are never unread for herself.
    with as_user(
        app,
        alice,
        body={"target_type": "user", "target_user_id": "auth0|bob", "content": "x"},
    ):
        MessagesAPI().send()
    with as_user(app, alice, body={}):
        resp, _ = MessagesAPI().unread_count()
    assert resp.get_json()["unread_count"] == 0


def test_unread_group_only_when_passed(app, make_identity):
    alice = make_identity("auth0|alice", "orgA")
    bob = make_identity("auth0|bob", "orgA")
    # Bob sends a group message that includes Alice.
    with as_user(
        app,
        bob,
        body={
            "target_type": "group",
            "target_group_key": "team:5",
            "recipient_user_ids": ["auth0|alice"],
            "content": "g",
        },
    ):
        MessagesAPI().send()

    # Without passing the group_key, group unread is not counted.
    with as_user(app, alice, body={}):
        resp, _ = MessagesAPI().unread_count()
    assert resp.get_json()["unread_count"] == 0

    # Passing it surfaces the unread.
    with as_user(app, alice, body={"group_keys": ["team:5"]}):
        resp, _ = MessagesAPI().unread_count()
    assert resp.get_json()["unread_count"] == 1


# ─── conversations ─────────────────────────────────────────────────


def test_conversations_lists_dm_group_and_org(app, make_identity):
    alice = make_identity("auth0|alice", "orgA")
    bob = make_identity("auth0|bob", "orgA")
    with as_user(
        app,
        alice,
        body={"target_type": "user", "target_user_id": "auth0|bob", "content": "hi"},
    ):
        MessagesAPI().send()
    with as_user(
        app,
        bob,
        body={
            "target_type": "group",
            "target_group_key": "team:5",
            "recipient_user_ids": ["auth0|alice"],
            "content": "g",
        },
    ):
        MessagesAPI().send()

    with as_user(app, alice, body={"group_keys": ["team:5"]}):
        resp, status = MessagesAPI().conversations()
    assert status == 200
    convos = resp.get_json()["conversations"]
    scopes = {(c["scope_type"], c["scope_key"]) for c in convos}
    assert ("user", "auth0|bob") in scopes
    assert ("group", "team:5") in scopes
    assert ("org", "orgA") in scopes
    # The group convo carries an unread for alice (bob sent it).
    group = next(c for c in convos if c["scope_type"] == "group")
    assert group["unread_count"] == 1


# ─── self-scoping / per-org siloing ────────────────────────────────


def test_thread_cannot_read_other_orgs_messages(app, make_identity):
    # Two boss/admins in different orgs each broadcast to their org.
    boss_a = make_identity("auth0|bossA", "orgA", role="org_admin")
    boss_b = make_identity("auth0|bossB", "orgB", role="org_admin")
    with as_user(app, boss_a, body={"target_type": "org", "content": "A only"}):
        MessagesAPI().send()
    with as_user(app, boss_b, body={"target_type": "org", "content": "B only"}):
        MessagesAPI().send()

    # An orgA user reading the org thread sees ONLY orgA's message.
    alice = make_identity("auth0|alice", "orgA")
    with as_user(app, alice, body={"scope_type": "org", "scope_key": "orgA"}):
        resp, _ = MessagesAPI().thread()
    payload = resp.get_json()
    assert payload["total"] == 1
    assert payload["messages"][0]["content"] == "A only"


def test_conversations_never_leak_sub_in_label(app, make_identity):
    # A peer with no Identity (never signed into comms) must NOT have their
    # raw sub echoed back as a human-facing label — it comes back null, and
    # the calling app resolves the name from its own directory.
    alice = make_identity("auth0|alice", "orgA")
    with as_user(
        app,
        alice,
        body={"target_type": "user", "target_user_id": "auth0|ghost", "content": "x"},
    ):
        MessagesAPI().send()
    with as_user(app, alice, body={}):
        resp, status = MessagesAPI().conversations()
    assert status == 200
    dm = next(
        c
        for c in resp.get_json()["conversations"]
        if c["scope_type"] == "user" and c["scope_key"] == "auth0|ghost"
    )
    assert dm["label"] is None
    assert dm["scope_key"] == "auth0|ghost"  # routing key still present


# ─── delete message ────────────────────────────────────────────────


def test_delete_message_sender_can_delete_own(app, make_identity):
    alice = make_identity("auth0|alice", "orgA")
    make_identity("auth0|bob", "orgA")
    with as_user(
        app,
        alice,
        body={"target_type": "user", "target_user_id": "auth0|bob", "content": "oops"},
    ):
        resp, _ = MessagesAPI().send()
    mid = resp.get_json()["message"]["id"]

    with as_user(app, alice, body={"message_id": mid}):
        resp, status = MessagesAPI().delete_message()
    assert status == 200
    assert Message.query.count() == 0


def test_delete_message_other_user_forbidden(app, make_identity):
    alice = make_identity("auth0|alice", "orgA")
    bob = make_identity("auth0|bob", "orgA")
    with as_user(
        app,
        alice,
        body={"target_type": "user", "target_user_id": "auth0|bob", "content": "hi"},
    ):
        resp, _ = MessagesAPI().send()
    mid = resp.get_json()["message"]["id"]

    # Bob is the recipient, not an admin — cannot delete Alice's message.
    with as_user(app, bob, body={"message_id": mid}):
        resp, status = MessagesAPI().delete_message()
    assert status == 403
    assert Message.query.count() == 1


def test_delete_message_admin_can_delete_any(app, make_identity):
    alice = make_identity("auth0|alice", "orgA")
    make_identity("auth0|bob", "orgA")
    boss = make_identity("auth0|boss", "orgA", role="org_admin")
    with as_user(
        app,
        alice,
        body={"target_type": "user", "target_user_id": "auth0|bob", "content": "hi"},
    ):
        resp, _ = MessagesAPI().send()
    mid = resp.get_json()["message"]["id"]

    with as_user(app, boss, body={"message_id": mid}):
        resp, status = MessagesAPI().delete_message()
    assert status == 200
    assert Message.query.count() == 0


def test_delete_message_cross_org_404(app, make_identity):
    alice = make_identity("auth0|alice", "orgA")
    make_identity("auth0|bob", "orgA")
    with as_user(
        app,
        alice,
        body={"target_type": "user", "target_user_id": "auth0|bob", "content": "hi"},
    ):
        resp, _ = MessagesAPI().send()
    mid = resp.get_json()["message"]["id"]

    # An admin in another org can't even see it exists.
    boss_b = make_identity("auth0|bossB", "orgB", role="org_admin")
    with as_user(app, boss_b, body={"message_id": mid}):
        resp, status = MessagesAPI().delete_message()
    assert status == 404
    assert Message.query.count() == 1


def test_delete_message_requires_id(app, make_identity):
    alice = make_identity("auth0|alice", "orgA")
    with as_user(app, alice, body={}):
        resp, status = MessagesAPI().delete_message()
    assert status == 400


# ─── delete conversation ───────────────────────────────────────────


def test_delete_conversation_admin_deletes_dm_and_watermarks(app, make_identity):
    boss = make_identity("auth0|boss", "orgA", role="org_admin")
    bob = make_identity("auth0|bob", "orgA")
    # Two-way DM between boss and bob.
    with as_user(
        app,
        boss,
        body={"target_type": "user", "target_user_id": "auth0|bob", "content": "1"},
    ):
        MessagesAPI().send()
    with as_user(
        app,
        bob,
        body={"target_type": "user", "target_user_id": "auth0|boss", "content": "2"},
    ):
        MessagesAPI().send()
    # Both mark read, creating watermarks on each side.
    with as_user(app, boss, body={"scope_type": "user", "scope_key": "auth0|bob"}):
        MessagesAPI().mark_read()
    with as_user(app, bob, body={"scope_type": "user", "scope_key": "auth0|boss"}):
        MessagesAPI().mark_read()
    assert Message.query.count() == 2
    assert MessageRead.query.count() == 2

    with as_user(app, boss, body={"scope_type": "user", "scope_key": "auth0|bob"}):
        resp, status = MessagesAPI().delete_conversation()
    assert status == 200
    assert resp.get_json()["deleted"] == 2
    assert Message.query.count() == 0
    # Both directions' watermarks cleared.
    assert MessageRead.query.count() == 0


def test_delete_conversation_non_admin_forbidden(app, make_identity):
    alice = make_identity("auth0|alice", "orgA")
    make_identity("auth0|bob", "orgA")
    with as_user(
        app,
        alice,
        body={"target_type": "user", "target_user_id": "auth0|bob", "content": "hi"},
    ):
        MessagesAPI().send()
    with as_user(app, alice, body={"scope_type": "user", "scope_key": "auth0|bob"}):
        resp, status = MessagesAPI().delete_conversation()
    assert status == 403
    assert Message.query.count() == 1


def test_delete_conversation_org_scope(app, make_identity):
    boss = make_identity("auth0|boss", "orgA", role="org_admin")
    make_identity("auth0|bob", "orgA")
    with as_user(app, boss, body={"target_type": "org", "content": "all hands"}):
        MessagesAPI().send()
    assert Message.query.count() == 1

    with as_user(app, boss, body={"scope_type": "org", "scope_key": "orgA"}):
        resp, status = MessagesAPI().delete_conversation()
    assert status == 200
    assert Message.query.count() == 0


def test_delete_conversation_org_scoped_to_caller_org(app, make_identity):
    # An admin deleting their org broadcast must not touch another org's.
    boss_a = make_identity("auth0|bossA", "orgA", role="org_admin")
    boss_b = make_identity("auth0|bossB", "orgB", role="org_admin")
    with as_user(app, boss_a, body={"target_type": "org", "content": "A"}):
        MessagesAPI().send()
    with as_user(app, boss_b, body={"target_type": "org", "content": "B"}):
        MessagesAPI().send()

    with as_user(app, boss_a, body={"scope_type": "org", "scope_key": "orgA"}):
        MessagesAPI().delete_conversation()
    # orgB's broadcast survives.
    assert Message.query.count() == 1
    assert Message.query.first().org_id == "orgB"


def test_dispatch_unknown_path_404(app, make_identity):
    alice = make_identity("auth0|alice", "orgA")
    with as_user(app, alice):
        resp, status = MessagesAPI().post("nope")
    assert status == 404
