"""
Unit tests for create_notification — the single emit SSOT.

Covers: always-create-the-bell-row, email no-op when SMTP unconfigured,
the per-(user, type) hourly email rate limit (does not error, both rows
persist), and unknown types still creating a row.
"""

from comms.database import Notification, db
from comms.notifications import create_notification
from comms.notifications.types import NotificationType


def test_creates_bell_row_always(app, make_identity):
    make_identity("auth0|alice", "org1")
    n = create_notification(
        user_id="auth0|alice",
        org_id="org1",
        type=NotificationType.PAYMENT_SENT,
        message="You were paid.",
    )
    assert n.id is not None
    rows = Notification.query.filter_by(user_id="auth0|alice").all()
    assert len(rows) == 1
    assert rows[0].type == NotificationType.PAYMENT_SENT
    assert rows[0].org_id == "org1"
    assert rows[0].is_read is False


def test_bell_row_created_even_without_identity(app):
    """No Identity projection yet — the bell row must still be created."""
    n = create_notification(
        user_id="auth0|ghost",
        org_id="org1",
        type=NotificationType.ASSIGNED_TO_PROJECT,
        message="Assigned.",
    )
    assert n.id is not None
    assert Notification.query.filter_by(user_id="auth0|ghost").count() == 1


def test_email_is_noop_when_smtp_unconfigured(app, make_identity):
    """SMTP creds are absent in the test env, so email send is a logged
    no-op — create_notification must still return the persisted row."""
    make_identity("auth0|alice", "org1", notify_payment_sent=True)
    n = create_notification(
        user_id="auth0|alice",
        org_id="org1",
        type=NotificationType.PAYMENT_SENT,
        message="Paid.",
        send_email=True,
    )
    assert n.id is not None
    assert Notification.query.filter_by(user_id="auth0|alice").count() == 1


def test_rate_limit_second_same_type_within_hour_no_error(app, make_identity):
    """Two notifications of the same (user, type) within the hour: the
    second must not error, and BOTH bell rows must exist (rate limit only
    suppresses the email, never the row)."""
    make_identity("auth0|alice", "org1", notify_payment_sent=True)

    n1 = create_notification(
        user_id="auth0|alice",
        org_id="org1",
        type=NotificationType.PAYMENT_SENT,
        message="Paid 1.",
        send_email=None,
    )
    n2 = create_notification(
        user_id="auth0|alice",
        org_id="org1",
        type=NotificationType.PAYMENT_SENT,
        message="Paid 2.",
        send_email=None,
    )
    assert n1.id is not None and n2.id is not None
    assert n1.id != n2.id
    assert (
        Notification.query.filter_by(
            user_id="auth0|alice", type=NotificationType.PAYMENT_SENT
        ).count()
        == 2
    )


def test_unknown_type_still_creates_row(app, make_identity):
    make_identity("auth0|alice", "org1")
    n = create_notification(
        user_id="auth0|alice",
        org_id="org1",
        type="totally_made_up_type",
        message="Mystery.",
    )
    assert n.id is not None
    rows = Notification.query.filter_by(user_id="auth0|alice").all()
    assert len(rows) == 1
    assert rows[0].type == "totally_made_up_type"


def test_commit_false_defers_persistence_until_caller_commits(app, make_identity):
    """Batch path uses commit=False; the row is flushed (has an id) and a
    later commit persists it."""
    make_identity("auth0|alice", "org1")
    n = create_notification(
        user_id="auth0|alice",
        org_id="org1",
        type=NotificationType.ANNOUNCEMENT,
        message="Heads up.",
        commit=False,
    )
    assert n.id is not None  # flush() assigned an id without committing
    db.session.commit()
    assert Notification.query.filter_by(user_id="auth0|alice").count() == 1


def test_email_spy_invoked_when_opted_in(app, make_identity, monkeypatch):
    """When send_email=True and the identity has an email, the mailer's
    send_notification_email is invoked exactly once."""
    calls = []

    from comms.email import mailer

    monkeypatch.setattr(
        mailer,
        "send_notification_email",
        lambda **kw: calls.append(kw),
    )
    make_identity("auth0|alice", "org1", email="alice@example.com")
    create_notification(
        user_id="auth0|alice",
        org_id="org1",
        type=NotificationType.PAYMENT_SENT,
        message="Paid.",
        send_email=True,
    )
    assert len(calls) == 1
    assert calls[0]["to"] == "alice@example.com"


def test_email_suppressed_for_second_within_hour_spy(app, make_identity, monkeypatch):
    """The rate limit suppresses the second email (send_email=None path),
    even though both bell rows are created."""
    calls = []
    from comms.email import mailer

    monkeypatch.setattr(
        mailer, "send_notification_email", lambda **kw: calls.append(kw)
    )
    make_identity(
        "auth0|alice", "org1", email="alice@example.com", notify_payment_sent=True
    )

    create_notification(
        user_id="auth0|alice",
        org_id="org1",
        type=NotificationType.PAYMENT_SENT,
        message="1",
        send_email=None,
    )
    create_notification(
        user_id="auth0|alice",
        org_id="org1",
        type=NotificationType.PAYMENT_SENT,
        message="2",
        send_email=None,
    )
    # First emailed, second suppressed by the hourly per-(user,type) limit.
    assert len(calls) == 1
    assert Notification.query.filter_by(user_id="auth0|alice").count() == 2
