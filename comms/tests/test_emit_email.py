"""
EmitAPI /emit/email tests — one-off direct email (no EmailCampaign persisted).

Driven through the real signed HMAC path via the `emit_post` fixture. SMTP is
monkeypatched to a spy so nothing is actually sent.
"""

from comms.database import EmailCampaign


def _spy_mailer(monkeypatch):
    calls = []

    def fake_send_email(to, subject, html_body, **kw):
        calls.append((to, subject, html_body))
        return True

    import comms.mail.mailer as mailer

    monkeypatch.setattr(mailer, "send_email", fake_send_email)
    return calls


def test_email_sends_to_single_address(app, emit_post, monkeypatch):
    calls = _spy_mailer(monkeypatch)
    resp = emit_post(
        "email",
        {"to": "dev@kaart.com", "subject": "[Mikro] hi", "body_html": "<p>x</p>"},
    )
    assert resp.status_code == 200
    assert resp.get_json()["sent"] == 1
    assert calls == [("dev@kaart.com", "[Mikro] hi", "<p>x</p>")]
    # Direct email must NOT create a campaign row.
    assert EmailCampaign.query.count() == 0


def test_email_sends_to_list(app, emit_post, monkeypatch):
    calls = _spy_mailer(monkeypatch)
    resp = emit_post(
        "email",
        {
            "to": ["a@kaart.com", "b@kaart.com"],
            "subject": "s",
            "body_html": "<p>b</p>",
        },
    )
    assert resp.status_code == 200
    assert resp.get_json()["sent"] == 2
    assert {c[0] for c in calls} == {"a@kaart.com", "b@kaart.com"}


def test_email_missing_fields_400(app, emit_post, monkeypatch):
    _spy_mailer(monkeypatch)
    for payload in (
        {"subject": "s", "body_html": "<p>b</p>"},  # no to
        {"to": "d@kaart.com", "body_html": "<p>b</p>"},  # no subject
        {"to": "d@kaart.com", "subject": "s"},  # no body
    ):
        resp = emit_post("email", payload)
        assert resp.status_code == 400


def test_email_bad_signature_401(app, emit_post, monkeypatch):
    _spy_mailer(monkeypatch)
    resp = emit_post(
        "email",
        {"to": "d@kaart.com", "subject": "s", "body_html": "<p>b</p>"},
        bad_signature=True,
    )
    assert resp.status_code == 401
