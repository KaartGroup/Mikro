"""
Unit tests for the plain (non-viewer) user repository (``api.users_repo``).

The lookups are thin wrappers over ``User.query``; the model is mocked so
the tests assert the filter shape (especially the optional org scoping on
``by_osm_username``) without a database.
"""

from unittest.mock import patch

from api import users_repo


def test_by_id_returns_none_for_falsy():
    assert users_repo.by_id(None) is None
    assert users_repo.by_id("") is None


def test_by_id_delegates_to_query_get():
    with patch("api.users_repo.User") as MU:
        MU.query.get.return_value = "user-row"
        assert users_repo.by_id("auth0|1") == "user-row"
        MU.query.get.assert_called_once_with("auth0|1")


def test_by_ids_empty_input_short_circuits():
    with patch("api.users_repo.User") as MU:
        assert users_repo.by_ids([]) == []
        assert users_repo.by_ids(None) == []
        MU.query.filter.assert_not_called()


def test_by_ids_filters_in():
    with patch("api.users_repo.User") as MU:
        MU.query.filter.return_value.all.return_value = ["a", "b"]
        assert users_repo.by_ids(["x", "y"]) == ["a", "b"]
        MU.query.filter.assert_called_once()


def test_by_osm_username_none_for_empty():
    assert users_repo.by_osm_username("") is None


def test_by_osm_username_unscoped_when_no_org():
    with patch("api.users_repo.User") as MU:
        MU.query.filter.return_value.first.return_value = "row"
        assert users_repo.by_osm_username("mapper1") == "row"
        # Exactly one filter (osm_username) when no org is supplied.
        MU.query.filter.assert_called_once()
        MU.query.filter.return_value.filter.assert_not_called()


def test_by_osm_username_org_scoped_adds_filter():
    with patch("api.users_repo.User") as MU:
        chained = MU.query.filter.return_value
        chained.filter.return_value.first.return_value = "row"
        assert users_repo.by_osm_username("mapper1", org_id="org1") == "row"
        # Second filter applied for the org rail.
        chained.filter.assert_called_once()


def test_by_org_none_org_returns_empty():
    with patch("api.users_repo.User") as MU:
        assert users_repo.by_org(None) == []
        MU.query.filter.assert_not_called()


def test_by_org_active_only_adds_filter():
    with patch("api.users_repo.User") as MU:
        chained = MU.query.filter.return_value
        chained.filter.return_value.all.return_value = ["a"]
        assert users_repo.by_org("org1", active_only=True) == ["a"]
        chained.filter.assert_called_once()


def test_by_org_without_active_only():
    with patch("api.users_repo.User") as MU:
        MU.query.filter.return_value.all.return_value = ["a", "b"]
        assert users_repo.by_org("org1") == ["a", "b"]
        MU.query.filter.return_value.filter.assert_not_called()
