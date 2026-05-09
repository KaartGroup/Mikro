"""
Unit tests for the team-admin scoping policy. The helpers query
SQLAlchemy directly, so we mock the models to keep these tests fast
and DB-free.
"""

from unittest.mock import patch, MagicMock

from ..api.auth.team_scoping import (
    managed_team_ids_for,
    team_member_ids_for,
    team_admin_can_access_team,
    team_admin_can_access_user,
    is_admin_tier,
    is_org_admin_or_above,
    is_super_admin,
)


class _FakeUser:
    def __init__(self, id: str, role: str = "team_admin", org_id: str = "kaart-org"):
        self.id = id
        self.role = role
        self.org_id = org_id


class _FakeTeam:
    def __init__(self, id: int):
        self.id = id


class _FakeTeamUser:
    def __init__(self, user_id: str, team_id: int):
        self.user_id = user_id
        self.team_id = team_id


# ---------- managed_team_ids_for ----------


def test_managed_team_ids_for_none_viewer():
    assert managed_team_ids_for(None) == []


def test_managed_team_ids_for_viewer_with_no_id():
    fake = MagicMock()
    fake.id = None
    assert managed_team_ids_for(fake) == []


def test_managed_team_ids_for_returns_team_ids():
    viewer = _FakeUser("auth0|lead")
    fake_filter = MagicMock()
    fake_filter.all.return_value = [_FakeTeam(1), _FakeTeam(2), _FakeTeam(7)]
    with patch("backend.api.auth.team_scoping.Team") as MockTeam:
        MockTeam.query.filter_by.return_value = fake_filter
        result = managed_team_ids_for(viewer)
    assert result == [1, 2, 7]
    MockTeam.query.filter_by.assert_called_once_with(
        lead_id="auth0|lead", org_id="kaart-org"
    )


def test_managed_team_ids_for_empty_when_not_a_lead_anywhere():
    viewer = _FakeUser("auth0|orphan")
    fake_filter = MagicMock()
    fake_filter.all.return_value = []
    with patch("backend.api.auth.team_scoping.Team") as MockTeam:
        MockTeam.query.filter_by.return_value = fake_filter
        assert managed_team_ids_for(viewer) == []


# ---------- team_member_ids_for ----------


def test_team_member_ids_for_empty_team_list():
    assert team_member_ids_for([]) == set()


def test_team_member_ids_for_returns_user_ids():
    fake_filter = MagicMock()
    fake_filter.all.return_value = [
        _FakeTeamUser("auth0|a", 1),
        _FakeTeamUser("auth0|b", 1),
        _FakeTeamUser("auth0|c", 2),
    ]
    with patch("backend.api.auth.team_scoping.TeamUser") as MockTU:
        MockTU.query.filter.return_value = fake_filter
        result = team_member_ids_for([1, 2])
    assert result == {"auth0|a", "auth0|b", "auth0|c"}


# ---------- team_admin_can_access_team ----------


def test_team_admin_can_access_team_yes():
    viewer = _FakeUser("auth0|lead")
    fake_filter = MagicMock()
    fake_filter.all.return_value = [_FakeTeam(1), _FakeTeam(5)]
    with patch("backend.api.auth.team_scoping.Team") as MockTeam:
        MockTeam.query.filter_by.return_value = fake_filter
        assert team_admin_can_access_team(viewer, 5)


def test_team_admin_can_access_team_no():
    viewer = _FakeUser("auth0|lead")
    fake_filter = MagicMock()
    fake_filter.all.return_value = [_FakeTeam(1), _FakeTeam(5)]
    with patch("backend.api.auth.team_scoping.Team") as MockTeam:
        MockTeam.query.filter_by.return_value = fake_filter
        assert not team_admin_can_access_team(viewer, 99)


def test_team_admin_can_access_team_none_inputs():
    assert not team_admin_can_access_team(None, 1)
    viewer = _FakeUser("auth0|lead")
    assert not team_admin_can_access_team(viewer, None)


# ---------- team_admin_can_access_user ----------


def test_team_admin_can_access_user_when_target_in_managed_team():
    viewer = _FakeUser("auth0|lead")
    team_filter = MagicMock()
    team_filter.all.return_value = [_FakeTeam(1)]
    membership_filter = MagicMock()
    membership_filter.first.return_value = _FakeTeamUser("auth0|member", 1)

    with patch("backend.api.auth.team_scoping.Team") as MockTeam, patch(
        "backend.api.auth.team_scoping.TeamUser"
    ) as MockTU:
        MockTeam.query.filter_by.return_value = team_filter
        MockTU.query.filter.return_value = membership_filter
        assert team_admin_can_access_user(viewer, "auth0|member")


def test_team_admin_can_access_user_when_target_not_in_team():
    viewer = _FakeUser("auth0|lead")
    team_filter = MagicMock()
    team_filter.all.return_value = [_FakeTeam(1)]
    membership_filter = MagicMock()
    membership_filter.first.return_value = None

    with patch("backend.api.auth.team_scoping.Team") as MockTeam, patch(
        "backend.api.auth.team_scoping.TeamUser"
    ) as MockTU:
        MockTeam.query.filter_by.return_value = team_filter
        MockTU.query.filter.return_value = membership_filter
        assert not team_admin_can_access_user(viewer, "auth0|stranger")


def test_team_admin_can_access_user_zero_managed_teams():
    """The empty-state team_admin: no teams led, no access to anyone."""
    viewer = _FakeUser("auth0|orphan")
    team_filter = MagicMock()
    team_filter.all.return_value = []

    with patch("backend.api.auth.team_scoping.Team") as MockTeam:
        MockTeam.query.filter_by.return_value = team_filter
        assert not team_admin_can_access_user(viewer, "auth0|x")


def test_team_admin_can_access_user_none_inputs():
    assert not team_admin_can_access_user(None, "auth0|x")
    viewer = _FakeUser("auth0|lead")
    assert not team_admin_can_access_user(viewer, None)
    assert not team_admin_can_access_user(viewer, "")


# ---------- role-tier convenience predicates ----------


def test_is_admin_tier_matches_all_three_admin_levels():
    assert is_admin_tier(_FakeUser("a", "admin"))
    assert is_admin_tier(_FakeUser("b", "super_admin"))
    assert is_admin_tier(_FakeUser("c", "team_admin"))


def test_is_admin_tier_rejects_non_admins():
    assert not is_admin_tier(_FakeUser("a", "validator"))
    assert not is_admin_tier(_FakeUser("b", "user"))
    assert not is_admin_tier(None)


def test_is_org_admin_or_above_excludes_team_admin():
    assert is_org_admin_or_above(_FakeUser("a", "admin"))
    assert is_org_admin_or_above(_FakeUser("b", "super_admin"))
    assert not is_org_admin_or_above(_FakeUser("c", "team_admin"))
    assert not is_org_admin_or_above(_FakeUser("d", "validator"))
    assert not is_org_admin_or_above(None)


def test_is_super_admin_only_super():
    assert is_super_admin(_FakeUser("a", "super_admin"))
    assert not is_super_admin(_FakeUser("b", "admin"))
    assert not is_super_admin(_FakeUser("c", "team_admin"))
    assert not is_super_admin(None)
