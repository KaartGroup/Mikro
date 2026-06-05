"""
HMAC-gated /emit endpoint tests.

These go through the real WSGI stack via test_client so the HMAC verification
and before_request short-circuit (paths under /emit skip JWT) are exercised
end-to-end. The signature is computed over the EXACT bytes sent.
"""

import json

from comms.database import Notification
from comms.notifications.types import NotificationType


def test_emit_notify_valid_signature_creates_row(app, emit_post):
    payload = {
        "user_id": "auth0|alice",
        "org_id": "org1",
        "type": NotificationType.ENTRY_ADJUSTED,
        "message": "Your entry was adjusted.",
    }
    resp = emit_post("notify", payload)
    assert resp.status_code == 200
    body = resp.get_json()
    assert "id" in body and body["id"] is not None

    rows = Notification.query.filter_by(user_id="auth0|alice").all()
    assert len(rows) == 1
    assert rows[0].id == body["id"]
    assert rows[0].type == NotificationType.ENTRY_ADJUSTED


def test_emit_notify_passes_optional_fields(app, emit_post):
    payload = {
        "user_id": "auth0|alice",
        "org_id": "org1",
        "type": NotificationType.ENTRY_ADJUSTED,
        "message": "adj",
        "link": "/time/123",
        "actor_id": "auth0|boss",
        "entity_type": "time_entry",
        "entity_id": 123,
    }
    resp = emit_post("notify", payload)
    assert resp.status_code == 200
    row = Notification.query.filter_by(user_id="auth0|alice").one()
    assert row.link == "/time/123"
    assert row.actor_id == "auth0|boss"
    assert row.entity_type == "time_entry"
    assert row.entity_id == 123


def test_emit_notify_missing_required_field_400(app, emit_post):
    # Missing "message".
    payload = {"user_id": "auth0|alice", "org_id": "org1", "type": "x"}
    resp = emit_post("notify", payload)
    assert resp.status_code == 400
    assert "message" in resp.get_json()["message"].lower()
    assert Notification.query.count() == 0


def test_emit_notify_missing_signature_401(app, emit_post):
    payload = {
        "user_id": "auth0|alice",
        "org_id": "org1",
        "type": "x",
        "message": "m",
    }
    resp = emit_post("notify", payload, sign_with=None)
    assert resp.status_code == 401
    assert Notification.query.count() == 0


def test_emit_notify_bad_signature_401(app, emit_post):
    payload = {
        "user_id": "auth0|alice",
        "org_id": "org1",
        "type": "x",
        "message": "m",
    }
    resp = emit_post("notify", payload, bad_signature=True)
    assert resp.status_code == 401
    assert Notification.query.count() == 0


def test_emit_signature_must_cover_exact_bytes(app, client):
    """A signature over different bytes than those sent is rejected — proves
    verify_hmac signs the raw body, not a re-serialized copy."""
    sent = json.dumps({"user_id": "a", "org_id": "o", "type": "t", "message": "m"})
    other = json.dumps({"user_id": "b", "org_id": "o", "type": "t", "message": "m"})
    import hashlib
    import hmac as _hmac

    sig = _hmac.new(b"testsecret", other.encode(), hashlib.sha256).hexdigest()
    resp = client.post(
        "/emit/notify",
        data=sent,
        headers={"X-Comms-Signature": sig, "Content-Type": "application/json"},
    )
    assert resp.status_code == 401


def test_emit_unknown_path_404(app, emit_post):
    resp = emit_post("does_not_exist", {"foo": "bar"})
    assert resp.status_code == 404


def test_emit_notify_batch_fans_out(app, emit_post):
    subs = ["auth0|a", "auth0|b", "auth0|c"]
    payload = {
        "user_ids": subs,
        "org_id": "org1",
        "type": NotificationType.ANNOUNCEMENT,
        "message": "Org-wide heads up.",
    }
    resp = emit_post("notify_batch", payload)
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["count"] == 3
    assert len(body["ids"]) == 3

    # One row per recipient.
    for sub in subs:
        assert Notification.query.filter_by(user_id=sub).count() == 1
    assert Notification.query.filter_by(type=NotificationType.ANNOUNCEMENT).count() == 3


def test_emit_notify_batch_empty_list_400(app, emit_post):
    payload = {
        "user_ids": [],
        "org_id": "org1",
        "type": "x",
        "message": "m",
    }
    resp = emit_post("notify_batch", payload)
    assert resp.status_code == 400
    assert Notification.query.count() == 0


def test_emit_notify_batch_missing_field_400(app, emit_post):
    # Missing "type".
    payload = {"user_ids": ["auth0|a"], "org_id": "org1", "message": "m"}
    resp = emit_post("notify_batch", payload)
    assert resp.status_code == 400
    assert Notification.query.count() == 0
