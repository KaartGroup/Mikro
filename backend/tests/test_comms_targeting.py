"""
Integration tests for the comms targeting / authorization gatekeeper
(``api/views/Comms.py``).

Uses the shared ``db_session`` fixture (real PostgreSQL rows, rolled back per
test). comms_client.send_campaign / fetch_campaigns are monkeypatched so NO
real HTTP happens — the spies capture what Mikro resolved + authorized.

Coverage:
  * org admin can send to all_org / a team / a region / custom individuals;
    recipients resolved correctly (subs+emails, no-email users dropped);
    sent_by == admin id.
  * team_admin (lead of team T) can send to team:T and custom members of T;
    CANNOT send all_org / region / team:Other / custom-with-non-member.
  * validator / user blocked at the decorator (403), driven through the
    registered view dispatch.
  * targetable_audiences / targetable_users scoping per role.
  * campaign_list passes sent_by=None for org admin, sent_by=self for team
    admin.
  * per-org isolation: orgA admin can't resolve/target orgB users.
"""

import pytest
from flask import g

import api.comms_client as comms_client
from api.views.Comms import CommsAPI
from api.database import User, Team, TeamUser, TeamLead, Region, Country

ORG_A = "comms-org-a"
ORG_B = "comms-org-b"


# ─── Helpers ─────────────────────────────────────────────────────────────


_DEFAULT = object()


def _u(uid, org_id=ORG_A, role="user", email=_DEFAULT, country_id=None):
    """Build a User. Pass ``email=None`` to create a user with no email
    (the default fills in a synthetic one)."""
    return User(
        id=uid,
        org_id=org_id,
        role=role,
        email=f"{uid}@x.test" if email is _DEFAULT else email,
        country_id=country_id,
    )


class _Spy:
    """Captures the kwargs of the last call and returns a canned dict."""

    def __init__(self, ret=None):
        self.calls = []
        self.ret = ret if ret is not None else {}

    def __call__(self, **kwargs):
        self.calls.append(kwargs)
        return self.ret

    @property
    def last(self):
        return self.calls[-1]


@pytest.fixture
def send_spy(monkeypatch):
    spy = _Spy(ret={"recipient_count": 0, "campaign": {"id": 1}})
    monkeypatch.setattr(comms_client, "send_campaign", spy)
    return spy


@pytest.fixture
def list_spy(monkeypatch):
    spy = _Spy(ret={"campaigns": []})

    def _fetch(**kwargs):
        spy.calls.append(kwargs)
        return []

    monkeypatch.setattr(comms_client, "fetch_campaigns", _fetch)
    return spy


# The test app instance (TestingConfig, bound to mikro_test) is the conftest
# `app` fixture — NOT the module-level production `app` in app.py. Real-DB
# tests MUST run their request contexts on this instance so db.session binds to
# the test database. We stash it here via an autouse fixture.
_APP = {}


@pytest.fixture(autouse=True)
def _bind_app(app):
    _APP["app"] = app
    yield
    _APP.pop("app", None)


# ─── World setup ─────────────────────────────────────────────────────────


@pytest.fixture
def world(db_session):
    """Two orgs, teams, a region, and assorted users.

    Returns a dict of the key ids/rows for assertions.
    """
    # Region + country for ORG_A (region targeting goes through Country).
    region = Region(name="Comms Region A", org_id=ORG_A)
    db_session.add(region)
    db_session.flush()
    country = Country(name="Comms Country A", region_id=region.id)
    db_session.add(country)
    db_session.flush()

    # ORG_A users
    admin = _u("auth0|ca-admin", role="admin", email="ca-admin@x.test")
    lead = _u("auth0|ca-lead", role="team_admin", email="ca-lead@x.test")
    m1 = _u("auth0|ca-m1", email="m1@x.test", country_id=country.id)
    m2 = _u("auth0|ca-m2", email="m2@x.test", country_id=country.id)
    no_email = _u("auth0|ca-noemail", email=None, country_id=country.id)
    other_member = _u("auth0|ca-other", email="other@x.test")
    db_session.add_all([admin, lead, m1, m2, no_email, other_member])

    # ORG_B user (isolation target)
    b_user = _u("auth0|cb-user", org_id=ORG_B, email="b@x.test")
    db_session.add(b_user)
    db_session.flush()

    # Teams in ORG_A
    team_t = Team(name="Team T", org_id=ORG_A)
    team_other = Team(name="Team Other", org_id=ORG_A)
    db_session.add_all([team_t, team_other])
    db_session.flush()

    # lead leads team_t only
    db_session.add(TeamLead(team_id=team_t.id, user_id=lead.id))
    # team_t members: m1, m2, no_email
    db_session.add(TeamUser(team_id=team_t.id, user_id=m1.id))
    db_session.add(TeamUser(team_id=team_t.id, user_id=m2.id))
    db_session.add(TeamUser(team_id=team_t.id, user_id=no_email.id))
    # team_other member: other_member
    db_session.add(TeamUser(team_id=team_other.id, user_id=other_member.id))
    db_session.flush()

    return {
        "admin": admin,
        "lead": lead,
        "m1": m1,
        "m2": m2,
        "no_email": no_email,
        "other_member": other_member,
        "b_user": b_user,
        "team_t": team_t,
        "team_other": team_other,
        "region": region,
    }


SUBJECT = "Hello"
BODY = "<p>Hi</p>"


def _send(user, body):
    with _APP["app"].test_request_context(json=body):
        g.user = user
        return CommsAPI().campaign_send()


# ─── org admin: can target everything ──────────────────────────────────────


def test_org_admin_send_all_org(world, send_spy):
    resp, code = _send(
        world["admin"],
        {"subject": SUBJECT, "body_html": BODY, "audience": "all_org"},
    )
    assert code == 200
    kwargs = send_spy.last
    assert kwargs["sent_by"] == world["admin"].id
    subs = {r["sub"] for r in kwargs["recipients"]}
    # All ORG_A users WITH an email; no_email dropped; ORG_B user excluded.
    assert "auth0|ca-noemail" not in subs
    assert "auth0|cb-user" not in subs
    assert {"auth0|ca-admin", "auth0|ca-m1", "auth0|ca-m2"}.issubset(subs)
    assert all(r["email"] for r in kwargs["recipients"])


def test_org_admin_send_team(world, send_spy):
    resp, code = _send(
        world["admin"],
        {
            "subject": SUBJECT,
            "body_html": BODY,
            "audience": f"team:{world['team_t'].id}",
        },
    )
    assert code == 200
    subs = {r["sub"] for r in send_spy.last["recipients"]}
    # team_t members with email: m1, m2 (no_email dropped).
    assert subs == {"auth0|ca-m1", "auth0|ca-m2"}


def test_org_admin_send_region(world, send_spy):
    resp, code = _send(
        world["admin"],
        {
            "subject": SUBJECT,
            "body_html": BODY,
            "audience": f"region:{world['region'].id}",
        },
    )
    assert code == 200
    subs = {r["sub"] for r in send_spy.last["recipients"]}
    # Users whose country is in the region, with email: m1, m2.
    assert subs == {"auth0|ca-m1", "auth0|ca-m2"}


def test_org_admin_send_custom(world, send_spy):
    resp, code = _send(
        world["admin"],
        {
            "subject": SUBJECT,
            "body_html": BODY,
            "audience": "custom",
            "recipient_user_ids": ["auth0|ca-m1", "auth0|ca-other"],
        },
    )
    assert code == 200
    subs = {r["sub"] for r in send_spy.last["recipients"]}
    assert subs == {"auth0|ca-m1", "auth0|ca-other"}


def test_org_admin_send_no_recipients_400(world, send_spy):
    """Custom list of one no-email user → resolves to zero → 400, no send."""
    resp, code = _send(
        world["admin"],
        {
            "subject": SUBJECT,
            "body_html": BODY,
            "audience": "custom",
            "recipient_user_ids": ["auth0|ca-noemail"],
        },
    )
    assert code == 400
    assert send_spy.calls == []


# ─── team_admin: scoped to led teams ────────────────────────────────────────


def test_team_admin_send_own_team(world, send_spy):
    resp, code = _send(
        world["lead"],
        {
            "subject": SUBJECT,
            "body_html": BODY,
            "audience": f"team:{world['team_t'].id}",
        },
    )
    assert code == 200
    subs = {r["sub"] for r in send_spy.last["recipients"]}
    assert subs == {"auth0|ca-m1", "auth0|ca-m2"}
    assert send_spy.last["sent_by"] == world["lead"].id


def test_team_admin_send_custom_members(world, send_spy):
    resp, code = _send(
        world["lead"],
        {
            "subject": SUBJECT,
            "body_html": BODY,
            "audience": "custom",
            "recipient_user_ids": ["auth0|ca-m1", "auth0|ca-m2"],
        },
    )
    assert code == 200
    subs = {r["sub"] for r in send_spy.last["recipients"]}
    assert subs == {"auth0|ca-m1", "auth0|ca-m2"}


def test_team_admin_cannot_send_all_org(world, send_spy):
    resp, code = _send(
        world["lead"],
        {"subject": SUBJECT, "body_html": BODY, "audience": "all_org"},
    )
    assert code == 403
    assert send_spy.calls == []


def test_team_admin_cannot_send_region(world, send_spy):
    resp, code = _send(
        world["lead"],
        {
            "subject": SUBJECT,
            "body_html": BODY,
            "audience": f"region:{world['region'].id}",
        },
    )
    assert code == 403
    assert send_spy.calls == []


def test_team_admin_cannot_send_other_team(world, send_spy):
    resp, code = _send(
        world["lead"],
        {
            "subject": SUBJECT,
            "body_html": BODY,
            "audience": f"team:{world['team_other'].id}",
        },
    )
    assert code == 403
    assert send_spy.calls == []


def test_team_admin_cannot_send_custom_with_nonmember(world, send_spy):
    resp, code = _send(
        world["lead"],
        {
            "subject": SUBJECT,
            "body_html": BODY,
            "audience": "custom",
            "recipient_user_ids": ["auth0|ca-m1", "auth0|ca-other"],
        },
    )
    assert code == 403
    assert send_spy.calls == []


# ─── decorator blocks validator / user ──────────────────────────────────────


@pytest.mark.parametrize("role", ["validator", "user"])
def test_low_roles_blocked_at_decorator(world, db_session, send_spy, role):
    """Drive through the registered view dispatch so the decorator runs."""
    low = _u("auth0|ca-low", role=role, email="low@x.test")
    db_session.add(low)
    db_session.flush()

    view = CommsAPI.as_view("comms_test")
    with _APP["app"].test_request_context(
        json={"subject": SUBJECT, "body_html": BODY, "audience": "all_org"}
    ):
        g.user = low
        resp = view(path="campaign_send")
    # Decorator returns (jsonify, 403)
    status = resp[1] if isinstance(resp, tuple) else resp.status_code
    assert status == 403
    assert send_spy.calls == []


# ─── targetable_audiences ────────────────────────────────────────────────────


def test_targetable_audiences_org_admin(world):
    with _APP["app"].test_request_context(json={}):
        g.user = world["admin"]
        resp, code = CommsAPI().targetable_audiences()
    data = resp.get_json()
    assert code == 200
    assert data["can_target_org"] is True
    assert data["can_target_regions"] is True
    assert data["can_target_individuals"] is True
    team_ids = {t["id"] for t in data["teams"]}
    assert {world["team_t"].id, world["team_other"].id} <= team_ids
    region_ids = {r["id"] for r in data["regions"]}
    assert world["region"].id in region_ids


def test_targetable_audiences_team_admin(world):
    with _APP["app"].test_request_context(json={}):
        g.user = world["lead"]
        resp, code = CommsAPI().targetable_audiences()
    data = resp.get_json()
    assert code == 200
    assert data["can_target_org"] is False
    assert data["can_target_regions"] is False
    assert data["can_target_individuals"] is True
    team_ids = {t["id"] for t in data["teams"]}
    assert team_ids == {world["team_t"].id}
    assert data["regions"] == []


# ─── targetable_users ────────────────────────────────────────────────────────


def test_targetable_users_org_admin(world):
    with _APP["app"].test_request_context(json={}):
        g.user = world["admin"]
        resp, code = CommsAPI().targetable_users()
    subs = {u["sub"] for u in resp.get_json()["users"]}
    # All ORG_A users; ORG_B excluded.
    assert "auth0|cb-user" not in subs
    assert {"auth0|ca-admin", "auth0|ca-m1", "auth0|ca-other"}.issubset(subs)


def test_targetable_users_team_admin(world):
    with _APP["app"].test_request_context(json={}):
        g.user = world["lead"]
        resp, code = CommsAPI().targetable_users()
    subs = {u["sub"] for u in resp.get_json()["users"]}
    # Only members of led team_t.
    assert subs == {"auth0|ca-m1", "auth0|ca-m2", "auth0|ca-noemail"}


def test_targetable_users_name_never_bare_sub(world):
    """Name prefers full_name/email, never returns a bare sub when email
    exists."""
    with _APP["app"].test_request_context(json={}):
        g.user = world["admin"]
        resp, code = CommsAPI().targetable_users()
    by_sub = {u["sub"]: u for u in resp.get_json()["users"]}
    m1 = by_sub["auth0|ca-m1"]
    assert m1["name"] == "m1@x.test"  # no first/last -> email


# ─── campaign_list sent_by scoping ──────────────────────────────────────────


def test_campaign_list_org_admin_passes_none(world, list_spy):
    with _APP["app"].test_request_context(json={}):
        g.user = world["admin"]
        resp, code = CommsAPI().campaign_list()
    assert code == 200
    assert list_spy.last["sent_by"] is None
    assert list_spy.last["org_id"] == ORG_A


def test_campaign_list_team_admin_passes_self(world, list_spy):
    with _APP["app"].test_request_context(json={}):
        g.user = world["lead"]
        resp, code = CommsAPI().campaign_list()
    assert code == 200
    assert list_spy.last["sent_by"] == world["lead"].id
    assert list_spy.last["org_id"] == ORG_A


# ─── per-org isolation ───────────────────────────────────────────────────────


def test_org_admin_cannot_target_other_org_user_custom(world, send_spy):
    """An ORG_A admin including an ORG_B sub in a custom list is rejected."""
    resp, code = _send(
        world["admin"],
        {
            "subject": SUBJECT,
            "body_html": BODY,
            "audience": "custom",
            "recipient_user_ids": ["auth0|ca-m1", "auth0|cb-user"],
        },
    )
    assert code == 403
    assert send_spy.calls == []


def test_all_org_never_leaks_other_org(world, send_spy):
    resp, code = _send(
        world["admin"],
        {"subject": SUBJECT, "body_html": BODY, "audience": "all_org"},
    )
    assert code == 200
    subs = {r["sub"] for r in send_spy.last["recipients"]}
    assert "auth0|cb-user" not in subs


# ─── validation: missing subject/body ────────────────────────────────────────


def test_send_requires_subject_and_body(world, send_spy):
    resp, code = _send(
        world["admin"],
        {"subject": "", "body_html": BODY, "audience": "all_org"},
    )
    assert code == 400
    assert send_spy.calls == []


def test_campaign_preview_returns_count(world):
    with _APP["app"].test_request_context(
        json={"audience": f"team:{world['team_t'].id}"}
    ):
        g.user = world["admin"]
        resp, code = CommsAPI().campaign_preview()
    assert code == 200
    # team_t members with email: m1, m2.
    assert resp.get_json()["recipient_count"] == 2


# ─── comms unreachable -> 502 ────────────────────────────────────────────────


def test_send_502_when_comms_unreachable(world, monkeypatch):
    def _boom(**kwargs):
        raise comms_client.CommsError("connection refused")

    monkeypatch.setattr(comms_client, "send_campaign", _boom)
    resp, code = _send(
        world["admin"],
        {"subject": SUBJECT, "body_html": BODY, "audience": "all_org"},
    )
    assert code == 502
    assert "comms" in resp.get_json()["message"].lower()
