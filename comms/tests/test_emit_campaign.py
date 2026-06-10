"""
EmitAPI campaign tests — HMAC server-to-server email-campaign endpoints.

These exercise the real signed request path through the `emit_post` fixture
(POST /emit/campaign and /emit/campaign_list). The mailer's async send is
monkeypatched to a spy so no SMTP is attempted and we can assert on the
resolved recipient list.

comms keeps ownership of the notify_announcement opt-out filter, campaign
persistence, and sending — the calling app supplies pre-resolved, pre-
authorized recipients.
"""

import pytest

from comms.database import EmailCampaign
from comms.mail import mailer


@pytest.fixture
def spy_send(monkeypatch):
    """Capture the recipient lists handed to the async campaign sender."""
    calls = []
    monkeypatch.setattr(
        mailer,
        "send_campaign_async",
        lambda recipients, subject, body_html: calls.append(recipients),
    )
    return calls


# ── happy path ────────────────────────────────────────────────────


def test_campaign_persists_and_sends(app, emit_post, spy_send):
    payload = {
        "org_id": "org1",
        "subject": "Hello team",
        "body_html": "<p>hi</p>",
        "audience": "team:5",
        "sent_by": "auth0|boss",
        "recipients": [
            {"sub": "auth0|a", "email": "a@example.com"},
            {"sub": "auth0|b", "email": "b@example.com"},
        ],
    }
    resp = emit_post("campaign", payload)
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["recipient_count"] == 2

    assert EmailCampaign.query.count() == 1
    assert len(spy_send) == 1
    assert set(spy_send[0]) == {"a@example.com", "b@example.com"}


def test_campaign_dedupes_recipients(app, emit_post, spy_send):
    payload = {
        "org_id": "org1",
        "subject": "s",
        "body_html": "<p>b</p>",
        "audience": "custom",
        "sent_by": "auth0|boss",
        "recipients": [
            {"sub": "auth0|a", "email": "dup@example.com"},
            {"sub": "auth0|b", "email": "dup@example.com"},
        ],
    }
    resp = emit_post("campaign", payload)
    assert resp.status_code == 200
    assert resp.get_json()["recipient_count"] == 1
    assert spy_send[0] == ["dup@example.com"]


# ── preference filter ─────────────────────────────────────────────


def test_pref_filter_excludes_opted_out(app, make_identity, emit_post, spy_send):
    make_identity("auth0|out", "org1", email="out@example.com",
                  notify_announcement=False)
    make_identity("auth0|in", "org1", email="in@example.com",
                  notify_announcement=True)
    payload = {
        "org_id": "org1",
        "subject": "s",
        "body_html": "<p>b</p>",
        "audience": "all_org",
        "sent_by": "auth0|boss",
        "recipients": [
            {"sub": "auth0|out", "email": "out@example.com"},
            {"sub": "auth0|in", "email": "in@example.com"},
        ],
    }
    resp = emit_post("campaign", payload)
    assert resp.status_code == 200
    assert resp.get_json()["recipient_count"] == 1
    assert spy_send[0] == ["in@example.com"]


def test_pref_filter_forced_includes_opted_out(
    app, make_identity, emit_post, spy_send
):
    make_identity("auth0|out", "org1", email="out@example.com",
                  notify_announcement=False)
    payload = {
        "org_id": "org1",
        "subject": "s",
        "body_html": "<p>b</p>",
        "audience": "all_org",
        "sent_by": "auth0|boss",
        "is_forced": True,
        "recipients": [{"sub": "auth0|out", "email": "out@example.com"}],
    }
    resp = emit_post("campaign", payload)
    assert resp.status_code == 200
    assert resp.get_json()["recipient_count"] == 1
    assert spy_send[0] == ["out@example.com"]
    assert resp.get_json()["campaign"]["is_forced"] is True


def test_default_allow_when_no_identity(app, emit_post, spy_send):
    # No Identity row for this sub — default-allow.
    payload = {
        "org_id": "org1",
        "subject": "s",
        "body_html": "<p>b</p>",
        "audience": "custom",
        "sent_by": "auth0|boss",
        "recipients": [{"sub": "auth0|nobody", "email": "nobody@example.com"}],
    }
    resp = emit_post("campaign", payload)
    assert resp.status_code == 200
    assert resp.get_json()["recipient_count"] == 1
    assert spy_send[0] == ["nobody@example.com"]


# ── validation ────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "drop",
    ["org_id", "subject", "body_html", "audience", "sent_by"],
)
def test_campaign_missing_required_field_400(app, emit_post, spy_send, drop):
    payload = {
        "org_id": "org1",
        "subject": "s",
        "body_html": "<p>b</p>",
        "audience": "custom",
        "sent_by": "auth0|boss",
        "recipients": [{"sub": "auth0|a", "email": "a@example.com"}],
    }
    payload.pop(drop)
    resp = emit_post("campaign", payload)
    assert resp.status_code == 400
    assert EmailCampaign.query.count() == 0


def test_campaign_empty_recipients_400(app, emit_post, spy_send):
    payload = {
        "org_id": "org1",
        "subject": "s",
        "body_html": "<p>b</p>",
        "audience": "custom",
        "sent_by": "auth0|boss",
        "recipients": [],
    }
    resp = emit_post("campaign", payload)
    assert resp.status_code == 400


def test_campaign_missing_recipients_400(app, emit_post, spy_send):
    payload = {
        "org_id": "org1",
        "subject": "s",
        "body_html": "<p>b</p>",
        "audience": "custom",
        "sent_by": "auth0|boss",
    }
    resp = emit_post("campaign", payload)
    assert resp.status_code == 400


# ── auth ──────────────────────────────────────────────────────────


def test_campaign_bad_signature_401(app, emit_post, spy_send):
    payload = {
        "org_id": "org1",
        "subject": "s",
        "body_html": "<p>b</p>",
        "audience": "custom",
        "sent_by": "auth0|boss",
        "recipients": [{"sub": "auth0|a", "email": "a@example.com"}],
    }
    resp = emit_post("campaign", payload, bad_signature=True)
    assert resp.status_code == 401


def test_campaign_no_signature_401(app, emit_post, spy_send):
    payload = {
        "org_id": "org1",
        "subject": "s",
        "body_html": "<p>b</p>",
        "audience": "custom",
        "sent_by": "auth0|boss",
        "recipients": [{"sub": "auth0|a", "email": "a@example.com"}],
    }
    resp = emit_post("campaign", payload, sign_with=None)
    assert resp.status_code == 401


# ── campaign_list ─────────────────────────────────────────────────


def _create(emit_post, sent_by, subject="s", org_id="org1"):
    return emit_post(
        "campaign",
        {
            "org_id": org_id,
            "subject": subject,
            "body_html": "<p>b</p>",
            "audience": "custom",
            "sent_by": sent_by,
            "recipients": [{"sub": "auth0|a", "email": "a@example.com"}],
        },
    )


def test_campaign_list_org_and_sender_scoping(
    app, make_identity, emit_post, spy_send
):
    make_identity("auth0|boss1", "org1", role="org_admin",
                  display_name="Boss One")
    # boss2 has no Identity row — its sent_by_name should resolve to None.
    _create(emit_post, "auth0|boss1", subject="one")
    _create(emit_post, "auth0|boss2", subject="two")

    # org-only: both campaigns.
    resp = emit_post("campaign_list", {"org_id": "org1"})
    assert resp.status_code == 200
    rows = resp.get_json()["campaigns"]
    assert len(rows) == 2

    # sent_by_name present, resolving to display_name when an Identity exists.
    by_sender = {r["sent_by"]: r["sent_by_name"] for r in rows}
    assert by_sender["auth0|boss1"] == "Boss One"
    assert by_sender["auth0|boss2"] is None

    # filtered by sender.
    resp = emit_post("campaign_list", {"org_id": "org1", "sent_by": "auth0|boss1"})
    rows = resp.get_json()["campaigns"]
    assert len(rows) == 1
    assert rows[0]["sent_by"] == "auth0|boss1"

    # cross-org: none.
    resp = emit_post("campaign_list", {"org_id": "org-other"})
    assert resp.get_json()["campaigns"] == []


def test_campaign_list_missing_org_400(app, emit_post):
    resp = emit_post("campaign_list", {})
    assert resp.status_code == 400
