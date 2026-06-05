"""
EmailAPI tests — admin-gated campaign create / list / preview.

The mailer's async send is monkeypatched to a spy so no real SMTP is
attempted, and we can assert on the resolved recipient list.

@requires_admin reads g.identity.is_admin (role org_admin+), so a "user"
role identity must get 403.
"""

from contextlib import contextmanager

from flask import g

from comms.database import EmailCampaign
from comms.views.email import EmailAPI


@contextmanager
def as_user(app, identity, body=None):
    with app.test_request_context(
        "/email/campaigns_create",
        method="POST",
        json=body if body is not None else {},
    ):
        g.identity = identity
        g.current_user = {"sub": identity.sub}
        yield


@contextmanager
def spy_mailer(monkeypatch):
    """Replace the async sends with spies; yield the captured-calls dict."""
    from comms.mail import mailer

    calls = {"campaign": [], "notification": []}
    monkeypatch.setattr(
        mailer,
        "send_campaign_async",
        lambda recipients, subject, body_html: calls["campaign"].append(
            (recipients, subject, body_html)
        ),
    )
    monkeypatch.setattr(
        mailer,
        "send_notification_email",
        lambda **kw: calls["notification"].append(kw),
    )
    yield calls


# ── authorization ────────────────────────────────────────────────


def test_non_admin_blocked_403(app, make_identity):
    """A role=user identity hitting the admin-decorated endpoint via the
    real decorator stack must get 403. We drive it through the registered
    URL rule using the view's dispatch so requires_admin actually runs."""
    user = make_identity("auth0|joe", "org1", role="user")
    view = EmailAPI.as_view("email_test")
    with app.test_request_context("/email/campaigns_list", method="POST", json={}):
        g.identity = user
        g.current_user = {"sub": user.sub}
        resp, status = view(path="campaigns_list")
    assert status == 403


def test_validator_also_blocked_403(app, make_identity):
    validator = make_identity("auth0|val", "org1", role="validator")
    view = EmailAPI.as_view("email_test2")
    with app.test_request_context("/email/campaigns_list", method="POST", json={}):
        g.identity = validator
        g.current_user = {"sub": validator.sub}
        resp, status = view(path="campaigns_list")
    assert status == 403


def test_org_admin_allowed(app, make_identity, monkeypatch):
    admin = make_identity("auth0|boss", "org1", role="org_admin")
    view = EmailAPI.as_view("email_test3")
    with app.test_request_context("/email/campaigns_list", method="POST", json={}):
        g.identity = admin
        g.current_user = {"sub": admin.sub}
        resp, status = view(path="campaigns_list")
    assert status == 200


# ── all_org recipient resolution ─────────────────────────────────


def test_all_org_create_resolves_recipients_from_identities(
    app, make_identity, monkeypatch
):
    admin = make_identity(
        "auth0|boss", "org1", role="org_admin", email="boss@example.com"
    )
    make_identity("auth0|a", "org1", email="a@example.com")
    make_identity("auth0|b", "org1", email="b@example.com")
    # Different org — must NOT be a recipient.
    make_identity("auth0|other", "org2", email="other@example.com")

    with spy_mailer(monkeypatch) as calls:
        with as_user(
            app,
            admin,
            body={
                "subject": "Hello org",
                "body_html": "<p>hi</p>",
                "audience": "all_org",
            },
        ):
            resp, status = EmailAPI().create()

    assert status == 200
    campaign = resp.get_json()["campaign"]
    # boss + a + b == 3 recipients in org1.
    assert campaign["recipient_count"] == 3

    assert len(calls["campaign"]) == 1
    recipients = calls["campaign"][0][0]
    assert set(recipients) == {"boss@example.com", "a@example.com", "b@example.com"}
    assert "other@example.com" not in recipients

    # Row persisted.
    assert EmailCampaign.query.filter_by(org_id="org1").count() == 1


def test_all_org_excludes_opted_out_unless_forced(app, make_identity, monkeypatch):
    admin = make_identity(
        "auth0|boss",
        "org1",
        role="org_admin",
        email="boss@example.com",
        notify_announcement=True,
    )
    make_identity("auth0|in", "org1", email="in@example.com", notify_announcement=True)
    make_identity(
        "auth0|out", "org1", email="out@example.com", notify_announcement=False
    )

    # Not forced — the opted-out identity is excluded.
    with spy_mailer(monkeypatch) as calls:
        with as_user(
            app,
            admin,
            body={
                "subject": "s",
                "body_html": "<p>b</p>",
                "audience": "all_org",
            },
        ):
            resp, status = EmailAPI().create()
    assert status == 200
    recipients = calls["campaign"][0][0]
    assert "out@example.com" not in recipients
    assert set(recipients) == {"boss@example.com", "in@example.com"}


def test_all_org_forced_includes_opted_out(app, make_identity, monkeypatch):
    admin = make_identity(
        "auth0|boss",
        "org1",
        role="org_admin",
        email="boss@example.com",
        notify_announcement=True,
    )
    make_identity(
        "auth0|out", "org1", email="out@example.com", notify_announcement=False
    )

    with spy_mailer(monkeypatch) as calls:
        with as_user(
            app,
            admin,
            body={
                "subject": "s",
                "body_html": "<p>b</p>",
                "audience": "all_org",
                "is_forced": True,
            },
        ):
            resp, status = EmailAPI().create()
    assert status == 200
    recipients = calls["campaign"][0][0]
    assert "out@example.com" in recipients
    assert resp.get_json()["campaign"]["is_forced"] is True


# ── team/region/custom require recipient_emails ──────────────────


def test_team_audience_requires_recipient_emails_400(app, make_identity, monkeypatch):
    admin = make_identity("auth0|boss", "org1", role="org_admin")
    with spy_mailer(monkeypatch):
        with as_user(
            app,
            admin,
            body={
                "subject": "s",
                "body_html": "<p>b</p>",
                "audience": "team:5",
            },
        ):
            resp, status = EmailAPI().create()
    assert status == 400


def test_custom_audience_with_recipient_emails(app, make_identity, monkeypatch):
    admin = make_identity("auth0|boss", "org1", role="org_admin")
    with spy_mailer(monkeypatch) as calls:
        with as_user(
            app,
            admin,
            body={
                "subject": "s",
                "body_html": "<p>b</p>",
                "audience": "custom",
                "recipient_emails": ["x@example.com", "y@example.com"],
            },
        ):
            resp, status = EmailAPI().create()
    assert status == 200
    assert resp.get_json()["campaign"]["recipient_count"] == 2
    assert set(calls["campaign"][0][0]) == {"x@example.com", "y@example.com"}


# ── validation ───────────────────────────────────────────────────


def test_create_missing_fields_400(app, make_identity, monkeypatch):
    admin = make_identity("auth0|boss", "org1", role="org_admin")
    with spy_mailer(monkeypatch):
        with as_user(app, admin, body={"subject": "", "body_html": "", "audience": ""}):
            resp, status = EmailAPI().create()
    assert status == 400


# ── list ─────────────────────────────────────────────────────────


def test_campaigns_list_returns_created(app, make_identity, monkeypatch):
    admin = make_identity(
        "auth0|boss", "org1", role="org_admin", email="boss@example.com"
    )
    with spy_mailer(monkeypatch):
        with as_user(
            app,
            admin,
            body={
                "subject": "Subject One",
                "body_html": "<p>b</p>",
                "audience": "all_org",
            },
        ):
            EmailAPI().create()

    with as_user(app, admin, body={}):
        resp, status = EmailAPI().list_campaigns()
    assert status == 200
    campaigns = resp.get_json()["campaigns"]
    assert len(campaigns) == 1
    assert campaigns[0]["subject"] == "Subject One"
    assert campaigns[0]["audience"] == "all_org"


def test_campaigns_list_scoped_to_org(app, make_identity, monkeypatch):
    admin1 = make_identity(
        "auth0|boss1", "org1", role="org_admin", email="b1@example.com"
    )
    admin2 = make_identity(
        "auth0|boss2", "org2", role="org_admin", email="b2@example.com"
    )
    with spy_mailer(monkeypatch):
        with as_user(
            app,
            admin1,
            body={
                "subject": "org1 blast",
                "body_html": "<p>b</p>",
                "audience": "all_org",
            },
        ):
            EmailAPI().create()

    # admin2 (org2) lists — should see zero.
    with as_user(app, admin2, body={}):
        resp, _ = EmailAPI().list_campaigns()
    assert resp.get_json()["campaigns"] == []


# ── preview ──────────────────────────────────────────────────────


def test_campaigns_preview_returns_html_and_count(app, make_identity, monkeypatch):
    admin = make_identity(
        "auth0|boss", "org1", role="org_admin", email="boss@example.com"
    )
    make_identity("auth0|a", "org1", email="a@example.com")

    with as_user(
        app,
        admin,
        body={
            "subject": "Preview me",
            "body_html": "<p>preview body</p>",
            "audience": "all_org",
        },
    ):
        resp, status = EmailAPI().preview()
    assert status == 200
    payload = resp.get_json()
    assert payload["html"]
    assert "Preview me" in payload["html"]
    # boss + a in org1.
    assert payload["recipient_count"] == 2
    # Preview must not persist a campaign.
    assert EmailCampaign.query.count() == 0
