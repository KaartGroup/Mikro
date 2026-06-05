"""
Shared pytest fixtures for the Kaart Comms test suite.

Strategy
--------
- Build a real Flask app via comms.create_app with a TestConfig that points
  at an in-memory SQLite DB and sets the HMAC secret + audiences. AUTH0_DOMAIN
  is left None so the real JWT path is never exercised — JWT-protected views
  are tested by directly setting flask.g.identity inside a test_request_context
  and invoking the MethodView method.
- For /emit (HMAC, no JWT) we use the test client and sign the exact bytes we
  send.
"""

import hashlib
import hmac
import json

import pytest

from comms import create_app
from comms.config import Config
from comms.extensions import db as _db
from comms.database import Identity, NOTIFY_PREF_COLUMNS

WEBHOOK_SECRET = "testsecret"


class TestConfig(Config):
    TESTING = True
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    COMMS_WEBHOOK_SECRET = WEBHOOK_SECRET
    API_AUDIENCES = ["https://test/aud"]
    # No Auth0 — JWT-protected endpoints are exercised by injecting g.identity
    # directly, never through the real token-validation path.
    AUTH0_DOMAIN = None
    NOTIFICATION_RETENTION_DAYS = 90


@pytest.fixture
def app():
    """A Comms app bound to a fresh in-memory schema, with app context pushed."""
    app = create_app(TestConfig)
    ctx = app.app_context()
    ctx.push()
    _db.create_all()
    try:
        yield app
    finally:
        _db.session.remove()
        _db.drop_all()
        ctx.pop()


@pytest.fixture
def db(app):
    return _db


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def make_identity(db):
    """Factory: insert and return an Identity row.

    Usage:
        ident = make_identity("auth0|alice", "org1")
        admin = make_identity("auth0|boss", "org1", role="org_admin")
        optout = make_identity("auth0|x", "org1", notify_announcement=False)
    """

    def _make(sub, org_id, role="user", email=None, display_name=None, **prefs):
        kwargs = dict(
            sub=sub,
            org_id=org_id,
            role=role,
            email=(
                email if email is not None else f"{sub.replace('|', '_')}@example.com"
            ),
            display_name=display_name or sub,
        )
        for key, value in prefs.items():
            if key not in NOTIFY_PREF_COLUMNS:
                raise AssertionError(f"unknown pref column {key!r}")
            kwargs[key] = value
        ident = Identity(**kwargs)
        db.session.add(ident)
        db.session.commit()
        return ident

    return _make


def sign(secret: str, raw_body: str) -> str:
    """Hex HMAC-SHA256 of the exact body bytes — matches verify_hmac()."""
    return hmac.new(
        secret.encode("utf-8"),
        raw_body.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


@pytest.fixture
def emit_post(client):
    """POST to an /emit path with a correctly-signed body.

    Returns (response, raw_body_string). Pass sign_with=None to omit the
    signature header, or sign_with="garbage" to send a bad one.
    """

    def _post(path, payload, sign_with=WEBHOOK_SECRET, bad_signature=False):
        raw = json.dumps(payload)
        headers = {"Content-Type": "application/json"}
        if bad_signature:
            headers["X-Comms-Signature"] = "deadbeef"
        elif sign_with is not None:
            headers["X-Comms-Signature"] = sign(sign_with, raw)
        resp = client.post(f"/emit/{path}", data=raw, headers=headers)
        return resp

    return _post
