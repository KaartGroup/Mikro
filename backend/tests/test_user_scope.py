"""
Unit tests for the user-visibility scoping policy (``api.auth.UserScope``).

The pure-logic methods (``visible_user_ids``, ``can_access``) carry the
policy and are exercised directly; the DB-touching collaborators
(``managed_team_ids_for``, ``team_member_ids_for``,
``resolve_filtered_user_ids``, ``team_admin_can_access_user``, ``User``)
are mocked so the suite stays fast and DB-free, matching
``test_team_scoping.py``.
"""

from unittest.mock import patch, MagicMock

from api.auth.user_scope import UserScope


class _FakeUser:
    def __init__(self, id: str, role: str = "user", org_id: str = "kaart-org"):
        self.id = id
        self.role = role
        self.org_id = org_id


# ---------- visible_user_ids: role gate (no filters) ----------


def test_visible_ids_org_admin_unconstrained():
    scope = UserScope(_FakeUser("a", role="admin"))
    with patch("api.auth.user_scope.resolve_filtered_user_ids", return_value=None):
        assert scope.visible_user_ids() is None


def test_visible_ids_super_admin_unconstrained():
    scope = UserScope(_FakeUser("a", role="super_admin"))
    with patch("api.auth.user_scope.resolve_filtered_user_ids", return_value=None):
        assert scope.visible_user_ids() is None


def test_visible_ids_team_admin_managed_members():
    scope = UserScope(_FakeUser("lead", role="team_admin"))
    with patch("api.auth.user_scope.managed_team_ids_for", return_value=[1, 2]), patch(
        "api.auth.user_scope.team_member_ids_for", return_value={"u1", "u2"}
    ), patch("api.auth.user_scope.resolve_filtered_user_ids", return_value=None):
        assert scope.visible_user_ids() == {"u1", "u2"}


def test_visible_ids_zero_team_team_admin_is_empty():
    scope = UserScope(_FakeUser("lead", role="team_admin"))
    with patch("api.auth.user_scope.managed_team_ids_for", return_value=[]), patch(
        "api.auth.user_scope.team_member_ids_for", return_value=set()
    ), patch("api.auth.user_scope.resolve_filtered_user_ids", return_value=None):
        assert scope.visible_user_ids() == set()


def test_visible_ids_plain_user_is_empty():
    scope = UserScope(_FakeUser("u", role="user"))
    with patch("api.auth.user_scope.resolve_filtered_user_ids", return_value=None):
        assert scope.visible_user_ids() == set()


# ---------- visible_user_ids: filter intersection ----------


def test_visible_ids_org_admin_with_filters_returns_filtered_set():
    scope = UserScope(_FakeUser("a", role="admin"))
    with patch(
        "api.auth.user_scope.resolve_filtered_user_ids", return_value=["a", "b"]
    ):
        assert scope.visible_user_ids({"team": [1]}) == {"a", "b"}


def test_visible_ids_filter_narrows_team_admin_never_widens():
    scope = UserScope(_FakeUser("lead", role="team_admin"))
    with patch("api.auth.user_scope.managed_team_ids_for", return_value=[1]), patch(
        "api.auth.user_scope.team_member_ids_for", return_value={"u1", "u2", "u3"}
    ), patch(
        "api.auth.user_scope.resolve_filtered_user_ids",
        return_value=["u2", "u3", "outsider"],
    ):
        # "outsider" is in the filter but outside the team ceiling → dropped.
        assert scope.visible_user_ids({"role": ["user"]}) == {"u2", "u3"}


def test_visible_ids_org_admin_with_empty_filter_match_is_empty():
    scope = UserScope(_FakeUser("a", role="admin"))
    with patch("api.auth.user_scope.resolve_filtered_user_ids", return_value=[]):
        assert scope.visible_user_ids({"country": [999]}) == set()


# ---------- can_access ----------


def test_can_access_none_viewer_or_target():
    assert UserScope(None).can_access(_FakeUser("x")) is False
    assert UserScope(_FakeUser("a", role="admin")).can_access(None) is False


def test_can_access_self_always_allowed():
    me = _FakeUser("me", role="user")
    assert UserScope(me).can_access(me) is True


def test_can_access_org_admin_same_org():
    scope = UserScope(_FakeUser("a", role="admin", org_id="org1"))
    assert scope.can_access(_FakeUser("t", org_id="org1")) is True


def test_can_access_org_admin_other_org_denied():
    scope = UserScope(_FakeUser("a", role="admin", org_id="org1"))
    assert scope.can_access(_FakeUser("t", org_id="org2")) is False


def test_can_access_team_admin_delegates_to_team_helper():
    scope = UserScope(_FakeUser("lead", role="team_admin"))
    target = _FakeUser("t")
    with patch(
        "api.auth.user_scope.team_admin_can_access_user", return_value=True
    ) as gate:
        assert scope.can_access(target) is True
        gate.assert_called_once_with(scope.viewer, "t")


def test_can_access_team_admin_denied_when_not_in_team():
    scope = UserScope(_FakeUser("lead", role="team_admin"))
    with patch("api.auth.user_scope.team_admin_can_access_user", return_value=False):
        assert scope.can_access(_FakeUser("t")) is False


def test_can_access_plain_user_denied_for_others():
    scope = UserScope(_FakeUser("u", role="user"))
    assert scope.can_access(_FakeUser("other")) is False


# ---------- get ----------


def test_get_returns_user_when_accessible():
    scope = UserScope(_FakeUser("a", role="admin", org_id="org1"))
    target = _FakeUser("t", org_id="org1")
    with patch("api.auth.user_scope.User") as MU:
        MU.query.filter.return_value.first.return_value = target
        assert scope.get("t") is target


def test_get_returns_none_when_missing():
    scope = UserScope(_FakeUser("a", role="admin", org_id="org1"))
    with patch("api.auth.user_scope.User") as MU:
        MU.query.filter.return_value.first.return_value = None
        assert scope.get("t") is None


def test_get_returns_none_when_forbidden():
    # Found in DB but access gate rejects (team_admin, not on a managed team).
    scope = UserScope(_FakeUser("lead", role="team_admin", org_id="org1"))
    target = _FakeUser("t", org_id="org1")
    with patch("api.auth.user_scope.User") as MU, patch(
        "api.auth.user_scope.team_admin_can_access_user", return_value=False
    ):
        MU.query.filter.return_value.first.return_value = target
        assert scope.get("t") is None


def test_get_none_for_falsy_id():
    scope = UserScope(_FakeUser("a", role="admin"))
    assert scope.get(None) is None
    assert scope.get("") is None


# ---------- query / users branch selection ----------


def test_query_org_admin_no_extra_id_filter():
    """org-admin + no filters → only the org filter is applied (no narrowing)."""
    scope = UserScope(_FakeUser("a", role="admin", org_id="org1"))
    fake_q = MagicMock()
    fake_q.filter.return_value = fake_q
    with patch("api.auth.user_scope.User") as MU, patch(
        "api.auth.user_scope.resolve_filtered_user_ids", return_value=None
    ):
        MU.query.filter.return_value = fake_q
        scope.query()
        # One narrowing call total: the org filter. No id/active narrowing.
        MU.query.filter.assert_called_once()
        fake_q.filter.assert_not_called()


def test_query_empty_scope_applies_narrowing_filter():
    """Plain user (empty scope) → a match-nothing narrowing filter is added."""
    scope = UserScope(_FakeUser("u", role="user", org_id="org1"))
    fake_q = MagicMock()
    fake_q.filter.return_value = fake_q
    with patch("api.auth.user_scope.User") as MU, patch(
        "api.auth.user_scope.resolve_filtered_user_ids", return_value=None
    ):
        MU.query.filter.return_value = fake_q
        scope.query()
        # org filter on User.query, then the match-nothing filter on the query.
        fake_q.filter.assert_called_once()


def test_users_delegates_to_query_all():
    scope = UserScope(_FakeUser("a", role="admin", org_id="org1"))
    sentinel = [object(), object()]
    with patch.object(UserScope, "query") as mock_query:
        mock_query.return_value.all.return_value = sentinel
        assert scope.users(active_only=True) == sentinel
        mock_query.assert_called_once_with(active_only=True)


# ---------- pay_visible ----------


def test_pay_visible_filters_by_can_view_pay_for():
    scope = UserScope(_FakeUser("a", role="admin"))
    keep = _FakeUser("keep")
    drop = _FakeUser("drop")
    with patch(
        "api.auth.user_scope.can_view_pay_for",
        side_effect=lambda v, u: u is keep,
    ):
        assert scope.pay_visible([keep, drop]) == [keep]
