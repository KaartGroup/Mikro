"""
Unit tests for the time-tracking subcategory helpers.

Mocks SQLAlchemy queries so the suite is fast + DB-free, matching the
style of test_team_scoping.py and test_pay_visibility.py. Four units
under test, all at module scope in api/views/TimeTracking.py:

    - _team_admin_led_team_ids   — returns team_ids the user LEADS.
    - _can_manage_subcategory    — pure permission gate (create / edit
                                   / delete on a sub row).
    - _resolve_subcategory_for_write — validates sub + event-field
                                       fields for a clock-in / edit
                                       write. SSOT for the rejection
                                       paths every write goes through.
    - _visible_subcategories_query — exercised via the resolver above
                                     and through can-manage smoke
                                     checks (it builds a query object;
                                     contract-level assertions only).

NOTE on imports: uses absolute imports (``from api.views.TimeTracking
import ...``) rather than the relative pattern in the older test files.
The older files' ``from ..api...`` is broken under the current package
layout (no ``backend/__init__.py``); switching this file to absolute
imports lets the suite actually run from inside ``backend/`` without
re-architecting the whole tests package.
"""

from unittest.mock import patch, MagicMock

import pytest

from api.views.TimeTracking import (
    _can_manage_subcategory,
    _team_admin_led_team_ids,
    _resolve_subcategory_for_write,
)


# ─── Fakes ──────────────────────────────────────────────────────


class _FakeUser:
    """Minimal stand-in for the SQLAlchemy User. Just the attributes
    the helpers under test actually read."""

    def __init__(self, id, role, org_id="kaart-org"):
        self.id = id
        self.role = role
        self.org_id = org_id


class _FakeSub:
    """Minimal stand-in for ActivitySubcategory."""

    def __init__(
        self,
        id,
        activity,
        name,
        *,
        org_id=None,
        team_id=None,
        is_active=True,
        requires_project=False,
        allow_event_fields=False,
        created_by=None,
    ):
        self.id = id
        self.activity = activity
        self.name = name
        self.org_id = org_id
        self.team_id = team_id
        self.is_active = is_active
        self.requires_project = requires_project
        self.allow_event_fields = allow_event_fields
        # 2026-05-21: required by _can_manage_subcategory's authorship
        # rule for team_admin. Defaults to None so existing tests that
        # don't care about authorship (admin/super_admin paths) still
        # work without explicit values.
        self.created_by = created_by


class _FakeTeamLead:
    def __init__(self, user_id, team_id):
        self.user_id = user_id
        self.team_id = team_id


def _make_visible_query_mock(rows):
    """Build a chain mock that returns ``rows`` from .filter().first()
    and .filter().all() — used to stub out the result of
    _visible_subcategories_query inside resolver tests."""
    q = MagicMock()
    q.filter.return_value = q
    q.order_by.return_value = q
    q.first.return_value = rows[0] if rows else None
    q.all.return_value = rows
    return q


# ─── _team_admin_led_team_ids ────────────────────────────────────


def test_team_admin_led_team_ids_returns_empty_for_non_team_admin():
    """Helper is explicitly the team_admin gate — every other role
    gets an empty set even if they happen to have a TeamLead row."""
    for role in ("user", "validator", "admin", "super_admin"):
        u = _FakeUser("u", role)
        assert _team_admin_led_team_ids(u) == set()


@patch("api.views.TimeTracking.TeamLead")
def test_team_admin_led_team_ids_returns_led_team_ids(TeamLead):
    TeamLead.query.filter_by.return_value.all.return_value = [
        _FakeTeamLead("ta", 10),
        _FakeTeamLead("ta", 11),
    ]
    ta = _FakeUser("ta", "team_admin")
    assert _team_admin_led_team_ids(ta) == {10, 11}


@patch("api.views.TimeTracking.TeamLead")
def test_team_admin_led_team_ids_empty_when_no_leadership(TeamLead):
    TeamLead.query.filter_by.return_value.all.return_value = []
    ta = _FakeUser("ta", "team_admin")
    assert _team_admin_led_team_ids(ta) == set()


# ─── _can_manage_subcategory ─────────────────────────────────────


def test_super_admin_can_manage_any_scope():
    """super_admin is the only role that can touch GLOBAL subs and
    can also reach across orgs."""
    sup = _FakeUser("sup", "super_admin")
    assert _can_manage_subcategory(sup, org_id=None, team_id=None)
    assert _can_manage_subcategory(sup, org_id="kaart-org", team_id=None)
    assert _can_manage_subcategory(sup, org_id="external-org", team_id=None)
    assert _can_manage_subcategory(sup, org_id="external-org", team_id=42)


def test_admin_cannot_manage_global_subs():
    """Defense-in-depth: even an org-admin must not be able to create
    or edit GLOBAL subs (those are super_admin's only privilege)."""
    admin = _FakeUser("a", "admin", org_id="kaart-org")
    assert not _can_manage_subcategory(admin, org_id=None, team_id=None)


def test_admin_can_manage_subs_in_their_own_org():
    admin = _FakeUser("a", "admin", org_id="kaart-org")
    # Org-scoped, no team
    assert _can_manage_subcategory(admin, org_id="kaart-org", team_id=None)
    # Team-scoped within their org (admins see/manage all team subs in their org)
    assert _can_manage_subcategory(admin, org_id="kaart-org", team_id=7)


def test_admin_cannot_manage_other_org_subs():
    """Cross-org leakage check. The first line of defense against a
    misconfigured org_id parameter is right here."""
    admin = _FakeUser("a", "admin", org_id="kaart-org")
    assert not _can_manage_subcategory(admin, org_id="external-org", team_id=None)
    assert not _can_manage_subcategory(admin, org_id="external-org", team_id=99)


@patch("api.views.TimeTracking.TeamLead")
def test_team_admin_can_create_in_own_org_at_org_or_team_scope(TeamLead):
    """Updated 2026-05-21 (Logan taxonomy pass): team_admin gained the
    ability to CREATE subs in their own org at any non-global scope.
    Authorship-based edit gating happens separately (see below)."""
    TeamLead.query.filter_by.return_value.all.return_value = [
        _FakeTeamLead("ta", 10),
    ]
    ta = _FakeUser("ta", "team_admin", org_id="kaart-org")
    # Create-path calls pass org_id/team_id without `sub`.
    # Org-scoped in own org — NOW allowed (was denied pre-2026-05-21).
    assert _can_manage_subcategory(ta, org_id="kaart-org", team_id=None)
    # Team-scoped to a team they lead — allowed.
    assert _can_manage_subcategory(ta, org_id="kaart-org", team_id=10)
    # Team-scoped to a team they don't lead — also allowed at CREATE
    # path. Lead-only gating is enforced on UPDATE/DELETE through the
    # authorship + lead-fallback rule (tested below).
    assert _can_manage_subcategory(ta, org_id="kaart-org", team_id=11)


@patch("api.views.TimeTracking.TeamLead")
def test_team_admin_cannot_create_global_subs(TeamLead):
    """Global stays super_admin-only. team_admin's CREATE freedom is
    bounded by org_id != NULL."""
    TeamLead.query.filter_by.return_value.all.return_value = []
    ta = _FakeUser("ta", "team_admin", org_id="kaart-org")
    assert not _can_manage_subcategory(ta, org_id=None, team_id=None)


@patch("api.views.TimeTracking.TeamLead")
def test_team_admin_cannot_create_subs_in_other_org(TeamLead):
    """Cross-org rail. The org_id match is enforced before any other
    team_admin rule."""
    TeamLead.query.filter_by.return_value.all.return_value = []
    ta = _FakeUser("ta", "team_admin", org_id="kaart-org")
    assert not _can_manage_subcategory(ta, org_id="external-org", team_id=None)
    assert not _can_manage_subcategory(ta, org_id="external-org", team_id=10)


@patch("api.views.TimeTracking.TeamLead")
def test_team_admin_can_edit_sub_they_created(TeamLead):
    """Authorship rule (new 2026-05-21): a team_admin's own subs are
    editable regardless of scope (within their own org). This is how
    Logan's re-stamped seeded tree becomes editable for him."""
    TeamLead.query.filter_by.return_value.all.return_value = []
    ta = _FakeUser("ta", "team_admin", org_id="kaart-org")
    own_org_sub = _FakeSub(
        1, "qc_review", "Kaart QC",
        org_id="kaart-org", team_id=None,
    )
    own_org_sub.created_by = "ta"
    assert _can_manage_subcategory(ta, sub=own_org_sub)
    own_team_sub = _FakeSub(
        2, "meeting", "Daily Standup",
        org_id="kaart-org", team_id=99,
    )
    own_team_sub.created_by = "ta"
    assert _can_manage_subcategory(ta, sub=own_team_sub)


@patch("api.views.TimeTracking.TeamLead")
def test_team_admin_cannot_edit_sub_someone_else_created_in_their_org(TeamLead):
    """Flip side of the authorship rule: a team_admin can't touch
    subs owned by other people in their org. Prevents one team_admin
    from stomping another's edits to a shared org-scoped sub."""
    TeamLead.query.filter_by.return_value.all.return_value = []
    ta = _FakeUser("ta", "team_admin", org_id="kaart-org")
    org_sub_by_other = _FakeSub(
        1, "qc_review", "Kaart QC",
        org_id="kaart-org", team_id=None,
    )
    org_sub_by_other.created_by = "other-team-admin"
    assert not _can_manage_subcategory(ta, sub=org_sub_by_other)


@patch("api.views.TimeTracking.TeamLead")
def test_team_admin_can_edit_team_subs_for_led_teams_via_lead_fallback(TeamLead):
    """Even without authorship, team_admin can still manage team-scoped
    subs for teams they LEAD. Preserves the pre-2026-05-21 lead path
    for team-scoped subs that pre-date the authorship rule."""
    TeamLead.query.filter_by.return_value.all.return_value = [
        _FakeTeamLead("ta", 10),
    ]
    ta = _FakeUser("ta", "team_admin", org_id="kaart-org")
    sub_on_led_team_by_other = _FakeSub(
        1, "meeting", "Sprint Planning",
        org_id="kaart-org", team_id=10,
    )
    sub_on_led_team_by_other.created_by = "someone-else"
    assert _can_manage_subcategory(ta, sub=sub_on_led_team_by_other)
    # Same sub on a team they DON'T lead -> denied.
    sub_on_other_team = _FakeSub(
        2, "meeting", "Sprint Planning",
        org_id="kaart-org", team_id=11,
    )
    sub_on_other_team.created_by = "someone-else"
    assert not _can_manage_subcategory(ta, sub=sub_on_other_team)


@patch("api.views.TimeTracking.TeamLead")
def test_team_admin_cannot_edit_sub_in_other_org_even_if_they_created_it(TeamLead):
    """Cross-org rail wins even if Logan somehow owns a row in another
    org's catalog (shouldn't be possible via the create path; defensive
    against data anomalies)."""
    TeamLead.query.filter_by.return_value.all.return_value = []
    ta = _FakeUser("ta", "team_admin", org_id="kaart-org")
    foreign_sub = _FakeSub(
        1, "qc_review", "Kaart QC",
        org_id="external-org", team_id=None,
    )
    foreign_sub.created_by = "ta"  # authorship doesn't bypass cross-org
    assert not _can_manage_subcategory(ta, sub=foreign_sub)


def test_regular_user_and_validator_cannot_manage_anything():
    for role in ("user", "validator"):
        u = _FakeUser("u", role, org_id="kaart-org")
        assert not _can_manage_subcategory(u, org_id="kaart-org", team_id=None)
        assert not _can_manage_subcategory(u, org_id="kaart-org", team_id=10)
        assert not _can_manage_subcategory(u, org_id=None, team_id=None)


def test_can_manage_accepts_sub_instance_in_lieu_of_explicit_scope():
    """Either pass org_id/team_id explicitly, OR pass a sub instance —
    behavior must be identical, since both endpoints (create vs update)
    use different call sites."""
    admin = _FakeUser("a", "admin", org_id="kaart-org")
    own_org_sub = _FakeSub(1, "meeting", "Standup", org_id="kaart-org")
    foreign_sub = _FakeSub(2, "meeting", "Standup", org_id="external-org")
    assert _can_manage_subcategory(admin, sub=own_org_sub)
    assert not _can_manage_subcategory(admin, sub=foreign_sub)


# ─── _resolve_subcategory_for_write ──────────────────────────────


@patch("api.views.TimeTracking._visible_subcategories_query")
def test_resolver_with_no_sub_returns_all_nulls(qmock):
    """Clock-in with no subcategoryId in payload — sub_* fields stay
    NULL on the entry. This is the legacy / un-seeded code path; must
    not blow up."""
    qmock.return_value = _make_visible_query_mock([])
    u = _FakeUser("u", "user")
    out = _resolve_subcategory_for_write(u, "editing", None, None, None)
    assert out == {
        "subcategory_id": None,
        "subcategory_name": None,
        "retained_participants": None,
        "new_participants": None,
    }


@patch("api.views.TimeTracking._visible_subcategories_query")
def test_resolver_rejects_unknown_sub_id(qmock):
    """A sub id the user can't see -> 400 message about availability.
    Protects against URL-tampering: a team_admin in team A can't write
    a time entry tagged with team B's sub by guessing the id."""
    qmock.return_value = _make_visible_query_mock([])  # not visible
    u = _FakeUser("u", "user")
    with pytest.raises(ValueError, match="not available"):
        _resolve_subcategory_for_write(u, "editing", 999, None, None)


@patch("api.views.TimeTracking._visible_subcategories_query")
def test_resolver_rejects_non_integer_sub_id(qmock):
    qmock.return_value = _make_visible_query_mock([])
    u = _FakeUser("u", "user")
    with pytest.raises(ValueError, match="must be an integer"):
        _resolve_subcategory_for_write(u, "editing", "not-a-number", None, None)


@patch("api.views.TimeTracking._visible_subcategories_query")
def test_resolver_treats_empty_string_and_zero_as_not_provided(qmock):
    """Frontend may send subcategoryId as "" (uncontrolled <select>
    placeholder) or 0 — both should be treated as 'no sub picked',
    not as 'invalid id'."""
    qmock.return_value = _make_visible_query_mock([])
    u = _FakeUser("u", "user")
    out_empty = _resolve_subcategory_for_write(u, "editing", "", None, None)
    out_zero = _resolve_subcategory_for_write(u, "editing", 0, None, None)
    assert out_empty["subcategory_id"] is None
    assert out_zero["subcategory_id"] is None


@patch("api.views.TimeTracking._visible_subcategories_query")
def test_resolver_snapshots_sub_name_at_write_time(qmock):
    """Critical SSOT invariant: subcategory_name on the entry is taken
    from the row at write time, so future renames or soft-deletes never
    fragment historical reports."""
    sub = _FakeSub(7, "validating", "Kaart Project", org_id="kaart-org")
    qmock.return_value = _make_visible_query_mock([sub])
    u = _FakeUser("u", "user")
    out = _resolve_subcategory_for_write(u, "validating", 7, None, None)
    assert out["subcategory_id"] == 7
    assert out["subcategory_name"] == "Kaart Project"


@patch("api.views.TimeTracking._visible_subcategories_query")
def test_resolver_rejects_event_fields_when_sub_does_not_allow(qmock):
    """allow_event_fields = False -> reject any retained / new value.
    Surfacing the rejection (vs silent drop) makes a misconfigured UI
    obvious instead of producing entries that 'lost' their attendance
    counts."""
    sub = _FakeSub(1, "community", "General", allow_event_fields=False)
    qmock.return_value = _make_visible_query_mock([sub])
    u = _FakeUser("u", "user")
    with pytest.raises(ValueError, match="allow_event_fields"):
        _resolve_subcategory_for_write(u, "community", 1, 5, 2)


@patch("api.views.TimeTracking._visible_subcategories_query")
def test_resolver_accepts_event_fields_when_sub_allows(qmock):
    sub = _FakeSub(2, "community", "Events", allow_event_fields=True)
    qmock.return_value = _make_visible_query_mock([sub])
    u = _FakeUser("u", "user")
    out = _resolve_subcategory_for_write(u, "community", 2, 12, 3)
    assert out["retained_participants"] == 12
    assert out["new_participants"] == 3


@patch("api.views.TimeTracking._visible_subcategories_query")
def test_resolver_rejects_negative_event_counts(qmock):
    """Even on a sub that allows event fields, the counts must be
    non-negative integers — negatives don't represent anything
    meaningful for attendance."""
    sub = _FakeSub(2, "community", "Events", allow_event_fields=True)
    qmock.return_value = _make_visible_query_mock([sub])
    u = _FakeUser("u", "user")
    with pytest.raises(ValueError, match="non-negative"):
        _resolve_subcategory_for_write(u, "community", 2, -1, 0)


@patch("api.views.TimeTracking._visible_subcategories_query")
def test_resolver_rejects_non_integer_event_counts(qmock):
    sub = _FakeSub(2, "community", "Events", allow_event_fields=True)
    qmock.return_value = _make_visible_query_mock([sub])
    u = _FakeUser("u", "user")
    with pytest.raises(ValueError, match="non-negative"):
        _resolve_subcategory_for_write(u, "community", 2, "twelve", 3)


@patch("api.views.TimeTracking._visible_subcategories_query")
def test_resolver_treats_missing_event_counts_as_null(qmock):
    """A user clocking into a Community -> Events sub but who skips
    the attendance inputs should still succeed — the inputs are
    optional even on event-flagged subs."""
    sub = _FakeSub(2, "community", "Events", allow_event_fields=True)
    qmock.return_value = _make_visible_query_mock([sub])
    u = _FakeUser("u", "user")
    out = _resolve_subcategory_for_write(u, "community", 2, None, None)
    assert out["retained_participants"] is None
    assert out["new_participants"] is None


@patch("api.views.TimeTracking._visible_subcategories_query")
def test_resolver_treats_empty_string_event_counts_as_null(qmock):
    """Same as above but for the case where the frontend clears the
    number inputs to empty-string instead of unmounting them."""
    sub = _FakeSub(2, "community", "Events", allow_event_fields=True)
    qmock.return_value = _make_visible_query_mock([sub])
    u = _FakeUser("u", "user")
    out = _resolve_subcategory_for_write(u, "community", 2, "", "")
    assert out["retained_participants"] is None
    assert out["new_participants"] is None


@patch("api.views.TimeTracking._visible_subcategories_query")
def test_resolver_rejects_event_fields_when_no_sub_at_all(qmock):
    """If a payload includes event fields but NO sub, there's no row
    to consult for the allow flag — reject. This catches a class of
    bug where the frontend sends counts independent of the sub
    selection."""
    qmock.return_value = _make_visible_query_mock([])
    u = _FakeUser("u", "user")
    with pytest.raises(ValueError, match="allow_event_fields"):
        _resolve_subcategory_for_write(u, "community", None, 5, 2)


# ─── _visible_subcategories_query (behavioral, via proxies) ─────
#
# This function builds real SQLAlchemy column expressions and feeds
# them to ``or_()``, which doesn't accept MagicMock clauses — testing
# it directly would need a real DB session, which would defeat the
# DB-free style of the rest of the suite. Coverage of its behavior
# comes from two angles instead:
#
#   1. ``_resolve_subcategory_for_write`` tests above patch
#      ``_visible_subcategories_query`` to return canned rows, then
#      assert downstream validation. That covers "what callers do
#      with the result".
#
#   2. ``_can_manage_subcategory`` mirrors the per-role / per-scope
#      branches of the visibility query. The test below documents
#      that mirroring as the contract: anything an admin can MANAGE
#      they must also be able to SEE. If the visibility query and
#      the management gate diverge, this test won't catch it — but
#      it'll surface in code review of either one, since they're
#      both in TimeTracking.py within ~50 lines of each other and
#      share the same role/scope vocabulary.


def test_admin_sees_team_subs_they_arent_members_of_via_can_manage_proxy():
    """Behavioral coverage: an org-admin must be able to see + manage
    team-scoped subs even when they aren't a member of that team. Tested
    via the can-manage helper (whose admin branch mirrors the visibility
    branch in the SSOT query)."""
    admin = _FakeUser("a", "admin", org_id="kaart-org")
    team_sub_admin_not_member = _FakeSub(
        1, "meeting", "Daily Standup",
        org_id="kaart-org", team_id=99,
    )
    assert _can_manage_subcategory(admin, sub=team_sub_admin_not_member)
