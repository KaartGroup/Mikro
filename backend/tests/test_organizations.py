"""
Tests for OrganizationAPI (super_admin-only external-org management).

Phase A of external-org-management-plan.md. These patch the Auth0 calls and the
`Organization` model and call the view methods directly, so they run with no
Postgres dependency (consistent with test_invite_existing_user.py). Real-DB
isolation tests come in Phase D.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import flask
import pytest
from flask import g

from api.views.Organizations import OrganizationAPI

AUTH0_CONFIG = {
    "AUTH0_DOMAIN": "test.auth0.com",
    "AUTH0_M2M_CLIENT_ID": "m2m",
    "AUTH0_APP_CLIENT_ID": "app",
    "AUTH0_ORG_ID": "org_kaart",
    "AUTH0_ORG_LIMIT": 10,
    "AUTH0_ADMIN_ROLE_ID": "rol_admin",
}

ORG_MOD = "api.views.Organizations"


def _resp(ok=True, status=200, payload=None):
    m = MagicMock()
    m.ok = ok
    m.status_code = status
    m.json.return_value = {} if payload is None else payload
    m.text = str(payload)
    return m


def _super_admin():
    return SimpleNamespace(role="super_admin", is_active=True, id="auth0|super")


def _fake_org(**over):
    base = dict(
        id="org_x",
        name="x",
        display_name="X",
        status="active",
        contact_name=None,
        contact_email=None,
        notes=None,
        created_by_user_id=None,
        created_at=None,
        disabled_at=None,
    )
    base.update(over)
    ns = SimpleNamespace(**base)
    # .update(**kw) mutates in place, mirroring CRUDMixin.update.
    ns.update = lambda **kw: [setattr(ns, k, v) for k, v in kw.items()]
    return ns


@pytest.fixture
def super_app():
    app = flask.Flask(__name__)
    app.config.update(AUTH0_CONFIG)
    return app


def test_list_organizations_reports_capacity(super_app):
    orgs = [_fake_org(id="org_kaart", name="kaart", display_name="Kaart")]
    with super_app.test_request_context(json={}):
        g.user = _super_admin()
        with patch(f"{ORG_MOD}.Organization") as MockOrg:
            MockOrg.query.order_by.return_value.all.return_value = orgs
            result = OrganizationAPI().list_organizations()

    assert result["status"] == 200
    assert result["active_count"] == 1
    assert result["remaining"] == 9
    assert result["organizations"][0]["id"] == "org_kaart"


def test_create_organization_provisions_and_invites(super_app):
    created = _fake_org(id="org_new", name="acme", display_name="Acme")
    with super_app.test_request_context(
        json={"name": "Acme", "adminEmail": "boss@acme.test"}
    ):
        g.user = _super_admin()
        with patch(f"{ORG_MOD}.Organization") as MockOrg, patch(
            f"{ORG_MOD}.get_auth0_management_api_token", return_value="tok"
        ), patch(f"{ORG_MOD}.get_db_connection_id", return_value="con_db"), patch(
            f"{ORG_MOD}.add_or_invite_user_to_org",
            return_value={"ok": True, "mode": "invitation", "status": 200},
        ) as mock_invite, patch(
            f"{ORG_MOD}.requests"
        ) as mock_req:
            MockOrg.query.filter_by.return_value.count.return_value = 0
            MockOrg.create.return_value = created
            MockOrg.query.get.return_value = created
            mock_req.post.return_value = _resp(payload={"id": "org_new"})
            result = OrganizationAPI().create_organization()

    assert result["status"] == 200
    assert result["organization"]["id"] == "org_new"
    # Auth0 org was created...
    posted = [c.args[0] for c in mock_req.post.call_args_list]
    assert any(u.endswith("/api/v2/organizations") for u in posted)
    # ...and the first admin was invited into the NEW org (not Kaart).
    mock_invite.assert_called_once()
    assert mock_invite.call_args.kwargs["org_id"] == "org_new"


def test_create_organization_blocks_at_capacity(super_app):
    with super_app.test_request_context(json={"name": "Acme"}):
        g.user = _super_admin()
        with patch(f"{ORG_MOD}.Organization") as MockOrg, patch(
            f"{ORG_MOD}.get_auth0_management_api_token"
        ) as mock_tok, patch(f"{ORG_MOD}.requests") as mock_req:
            MockOrg.query.filter_by.return_value.count.return_value = 10
            result = OrganizationAPI().create_organization()

    assert result["status"] == 409
    assert "limit reached" in result["message"].lower()
    # Guard fires before any Auth0 work.
    mock_tok.assert_not_called()
    mock_req.post.assert_not_called()


def test_create_organization_rejects_bad_name(super_app):
    with super_app.test_request_context(json={"name": "Bad Name!!"}):
        g.user = _super_admin()
        with patch(f"{ORG_MOD}.Organization"):
            result = OrganizationAPI().create_organization()

    assert result["status"] == 400


def test_disable_kaart_org_is_blocked(super_app):
    with super_app.test_request_context(json={"orgId": "org_kaart"}):
        g.user = _super_admin()
        with patch(f"{ORG_MOD}.Organization") as MockOrg:
            MockOrg.query.get.return_value = _fake_org(id="org_kaart")
            result = OrganizationAPI().disable_organization()

    assert result["status"] == 400
    assert "kaart" in result["message"].lower()


def test_disable_then_reflects_disabled_status(super_app):
    org = _fake_org(id="org_x", status="active")
    with super_app.test_request_context(json={"orgId": "org_x"}):
        g.user = _super_admin()
        with patch(f"{ORG_MOD}.Organization") as MockOrg:
            MockOrg.query.get.return_value = org
            result = OrganizationAPI().disable_organization()

    assert result["status"] == 200
    assert result["organization"]["status"] == "disabled"
    assert result["organization"]["disabled_at"] is not None


def test_handlers_require_super_admin(super_app):
    """A non-super_admin (even an org admin) is rejected with 403."""
    with super_app.test_request_context(json={}):
        g.user = SimpleNamespace(role="admin", is_active=True, id="auth0|admin")
        resp = OrganizationAPI().list_organizations()

    # The decorator returns (jsonify(...), 403).
    assert isinstance(resp, tuple)
    assert resp[1] == 403
