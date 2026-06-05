"""
Tests for UserAPI.invite_user() and the shared org-invite helper.

invite_user delegates the member-vs-invite decision to
api/utils/auth0_org.add_or_invite_user_to_org and layers on: role-based
authorization (invite at or below your level; team_admin -> validator/mapper
into led teams only), multi-team assignment, and role REPLACE for an existing
Mikro user. The token fetch is in Users.py; the Auth0 org calls are in the
helper module — so these patch `requests` in BOTH, plus `User` (the replace
lookup) and, where relevant, `Team` / `PendingInvite` / team-scoping.
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
    "AUTH0_VALIDATOR_ROLE_ID": "rol_validator",
    "AUTH0_TEAM_ADMIN_ROLE_ID": "rol_teamadmin",
    "AUTH0_ADMIN_ROLE_ID": "rol_admin",
}


def _resp(ok=True, status=200, payload=None):
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


def _team_admin_user():
    u = MagicMock()
    u.role = "team_admin"
    u.id = "auth0|ta"
    u.org_id = "org_kaart"
    u.first_name = "Tina"
    u.last_name = "Lead"
    return u


@pytest.fixture
def auth0_app():
    app = flask.Flask(__name__)
    app.config.update(AUTH0_CONFIG)
    return app


def _patch_requests(get_side_effect, post_side_effect, existing_user=None):
    """Patch `requests` in the view (token) AND helper (org calls), plus the
    `User` replace-lookup (returns `existing_user`, default None)."""
    ureq = patch("api.views.Users.requests")
    hreq = patch("api.utils.auth0_org.requests")
    user = patch("api.views.Users.User")
    u, h = ureq.start(), hreq.start()
    mu = user.start()
    mu.query.filter.return_value.first.return_value = existing_user
    for m in (u, h):
        m.get.side_effect = get_side_effect
        m.post.side_effect = post_side_effect
    return (ureq, hreq, user), u, h, mu


def _existing_member_get(url, **kwargs):
    if "users-by-email" in url:
        return _resp(payload=[{"user_id": "auth0|existing"}])
    return _resp(ok=False, status=404)


def _new_user_get(url, **kwargs):
    if "users-by-email" in url:
        return _resp(payload=[])
    if url.endswith("/connections"):
        return _resp(payload=[{"name": "Username-Password-Authentication", "id": "con_db"}])
    return _resp(ok=False, status=404)


def _ok_post(url, **kwargs):
    if url.endswith("/oauth/token"):
        return _resp(payload={"access_token": "tok"})
    if "/invitations" in url:
        return _resp(payload={"id": "inv_1"})
    if url.endswith("/members") or url.endswith("/roles"):
        return _resp(status=204)
    if url.endswith("/change_password"):
        return _resp()
    return _resp(ok=False, status=404)


# ── Existing tests: member-vs-invite (default role = user) ──────────────────


def test_invite_existing_user_adds_as_member_not_invitation(auth0_app):
    with auth0_app.test_request_context(json={"email": "Existing@Viewer.test"}):
        g.user = _admin_user()
        patchers, _u, hreq, _mu = _patch_requests(_existing_member_get, _ok_post)
        try:
            result = UserAPI().invite_user()
        finally:
            for p in patchers:
                p.stop()

    assert result["status"] == 200
    assert "now has access" in result["message"].lower()
    helper_posts = [c.args[0] for c in hreq.post.call_args_list]
    assert any(u.endswith("/members") for u in helper_posts)
    assert not any("/invitations" in u for u in helper_posts)
    _get_url, get_kwargs = hreq.get.call_args
    assert get_kwargs["params"]["email"] == "existing@viewer.test"


def test_invite_new_user_still_sends_invitation(auth0_app):
    with auth0_app.test_request_context(json={"email": "brandnew@example.test"}):
        g.user = _admin_user()
        patchers, _u, hreq, _mu = _patch_requests(_new_user_get, _ok_post)
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


# ── Role-based authorization ────────────────────────────────────────────────


def test_org_admin_can_invite_admin(auth0_app):
    with auth0_app.test_request_context(
        json={"email": "new.admin@example.test", "role": "admin"}
    ):
        g.user = _admin_user()
        patchers, _u, hreq, _mu = _patch_requests(_new_user_get, _ok_post)
        try:
            result = UserAPI().invite_user()
        finally:
            for p in patchers:
                p.stop()

    assert result["status"] == 200
    # The admin role id was attached to the invitation payload.
    inv_call = next(
        c for c in hreq.post.call_args_list if "/invitations" in c.args[0]
    )
    assert inv_call.kwargs["json"]["roles"] == ["rol_admin"]


def test_org_admin_cannot_invite_super_admin(auth0_app):
    with auth0_app.test_request_context(
        json={"email": "x@example.test", "role": "super_admin"}
    ):
        g.user = _admin_user()
        patchers, _u, _h, _mu = _patch_requests(_new_user_get, _ok_post)
        try:
            result = UserAPI().invite_user()
        finally:
            for p in patchers:
                p.stop()
    assert result["status"] in (400, 403)


def test_team_admin_cannot_invite_admin(auth0_app):
    with auth0_app.test_request_context(
        json={"email": "x@example.test", "role": "admin", "targetTeamIds": [7]}
    ):
        g.user = _team_admin_user()
        patchers, _u, _h, _mu = _patch_requests(_new_user_get, _ok_post)
        try:
            result = UserAPI().invite_user()
        finally:
            for p in patchers:
                p.stop()
    assert result["status"] == 403
    assert "not allowed" in result["message"].lower()


def test_team_admin_validator_requires_a_team(auth0_app):
    with auth0_app.test_request_context(
        json={"email": "v@example.test", "role": "validator"}
    ):
        g.user = _team_admin_user()
        patchers, _u, _h, _mu = _patch_requests(_new_user_get, _ok_post)
        try:
            result = UserAPI().invite_user()
        finally:
            for p in patchers:
                p.stop()
    assert result["status"] == 400
    assert "team" in result["message"].lower()


def test_team_admin_invites_validator_into_led_team(auth0_app):
    with auth0_app.test_request_context(
        json={"email": "v@example.test", "role": "validator", "targetTeamIds": [7]}
    ):
        g.user = _team_admin_user()
        patchers, _u, hreq, _mu = _patch_requests(_new_user_get, _ok_post)
        with patch("api.database.Team") as MockTeam, patch(
            "api.database.PendingInvite"
        ) as MockPending, patch(
            "api.auth.team_admin_can_access_team", return_value=True
        ):
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
    inv_call = next(
        c for c in hreq.post.call_args_list if "/invitations" in c.args[0]
    )
    assert inv_call.kwargs["json"]["roles"] == ["rol_validator"]


# ── Role replace for an existing Mikro user ─────────────────────────────────


def test_existing_mikro_user_role_is_replaced(auth0_app):
    existing = SimpleNamespace(role="user")
    existing.update = MagicMock()
    with auth0_app.test_request_context(
        json={"email": "member@kaart.test", "role": "team_admin"}
    ):
        g.user = _admin_user()
        patchers, _u, _h, _mu = _patch_requests(
            _existing_member_get, _ok_post, existing_user=existing
        )
        try:
            result = UserAPI().invite_user()
        finally:
            for p in patchers:
                p.stop()

    assert result["status"] == 200
    existing.update.assert_called_once_with(role="team_admin")
