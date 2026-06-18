"""
Tests for the Phase B login-side org gate in LoginAPI._do_login().

The Organization table is the single source of truth for which orgs may log in:
the Kaart home org is always allowed; any OTHER org must exist and be 'active',
else login is rejected with a 403 + reason 'org_not_active' (which the frontend
routes to /wrong-org). These call _do_login() directly with a mocked JWT and a
mocked Organization/User layer — no Postgres needed.
"""

from types import SimpleNamespace
from unittest.mock import patch

import flask
import pytest
from flask import g

from api.views.Login import LoginAPI

CONFIG = {"AUTH0_NAMESPACE": "mikro", "AUTH0_ORG_ID": "org_kaart"}


class _Stop(Exception):
    """Sentinel: raised at User lookup to prove the gate let the login proceed."""


@pytest.fixture
def app():
    a = flask.Flask(__name__)
    a.config.update(CONFIG)
    return a


def _jwt(org_id):
    return {
        "sub": "auth0|x",
        "mikro/roles": ["user"],
        "mikro/org_id": org_id,
        "email": "x@x.test",
        "name": "X User",
    }


def test_unknown_org_is_rejected(app):
    with app.test_request_context(json={}):
        g.current_user = _jwt("org_other")
        with patch("api.database.Organization") as MockOrg:
            MockOrg.query.filter_by.return_value.first.return_value = None
            resp = LoginAPI()._do_login()
    assert isinstance(resp, tuple)
    body, code = resp
    assert code == 403
    assert body.get_json()["reason"] == "org_not_active"


def test_disabled_org_is_rejected(app):
    with app.test_request_context(json={}):
        g.current_user = _jwt("org_other")
        with patch("api.database.Organization") as MockOrg:
            MockOrg.query.filter_by.return_value.first.return_value = SimpleNamespace(
                id="org_other", status="disabled"
            )
            resp = LoginAPI()._do_login()
    assert resp[1] == 403
    assert resp[0].get_json()["reason"] == "org_not_active"


def test_active_org_passes_the_gate(app):
    with app.test_request_context(json={}):
        g.current_user = _jwt("org_other")
        with patch("api.database.Organization") as MockOrg, patch(
            "api.views.Login.User"
        ) as MockUser:
            MockOrg.query.filter_by.return_value.first.return_value = SimpleNamespace(
                id="org_other", status="active"
            )
            MockUser.query.filter_by.return_value.first.side_effect = _Stop()
            with pytest.raises(_Stop):
                LoginAPI()._do_login()
            # The gate consulted the Organization table for this non-Kaart org.
            MockOrg.query.filter_by.assert_called()


def test_kaart_org_bypasses_the_table_lookup(app):
    with app.test_request_context(json={}):
        g.current_user = _jwt("org_kaart")
        with patch("api.database.Organization") as MockOrg, patch(
            "api.views.Login.User"
        ) as MockUser:
            MockUser.query.filter_by.return_value.first.side_effect = _Stop()
            with pytest.raises(_Stop):
                LoginAPI()._do_login()
            # Kaart is the home org — never looked up in the table.
            MockOrg.query.filter_by.assert_not_called()
