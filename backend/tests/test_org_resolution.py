"""
Tests for the org-resolution chain in api/auth/auth.py.

This is the SSOT that decides which organization a request belongs to. It
replaced a single direct read of the `mikro/org_id` claim in Login.py, which
had two failure modes that both hit production:

  * The claim went missing from the ACCESS token (the Auth0 Action set it on
    the ID token only). Every login logged `org_id=None`, which made the org
    gate skip its check entirely — it failed OPEN.
  * A confirmed organization member whose token carried no claim was refused
    outright, because nothing ever consulted the database. Their `users.org_id`
    held the correct org the whole time. That is the "No Organization Found"
    report of 2026-09-10.

Precedence under test, highest first:
  1. native `org_id`      (Auth0 emits it on an org-scoped / org-picker login)
  2. `mikro/org_id`       (namespaced claim, from app_metadata via the Action)
  3. the caller's DB row  (last resort, flagged as backfilled)

No Postgres needed — these call the resolver directly with plain dicts and
SimpleNamespace stand-ins for the User row.
"""

from types import SimpleNamespace

import flask
import pytest
from flask import g

from api.auth.auth import (
    _backfill_org_from_db_user,
    _normalize_org_claim,
    org_id_is_backfilled,
    org_id_source,
    resolve_request_org,
    resolved_org_id,
)

NAMESPACE = "mikro"
CONFIG = {"AUTH0_NAMESPACE": NAMESPACE}

NATIVE = "org_nativeAAA111"
NAMESPACED = "org_namespacedBBB222"
FROM_ROW = "org_dbrowCCC333"


@pytest.fixture
def app():
    a = flask.Flask(__name__)
    a.config.update(CONFIG)
    return a


def _user(org_id, deleted_date=None):
    return SimpleNamespace(org_id=org_id, deleted_date=deleted_date)


# ── tier 1: native claim ──────────────────────────────────────────────────


def test_native_claim_wins(app):
    payload = {"org_id": NATIVE, f"{NAMESPACE}/org_id": NAMESPACED}
    with app.app_context():
        _normalize_org_claim(payload)
    assert payload["org_id"] == NATIVE
    assert payload["org_id_source"] == "native"


def test_native_claim_beats_db_row(app):
    payload = {"org_id": NATIVE}
    with app.app_context():
        resolve_request_org(payload, _user(FROM_ROW))
    assert payload["org_id"] == NATIVE
    assert payload["org_id_source"] == "native"
    assert "org_id_from_local_row" not in payload


# ── tier 2: namespaced claim ──────────────────────────────────────────────


def test_namespaced_claim_used_when_no_native(app):
    payload = {f"{NAMESPACE}/org_id": NAMESPACED}
    with app.app_context():
        _normalize_org_claim(payload)
    assert payload["org_id"] == NAMESPACED
    assert payload["org_id_source"] == "namespaced"


def test_namespaced_claim_beats_db_row(app):
    payload = {f"{NAMESPACE}/org_id": NAMESPACED}
    with app.app_context():
        resolve_request_org(payload, _user(FROM_ROW))
    assert payload["org_id"] == NAMESPACED
    assert payload["org_id_source"] == "namespaced"
    assert not payload.get("org_id_from_local_row")


# ── tier 3: DB backfill — the fix for the 2026-09-10 lockout ──────────────


def test_db_row_backfills_when_no_claim(app):
    """A member with no org claim must still resolve, from their own row."""
    payload = {"sub": "auth0|x"}
    with app.app_context():
        resolve_request_org(payload, _user(FROM_ROW))
    assert payload["org_id"] == FROM_ROW
    assert payload["org_id_source"] == "local_row"
    assert payload["org_id_from_local_row"] is True


def test_soft_deleted_user_is_not_backfilled(app):
    """An erased identity's stale org must never be reinstated."""
    payload = {"sub": "auth0|x"}
    with app.app_context():
        resolve_request_org(payload, _user(FROM_ROW, deleted_date="2026-01-01"))
    assert payload.get("org_id") is None
    assert payload["org_id_source"] is None


def test_no_user_row_yields_no_org(app):
    payload = {"sub": "auth0|x"}
    with app.app_context():
        resolve_request_org(payload, None)
    assert payload.get("org_id") is None


# ── the invite flow: this is what makes fail-closed safe ──────────────────


def test_first_login_from_an_invitation_resolves_with_no_db_row(app):
    """
    A brand-new invitee has NO users row, so tier 3 cannot help — and yet must
    still get in. They can, because the invitation email lands on
    /accept-invitation, which forwards `organization=<org_id>` to /authorize.
    That makes the login org-scoped, so Auth0 issues the NATIVE org_id claim
    itself — no Action, no app_metadata, no DB row required.

    If this test ever fails, Login.py's fail-closed 403 starts rejecting every
    new hire, so treat it as a guard on the whole onboarding path.
    """
    payload = {"sub": "auth0|brand-new", "org_id": NATIVE}
    with app.app_context():
        resolve_request_org(payload, None)
    assert payload["org_id"] == NATIVE
    assert payload["org_id_source"] == "native"
    assert not payload.get("org_id_from_local_row")


def test_bare_login_with_no_row_and_no_claim_resolves_to_nothing(app):
    """
    The one population that SHOULD be refused: never invited, so no org claim
    (nothing passed `organization`) and no row to fall back on. Login.py turns
    this into a 403 `no_org`, which is correct rather than collateral damage.
    """
    payload = {"sub": "auth0|never-invited", "email": "stranger@example.test"}
    with app.app_context():
        resolve_request_org(payload, None)
    assert payload.get("org_id") is None
    assert payload["org_id_source"] is None


def test_backfill_does_not_overwrite_an_existing_claim(app):
    payload = {"org_id": NATIVE, "org_id_source": "native"}
    _backfill_org_from_db_user(payload, _user(FROM_ROW))
    assert payload["org_id"] == NATIVE
    assert payload["org_id_source"] == "native"


# ── malformed values are discarded, never trusted ─────────────────────────


@pytest.mark.parametrize(
    "bad",
    ["", "not-an-org", "org_", "ORG_abc", "org_abc def", None, 12345, {"a": 1}],
)
def test_malformed_native_claim_is_rejected(app, bad):
    payload = {"org_id": bad}
    with app.app_context():
        _normalize_org_claim(payload)
    assert payload.get("org_id") is None
    assert payload["org_id_source"] is None


def test_malformed_native_falls_through_to_namespaced(app):
    payload = {"org_id": "garbage", f"{NAMESPACE}/org_id": NAMESPACED}
    with app.app_context():
        _normalize_org_claim(payload)
    assert payload["org_id"] == NAMESPACED
    assert payload["org_id_source"] == "namespaced"


def test_malformed_db_org_is_rejected(app):
    payload = {"sub": "auth0|x"}
    with app.app_context():
        resolve_request_org(payload, _user("garbage"))
    assert payload.get("org_id") is None


def test_resolver_tolerates_a_non_dict_payload(app):
    """Must not raise — the caller wraps this, but defence in depth."""
    with app.app_context():
        _normalize_org_claim(None)
        _backfill_org_from_db_user(None, _user(FROM_ROW))


# ── the g-based accessors ─────────────────────────────────────────────────


def test_accessors_read_from_g(app):
    with app.test_request_context():
        g.current_user = {"sub": "auth0|x"}
        resolve_request_org(g.current_user, _user(FROM_ROW))
        assert resolved_org_id() == FROM_ROW
        assert org_id_source() == "local_row"
        assert org_id_is_backfilled() is True


def test_accessors_safe_with_no_current_user(app):
    with app.test_request_context():
        assert resolved_org_id() is None
        assert org_id_source() is None
        assert org_id_is_backfilled() is False


def test_backfilled_flag_is_false_for_a_real_claim(app):
    with app.test_request_context():
        g.current_user = {"org_id": NATIVE}
        resolve_request_org(g.current_user, _user(FROM_ROW))
        assert resolved_org_id() == NATIVE
        assert org_id_is_backfilled() is False
