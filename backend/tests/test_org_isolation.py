"""
Phase D — cross-org isolation / login-gate integration tests.

These REQUIRE Postgres (conftest's `app` / `db_session`, the mikro_test DB) —
they create real Organization/Team rows and exercise the Phase B login gate and
the org_id scoping that keeps tenants isolated. They run in CI; the gate's pure
logic is additionally covered (no DB) by test_login_org_gate.py.

Pattern mirrors test_time_entry_query.py: add rows via the session + flush (NOT
Model.create(), which commits) so each test rolls back cleanly.
"""

from flask import g

from api.database import Organization, Team
from api.views.Login import LoginAPI


def _jwt(sub, org_id):
    return {
        "sub": sub,
        "mikro/roles": ["user"],
        "mikro/org_id": org_id,
        "email": f"{sub}@example.test",
        "name": "Test User",
    }


def test_disabled_org_is_rejected_with_a_real_row(app, db_session):
    db_session.add(
        Organization(
            id="org_disabled",
            name="disabled-co",
            display_name="Disabled Co",
            status="disabled",
        )
    )
    db_session.flush()
    with app.test_request_context(json={}):
        g.current_user = _jwt("auth0|d", "org_disabled")
        resp = LoginAPI()._do_login()
    assert isinstance(resp, tuple)
    assert resp[1] == 403
    assert resp[0].get_json()["reason"] == "org_not_active"


def test_unknown_org_is_rejected(app, db_session):
    with app.test_request_context(json={}):
        g.current_user = _jwt("auth0|u", "org_does_not_exist")
        resp = LoginAPI()._do_login()
    assert resp[1] == 403


def test_disabled_org_stays_visible_in_listing(db_session):
    """Disabled orgs must remain queryable (no soft-delete filter) so a
    super_admin can see and restore them."""
    db_session.add(
        Organization(id="org_a", name="a", display_name="A", status="active")
    )
    db_session.add(
        Organization(id="org_b", name="b", display_name="B", status="disabled")
    )
    db_session.flush()
    ids = {o.id for o in Organization.query.all()}
    assert {"org_a", "org_b"} <= ids
    b = Organization.query.filter_by(id="org_b").first()
    assert b.status == "disabled"


def test_org_id_filter_isolates_rows_across_orgs(db_session):
    """The org_id filter that every backend list query uses keeps one org's
    rows from bleeding into another's — the core isolation guarantee."""
    db_session.add(Team(name="Acme team", org_id="org_acme"))
    db_session.add(Team(name="Globex team", org_id="org_globex"))
    db_session.flush()

    acme = Team.query.filter_by(org_id="org_acme").all()
    assert {t.name for t in acme} == {"Acme team"}
    assert all(t.org_id == "org_acme" for t in acme)
