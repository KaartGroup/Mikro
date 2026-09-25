"""
Tests for ``POST /api/internal/kaart-user-lookup`` (``api/views/Internal.py``).

Requests go through the real app (``create_app`` + the JWT ``before_request``
hook) with NO Authorization header, so they also prove the route is exempt
from JWT auth. Lookups run against real rows via the shared ``db_session``
fixture (rolled back per test).
"""

from datetime import datetime

import pytest

from api.database import User
from tests.conftest import USER_ID

URL = "/api/internal/kaart-user-lookup"
SECRET = "test-lookup-secret"


@pytest.fixture
def client(app, db_session, monkeypatch):
    monkeypatch.setitem(app.config, "KAART_USER_LOOKUP_SECRET", SECRET)
    return app.test_client()


def _post(client, body, secret=SECRET):
    headers = {} if secret is None else {"X-Kaart-Lookup-Secret": secret}
    return client.post(URL, json=body, headers=headers)


def test_503_when_secret_unset(app, db_session, monkeypatch):
    monkeypatch.setitem(app.config, "KAART_USER_LOOKUP_SECRET", None)
    resp = _post(app.test_client(), {"auth0_sub": USER_ID})
    assert resp.status_code == 503


def test_401_without_header(client):
    assert _post(client, {"auth0_sub": USER_ID}, secret=None).status_code == 401


def test_401_wrong_secret(client):
    assert _post(client, {"auth0_sub": USER_ID}, secret="nope").status_code == 401


def test_400_missing_sub(client):
    assert _post(client, {}).status_code == 400
    assert _post(client, {"auth0_sub": ""}).status_code == 400
    assert _post(client, {"auth0_sub": 123}).status_code == 400
    resp = client.post(URL, data="not json", headers={"X-Kaart-Lookup-Secret": SECRET})
    assert resp.status_code == 400


def test_exists_true_for_id_match(client):
    resp = _post(client, {"auth0_sub": USER_ID})
    assert resp.status_code == 200
    assert resp.get_json() == {"exists": True}


def test_exists_false_for_unknown_sub(client):
    resp = _post(client, {"auth0_sub": "auth0|nobody-here"})
    assert resp.status_code == 200
    assert resp.get_json() == {"exists": False}


def test_exists_true_for_auth0_sub_column_only(client, db_session):
    db_session.add(User(id="legacy-row", email="l@x.test", auth0_sub="auth0|legacy"))
    db_session.flush()
    assert _post(client, {"auth0_sub": "auth0|legacy"}).get_json() == {"exists": True}


def test_exists_true_for_soft_deleted_and_inactive_rows(client, db_session):
    db_session.add(
        User(id="auth0|gone", email="g@x.test", deleted_date=datetime.utcnow())
    )
    db_session.add(User(id="auth0|off", email="o@x.test", is_active=False))
    db_session.flush()
    # Sanity: the soft-delete query class really does hide the row.
    assert User.query.filter_by(id="auth0|gone").first() is None
    assert _post(client, {"auth0_sub": "auth0|gone"}).get_json() == {"exists": True}
    assert _post(client, {"auth0_sub": "auth0|off"}).get_json() == {"exists": True}


def test_raw_sub_never_logged(client, caplog):
    caplog.set_level("DEBUG")
    _post(client, {"auth0_sub": USER_ID})
    assert USER_ID not in caplog.text
