"""
Tests for UserAPI.invite_user() and the shared org-invite helper it delegates to.

Background: Auth0's organization-invitation email always routes to a SIGN-UP
page, so a user who already exists in the tenant (e.g. from Viewer) hits a
"User already exists" error and can never accept. invite_user() therefore
delegates to api/utils/auth0_org.add_or_invite_user_to_org, which looks the
email up first and, when the user already exists, adds them straight to the org
as a member (+ role) instead of inviting.

The token fetch still happens in Users.py; everything else happens in the shared
helper module — so these patch BOTH `api.views.Users.requests` (token) and
`api.utils.auth0_org.requests` (the Auth0 org calls).
"""
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import flask
import pytest
from flask import g

from api.views.Users import UserAPI

AUTH0_CONFIG = {
    "AUTH0_DOMAIN": "test.auth0.com",
    "AUTH0_M2M_CLIENT_ID": "m2m-client",
    "AUTH0_M2M_CLIENT_SECRET": "m2m-secret",
    "AUTH0_APP_CLIENT_ID": "app-client",
    "AUTH0_ORG_ID": "org_kaart",
    "AUTH0_USER_ROLE_ID": "rol_user",
}


def _resp(ok=True, status=200, payload=None):
    """Build a stand-in for a requests.Response."""
    m = MagicMock()
    m.ok = ok
    m.status_code = status
    m.json.return_value = {} if payload is None else payload
    m.text = str(payload)
    return m


def _admin_user():
    u = MagicMock()
    u.role = "admin"
    u.id = "auth0|admin"
    u.org_id = "org_kaart"
    u.first_name = "Ada"
    u.last_name = "Admin"
    return u


@pytest.fixture
def auth0_app():
    """Minimal Flask app with Auth0 config — no Postgres needed.

    invite_user()'s flow (no target team) touches only config, request, g, and
    the patched `requests` in two modules, never the database.
    """
    app = flask.Flask(__name__)
    app.config.update(AUTH0_CONFIG)
    return app


def _patch_requests(get_side_effect, post_side_effect):
    """Patch `requests` in BOTH the view (token) and the helper (org calls)."""
    ureq = patch("api.views.Users.requests")
    hreq = patch("api.utils.auth0_org.requests")
    u, h = ureq.start(), hreq.start()
    for m in (u, h):
        m.get.side_effect = get_side_effect
        m.post.side_effect = post_side_effect
    return (ureq, hreq), u, h


def test_invite_existing_user_adds_as_member_not_invitation(auth0_app):
    """An email that already exists in the tenant is added via the members
    endpoint; the invitation endpoint is never hit."""

    def get_side_effect(url, **kwargs):
        if "users-by-email" in url:
            return _resp(payload=[{"user_id": "auth0|existing"}])
        return _resp(ok=False, status=404)

    def post_side_effect(url, **kwargs):
        if url.endswith("/oauth/token"):
            return _resp(payload={"access_token": "tok"})
        if url.endswith("/roles"):
            return _resp(status=204)
        if url.endswith("/members"):
            return _resp(status=204)
        if url.endswith("/change_password"):
            return _resp()
        if "/invitations" in url:
            return _resp(payload={"id": "should-not-happen"})
        return _resp(ok=False, status=404)

    with auth0_app.test_request_context(json={"email": "Existing@Viewer.test"}):
        g.user = _admin_user()
        patchers, _ureq, hreq = _patch_requests(get_side_effect, post_side_effect)
        try:
            result = UserAPI().invite_user()
        finally:
            for p in patchers:
                p.stop()

    assert result["status"] == 200
    assert "now has access" in result["message"].lower()

    helper_posts = [c.args[0] for c in hreq.post.call_args_list]
    assert any(u.endswith("/members") for u in helper_posts)
    assert any(u.endswith("/roles") for u in helper_posts)
    assert not any("/invitations" in u for u in helper_posts)

    # Email lookup is lowercased (Auth0 stores DB emails lowercase).
    _get_url, get_kwargs = hreq.get.call_args
    assert get_kwargs["params"]["email"] == "existing@viewer.test"


def test_invite_existing_user_already_member_is_ok(auth0_app):
    """A 409 from the members endpoint (already a member) is treated as
    success, not an error."""

    def get_side_effect(url, **kwargs):
        if "users-by-email" in url:
            return _resp(payload=[{"user_id": "auth0|existing"}])
        return _resp(ok=False, status=404)

    def post_side_effect(url, **kwargs):
        if url.endswith("/oauth/token"):
            return _resp(payload={"access_token": "tok"})
        if url.endswith("/members"):
            return _resp(
                ok=False, status=409, payload={"message": "already a member"}
            )
        if url.endswith("/roles"):
            return _resp(status=204)
        if url.endswith("/change_password"):
            return _resp()
        return _resp(ok=False, status=404)

    with auth0_app.test_request_context(json={"email": "dup@viewer.test"}):
        g.user = _admin_user()
        patchers, _ureq, _hreq = _patch_requests(get_side_effect, post_side_effect)
        try:
            result = UserAPI().invite_user()
        finally:
            for p in patchers:
                p.stop()

    assert result["status"] == 200
    assert "now has access" in result["message"].lower()


def test_invite_new_user_still_sends_invitation(auth0_app):
    """An email with no existing Auth0 account falls through to the standard
    organization-invitation flow (no regression)."""

    def get_side_effect(url, **kwargs):
        if "users-by-email" in url:
            return _resp(payload=[])  # no match
        if url.endswith("/connections"):
            return _resp(
                payload=[
                    {"name": "Username-Password-Authentication", "id": "con_db"}
                ]
            )
        return _resp(ok=False, status=404)

    def post_side_effect(url, **kwargs):
        if url.endswith("/oauth/token"):
            return _resp(payload={"access_token": "tok"})
        if "/invitations" in url:
            return _resp(payload={"id": "inv_1"})
        if url.endswith("/members") or url.endswith("/roles"):
            return _resp(ok=False, status=500, payload={"message": "unexpected"})
        return _resp(ok=False, status=404)

    with auth0_app.test_request_context(json={"email": "brandnew@example.test"}):
        g.user = _admin_user()
        patchers, _ureq, hreq = _patch_requests(get_side_effect, post_side_effect)
        try:
            result = UserAPI().invite_user()
        finally:
            for p in patchers:
                p.stop()

    assert result["status"] == 200
    assert "invitation sent" in result["message"].lower()

    helper_posts = [c.args[0] for c in hreq.post.call_args_list]
    assert any("/invitations" in u for u in helper_posts)
    assert not any(u.endswith("/members") for u in helper_posts)


def test_invite_existing_user_with_team_records_pending_invite(auth0_app):
    """When a target team is given, the member-add path records a PendingInvite
    so first login auto-joins the team (the nuance the refactor preserved)."""

    def get_side_effect(url, **kwargs):
        if "users-by-email" in url:
            return _resp(payload=[{"user_id": "auth0|existing"}])
        return _resp(ok=False, status=404)

    def post_side_effect(url, **kwargs):
        if url.endswith("/oauth/token"):
            return _resp(payload={"access_token": "tok"})
        if url.endswith("/members") or url.endswith("/roles"):
            return _resp(status=204)
        if url.endswith("/change_password"):
            return _resp()
        return _resp(ok=False, status=404)

    with auth0_app.test_request_context(
        json={"email": "e@viewer.test", "targetTeamId": 7}
    ):
        g.user = _admin_user()
        patchers, _ureq, _hreq = _patch_requests(get_side_effect, post_side_effect)
        with patch("api.database.Team") as MockTeam, patch(
            "api.database.PendingInvite"
        ) as MockPending:
            MockTeam.query.filter_by.return_value.first.return_value = (
                SimpleNamespace(id=7)
            )
            try:
                result = UserAPI().invite_user()
            finally:
                for p in patchers:
                    p.stop()

    assert result["status"] == 200
    MockPending.create.assert_called_once()
