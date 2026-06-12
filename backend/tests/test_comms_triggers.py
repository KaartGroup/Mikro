"""
Tests for the comms client and every wired notification trigger.

Two layers, both DB-free (mock SQLAlchemy queries / models, matching the
style of test_subcategories.py and test_team_scoping.py — no PostgreSQL,
no network):

  1. api.comms_client unit tests — HMAC signature, fire-and-forget
     dispatch, fail-safe (never raises), and no-op when unconfigured.

  2. Trigger tests — for each wired call site (TimeTracking, Transactions,
     Users) we monkeypatch the model queries the handler touches and a spy
     over comms_client.emit / emit_batch, then assert the handler fires the
     right notification `type` to the right recipient(s).

The spies replace comms_client.emit / emit_batch wholesale, so no thread is
spawned and no HTTP request is made.
"""

import hashlib
import hmac
import json
from unittest.mock import MagicMock, patch

from flask import g

from app import app
import api.comms_client as comms_client
from api.comms_client import NotificationType

# ─── Fakes ──────────────────────────────────────────────────────


class _FakeUser:
    def __init__(self, id, role="admin", org_id="kaart-org", **kw):
        self.id = id
        self.role = role
        self.org_id = org_id
        self.is_active = True
        self.email = kw.get("email", f"{id}@x.test")
        self.first_name = kw.get("first_name", "Test")
        self.last_name = kw.get("last_name", "User")
        self.osm_username = kw.get("osm_username")
        self.hourly_rate = kw.get("hourly_rate", 10.0)
        self.payment_email = kw.get("payment_email")

    @property
    def full_name(self):
        return f"{self.first_name} {self.last_name}".strip()

    def update(self, **kw):
        for k, v in kw.items():
            setattr(self, k, v)


class _FakeEntry:
    def __init__(
        self,
        id=1,
        user_id="auth0|owner",
        org_id="kaart-org",
        status="active",
        activity="mapping",
    ):
        self.id = id
        self.user_id = user_id
        self.org_id = org_id
        self.status = status
        # Tier-1 activity slug (renamed from `category` in current master).
        self.activity = activity
        self.notes = None
        self.clock_in = None
        self.clock_out = None
        self.duration_seconds = 0
        self.changeset_count = 0
        self.changes_count = 0
        self.force_clocked_out_by = None
        self.voided_by = None
        self.voided_at = None

    def save(self):
        pass


# ─── comms_client unit tests ─────────────────────────────────────


def test_sign_matches_comms_hmac_contract():
    secret = "shhh"
    body = json.dumps({"a": 1}).encode("utf-8")
    expected = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    assert comms_client._sign(secret, body) == expected


def test_post_noops_when_unconfigured():
    """No COMMS_URL / secret → no thread, no requests call, no raise."""
    with app.app_context():
        app.config["COMMS_URL"] = None
        app.config["COMMS_WEBHOOK_SECRET"] = None
        with patch("api.comms_client.threading.Thread") as thread_cls, patch(
            "api.comms_client.requests.post"
        ) as post:
            comms_client._post("notify", {"x": 1})
            thread_cls.assert_not_called()
            post.assert_not_called()


def test_post_signs_and_posts_when_configured():
    """Configured → posts to {url}/emit/notify with a correct signature over
    the exact raw body. We run the daemon worker inline by stubbing Thread."""
    sent = {}

    def _fake_post(url, data=None, headers=None, timeout=None):
        sent["url"] = url
        sent["data"] = data
        sent["headers"] = headers
        sent["timeout"] = timeout
        resp = MagicMock()
        resp.status_code = 200
        return resp

    class _InlineThread:
        def __init__(self, target=None, args=(), daemon=None):
            self._target = target
            self._args = args

        def start(self):
            self._target(*self._args)

    with app.app_context():
        app.config["COMMS_URL"] = "https://comms.test"
        app.config["COMMS_WEBHOOK_SECRET"] = "topsecret"
        with patch("api.comms_client.threading.Thread", _InlineThread), patch(
            "api.comms_client.requests.post", _fake_post
        ):
            comms_client.emit(
                user_id="auth0|u1",
                org_id="kaart-org",
                type=NotificationType.PAYMENT_SENT,
                message="paid",
            )

    assert sent["url"] == "https://comms.test/emit/notify"
    assert sent["timeout"] == comms_client._TIMEOUT_SECONDS
    # Signature must be HMAC-SHA256 over the EXACT raw bytes posted.
    expected_sig = hmac.new(b"topsecret", sent["data"], hashlib.sha256).hexdigest()
    assert sent["headers"]["X-Comms-Signature"] == expected_sig
    body = json.loads(sent["data"])
    assert body["type"] == NotificationType.PAYMENT_SENT
    assert body["user_id"] == "auth0|u1"
    assert body["org_id"] == "kaart-org"


def test_emit_batch_posts_to_notify_batch_with_user_ids():
    captured = {}

    class _InlineThread:
        def __init__(self, target=None, args=(), daemon=None):
            self._target, self._args = target, args

        def start(self):
            self._target(*self._args)

    def _fake_post(url, data=None, headers=None, timeout=None):
        captured["url"] = url
        captured["body"] = json.loads(data)
        resp = MagicMock()
        resp.status_code = 200
        return resp

    with app.app_context():
        app.config["COMMS_URL"] = "https://comms.test"
        app.config["COMMS_WEBHOOK_SECRET"] = "topsecret"
        with patch("api.comms_client.threading.Thread", _InlineThread), patch(
            "api.comms_client.requests.post", _fake_post
        ):
            comms_client.emit_batch(
                user_ids=["auth0|a", "auth0|b"],
                org_id="kaart-org",
                type=NotificationType.ADJUSTMENT_REQUESTED,
                message="review please",
            )

    assert captured["url"] == "https://comms.test/emit/notify_batch"
    assert captured["body"]["user_ids"] == ["auth0|a", "auth0|b"]
    assert captured["body"]["type"] == NotificationType.ADJUSTMENT_REQUESTED


def test_emit_batch_noops_on_empty_recipients():
    with app.app_context():
        app.config["COMMS_URL"] = "https://comms.test"
        app.config["COMMS_WEBHOOK_SECRET"] = "topsecret"
        with patch("api.comms_client.threading.Thread") as thread_cls:
            comms_client.emit_batch(
                user_ids=[],
                org_id="kaart-org",
                type=NotificationType.BANK_INFO_CHANGED,
                message="x",
            )
            thread_cls.assert_not_called()


def test_emit_is_failsafe_never_raises():
    """Even if the underlying dispatch blows up, emit() must swallow it."""
    with app.app_context():
        app.config["COMMS_URL"] = "https://comms.test"
        app.config["COMMS_WEBHOOK_SECRET"] = "topsecret"
        with patch("api.comms_client._post", side_effect=RuntimeError("boom")):
            # Must not raise.
            comms_client.emit(
                user_id="auth0|u1",
                org_id="kaart-org",
                type=NotificationType.PAYMENT_SENT,
                message="paid",
            )


# ─── Trigger tests ───────────────────────────────────────────────


def _admin():
    return _FakeUser("auth0|admin", role="admin", org_id="kaart-org")


def test_request_adjustment_notifies_org_admins():
    from api.views.TimeTracking import TimeTrackingAPI

    entry = _FakeEntry(id=42, user_id="auth0|admin", status="active")
    admins = [
        _FakeUser("auth0|admin", role="admin"),
        _FakeUser("auth0|other-admin", role="admin"),
    ]

    with app.test_request_context(json={"entry_id": 42, "reason": "wrong hours"}):
        g.user = _admin()
        with patch("api.views.TimeTracking.TimeEntry") as TE, patch(
            "api.views.TimeTracking.org_admin_users", return_value=admins
        ), patch("api.views.TimeTracking.comms_client") as spy:
            TE.query.filter_by.return_value.first.return_value = entry
            resp, code = TimeTrackingAPI().request_adjustment()

    assert code == 200
    spy.emit_batch.assert_called_once()
    kwargs = spy.emit_batch.call_args.kwargs
    assert kwargs["type"] == NotificationType.ADJUSTMENT_REQUESTED
    assert kwargs["link"] == "/admin/time"
    assert set(kwargs["user_ids"]) == {"auth0|admin", "auth0|other-admin"}
    assert kwargs["actor_id"] == "auth0|admin"


def test_force_clock_out_notifies_session_owner():
    import datetime
    from api.views.TimeTracking import TimeTrackingAPI

    entry = _FakeEntry(id=7, user_id="auth0|owner", status="active", activity="mapping")
    entry.clock_in = datetime.datetime(2026, 6, 1, 12, 0, 0)

    with app.test_request_context(json={"session_id": 7}):
        g.user = _admin()
        with patch("api.views.TimeTracking.TimeEntry") as TE, patch(
            "api.views.TimeTracking.TimeEntryService"
        ) as Svc, patch(
            "api.views.TimeTracking.is_org_admin_or_above", return_value=True
        ), patch(
            "api.views.TimeTracking.TimeTrackingHelpers"
        ) as H, patch(
            "api.views.TimeTracking.comms_client"
        ) as spy:
            # The view fetches the active entry for the access check, then
            # delegates the mutation to TimeEntryService (which owns the
            # clock-out + changeset fetch and returns the closed entry).
            TE.query.filter_by.return_value.first.return_value = entry
            Svc.return_value.clock_out.return_value = entry
            H._format_entry.return_value = {}
            resp, code = TimeTrackingAPI().admin_force_clock_out()

    assert code == 200
    spy.emit.assert_called_once()
    kwargs = spy.emit.call_args.kwargs
    assert kwargs["type"] == NotificationType.ENTRY_FORCE_CLOSED
    assert kwargs["user_id"] == "auth0|owner"
    assert kwargs["org_id"] == "kaart-org"
    assert kwargs["actor_id"] == "auth0|admin"


def test_void_entry_notifies_owner():
    from api.views.TimeTracking import TimeTrackingAPI

    entry = _FakeEntry(id=9, user_id="auth0|owner", status="completed")

    with app.test_request_context(json={"entry_id": 9}):
        g.user = _admin()
        with patch("api.views.TimeTracking.TimeEntry") as TE, patch(
            "api.views.TimeTracking.TimeEntryService"
        ) as Svc, patch(
            "api.views.TimeTracking.is_org_admin_or_above", return_value=True
        ), patch(
            "api.views.TimeTracking.TimeTrackingHelpers"
        ) as H, patch(
            "api.views.TimeTracking.comms_client"
        ) as spy:
            # View fetches the entry for the access/already-voided checks,
            # then delegates the void mutation to TimeEntryService.
            TE.query.filter_by.return_value.first.return_value = entry
            Svc.return_value.void.return_value = entry
            H._format_entry.return_value = {}
            resp, code = TimeTrackingAPI().admin_void_entry()

    assert code == 200
    spy.emit.assert_called_once()
    kwargs = spy.emit.call_args.kwargs
    assert kwargs["type"] == NotificationType.ENTRY_ADJUSTED
    assert kwargs["user_id"] == "auth0|owner"


def test_mark_hourly_paid_notifies_payee():
    import datetime
    from api.views.TimeTracking import TimeTrackingAPI

    payee = _FakeUser("auth0|payee", role="user", org_id="kaart-org", hourly_rate=20.0)
    hp = MagicMock()
    hp.id = 55
    bounds = (datetime.datetime(2026, 6, 1), datetime.datetime(2026, 7, 1))

    with app.test_request_context(
        json={
            "userId": "auth0|payee",
            "year": 2026,
            "month": 6,
            "paid": True,
        }
    ):
        g.user = _admin()
        with patch("api.views.TimeTracking.User") as U, patch(
            "api.views.TimeTracking.HourlyPayment"
        ) as HP, patch("api.views.TimeTracking.db") as DB, patch(
            "api.views.TimeTracking.org_month_bounds_utc", return_value=bounds
        ), patch(
            "api.views.TimeTracking.HourlyRateHistoryService"
        ) as RateSvc, patch(
            "api.views.TimeTracking.comms_client"
        ) as spy:
            U.query.get.return_value = payee
            HP.query.filter_by.return_value.first.return_value = hp
            # Active hourly rate lookup (rate-history service) → $20/hr.
            RateSvc.return_value.get_active_rate.return_value = MagicMock(rate=20.0)
            # db.session.query(...).filter(...).scalar() → 3600s
            DB.session.query.return_value.filter.return_value.scalar.return_value = (
                3600  # noqa: E501
            )
            TimeTrackingAPI().admin_mark_hourly_paid()

    spy.emit.assert_called_once()
    kwargs = spy.emit.call_args.kwargs
    assert kwargs["type"] == NotificationType.PAYMENT_SENT
    assert kwargs["user_id"] == "auth0|payee"
    assert kwargs["org_id"] == "kaart-org"


def test_mark_hourly_unpaid_does_not_notify():
    from api.views.TimeTracking import TimeTrackingAPI

    payee = _FakeUser("auth0|payee", role="user", org_id="kaart-org")
    hp = MagicMock()

    with app.test_request_context(
        json={
            "userId": "auth0|payee",
            "year": 2026,
            "month": 6,
            "paid": False,
        }
    ):
        g.user = _admin()
        with patch("api.views.TimeTracking.User") as U, patch(
            "api.views.TimeTracking.HourlyPayment"
        ) as HP, patch("api.views.TimeTracking.db"), patch(
            "api.views.TimeTracking.comms_client"
        ) as spy:
            U.query.get.return_value = payee
            HP.query.filter_by.return_value.first.return_value = hp
            TimeTrackingAPI().admin_mark_hourly_paid()

    spy.emit.assert_not_called()


def test_process_payment_request_notifies_payee():
    from api.views.Transactions import TransactionAPI

    payee = _FakeUser(
        "auth0|payee", role="user", org_id="kaart-org", first_name="pay", last_name="ee"
    )
    pay_request = MagicMock()
    pay_request.osm_username = "payee_osm"
    new_payment = MagicMock()
    new_payment.id = 99

    with app.test_request_context(
        json={
            "request_id": 1,
            "user_id": "auth0|payee",
            "request_amount": 25.0,
            "task_ids": [],
            "payoneer_id": "",
            "notes": None,
        }
    ):
        g.user = _admin()
        with patch("api.views.Transactions.User") as U, patch(
            "api.views.Transactions.PayRequests"
        ) as PR, patch("api.views.Transactions.Payments") as P, patch(
            "api.views.Transactions.is_org_admin_or_above", return_value=True
        ), patch(
            "api.views.Transactions.comms_client"
        ) as spy:
            U.query.filter_by.return_value.first.return_value = payee
            PR.query.filter_by.return_value.first.return_value = pay_request
            P.create.return_value = new_payment
            result = TransactionAPI().process_payment_request()

    assert result["status"] == 200
    spy.emit.assert_called_once()
    kwargs = spy.emit.call_args.kwargs
    assert kwargs["type"] == NotificationType.PAYMENT_SENT
    assert kwargs["user_id"] == "auth0|payee"
    assert kwargs["org_id"] == "kaart-org"


def test_assign_user_notifies_assignee():
    from api.views.Users import UserAPI

    assignee = _FakeUser("auth0|assignee", role="user", org_id="kaart-org")
    project = MagicMock()
    project.name = "Bogota Buildings"

    with app.test_request_context(json={"project_id": 17, "user_id": "auth0|assignee"}):
        g.user = _admin()
        with patch("api.views.Users.ProjectUser") as PU, patch(
            "api.views.Users.User"
        ) as U, patch("api.views.Users.Project") as P, patch(
            "api.views.Users.comms_client"
        ) as spy:
            # No existing relation → assign branch.
            PU.query.filter_by.return_value.first.return_value = None
            U.query.get.return_value = assignee
            P.query.get.return_value = project
            resp = UserAPI().assign_user()

    assert resp["status"] == 200
    spy.emit.assert_called_once()
    kwargs = spy.emit.call_args.kwargs
    assert kwargs["type"] == NotificationType.ASSIGNED_TO_PROJECT
    assert kwargs["user_id"] == "auth0|assignee"
    assert kwargs["link"] == "/user/projects/17"
    assert kwargs["actor_id"] == "auth0|admin"


def test_unassign_user_does_not_notify():
    from api.views.Users import UserAPI

    existing = MagicMock()

    with app.test_request_context(json={"project_id": 17, "user_id": "auth0|assignee"}):
        g.user = _admin()
        with patch("api.views.Users.ProjectUser") as PU, patch(
            "api.views.Users.comms_client"
        ) as spy:
            # Existing relation → unassign branch, no notification.
            PU.query.filter_by.return_value.first.return_value = existing
            resp = UserAPI().assign_user()

    assert resp["status"] == 200
    spy.emit.assert_not_called()


def test_update_payment_email_notifies_org_admins():
    from api.views.Users import UserAPI

    admins = [
        _FakeUser("auth0|admin", role="admin"),
        _FakeUser("auth0|admin2", role="admin"),
    ]

    with app.test_request_context(json={"payment_email": "new@pay.test"}):
        # Actor is a regular user changing their own payment email.
        g.user = _FakeUser(
            "auth0|mapper",
            role="user",
            org_id="kaart-org",
            payment_email="old@pay.test",
        )
        with patch("api.views.Users.org_admin_users", return_value=admins), patch(
            "api.views.Users.comms_client"
        ) as spy:
            resp = UserAPI().update_user_details()

    assert resp["status"] == 200
    spy.emit_batch.assert_called_once()
    kwargs = spy.emit_batch.call_args.kwargs
    assert kwargs["type"] == NotificationType.BANK_INFO_CHANGED
    assert kwargs["link"] == "/admin/users/auth0|mapper"
    assert set(kwargs["user_ids"]) == {"auth0|admin", "auth0|admin2"}


def test_update_without_payment_email_change_does_not_notify():
    from api.views.Users import UserAPI

    with app.test_request_context(json={"first_name": "Renamed"}):
        g.user = _FakeUser(
            "auth0|mapper",
            role="user",
            org_id="kaart-org",
            payment_email="same@pay.test",
        )
        with patch("api.views.Users.org_admin_users") as admins, patch(
            "api.views.Users.UserNameAudit"
        ), patch("api.views.Users.comms_client") as spy:
            # Only first_name changes; payment_email untouched.
            resp = UserAPI().update_user_details()

    assert resp["status"] == 200
    spy.emit_batch.assert_not_called()
    admins.assert_not_called()
