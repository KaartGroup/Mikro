#!/usr/bin/env python3
"""
Reusable filter resolution utilities for Mikro API.

Resolves a filters dict to sets of user IDs or OSM usernames.
AND across filter dimensions, OR within a dimension.

Example: filters = {"country": [1, 2], "team": [7]}
→ Users in (country 1 OR country 2) AND in team 7
"""

from .database import User, TeamUser, UserCountry, Country


def resolve_filtered_user_ids(filters, org_id):
    """
    Resolve a filters dict to a list of matching user IDs.

    Returns None if no filters are applied (meaning "all users").

    Args:
        filters: dict with dimension keys and list values, e.g.
                 {"country": [1, 2], "team": [7], "role": ["user"], "timezone": ["America/Bogota"]}
        org_id: organization ID for scoping

    Returns:
        list[str] | None: list of user IDs, or None if no filters
    """
    if not filters:
        return None

    # Start with all org users
    result_set = None

    for dimension, values in filters.items():
        if not values:
            continue

        ids = _resolve_dimension(dimension, values, org_id)
        if ids is None:
            continue

        if result_set is None:
            result_set = set(ids)
        else:
            result_set = result_set & set(ids)  # AND across dimensions

    if result_set is not None:
        return list(result_set)
    return None


def resolve_filtered_osm_usernames(filters, org_id):
    """
    Resolve filters to a list of OSM usernames (for editing stats queries).

    Returns None if no filters are applied.
    """
    user_ids = resolve_filtered_user_ids(filters, org_id)
    if user_ids is None:
        return None

    users = User.query.filter(User.id.in_(user_ids)).all()
    return [u.osm_username for u in users if u.osm_username]


def _resolve_dimension(dimension, values, org_id):
    """Resolve a single filter dimension to a set of user IDs."""

    if dimension == "country":
        # values are country IDs (integers)
        country_ids = [int(v) for v in values]
        rows = (
            UserCountry.query.filter(UserCountry.country_id.in_(country_ids))
            .with_entities(UserCountry.user_id)
            .all()
        )
        uc_user_ids = {r.user_id for r in rows}

        # Also include users with country_id directly set
        direct_rows = (
            User.query.filter(
                User.org_id == org_id,
                User.country_id.in_(country_ids),
            )
            .with_entities(User.id)
            .all()
        )
        direct_ids = {r.id for r in direct_rows}

        return uc_user_ids | direct_ids

    elif dimension == "region":
        # values are region IDs — resolve to countries in those regions, then users
        region_ids = [int(v) for v in values]
        country_rows = (
            Country.query.filter(Country.region_id.in_(region_ids))
            .with_entities(Country.id)
            .all()
        )
        country_ids = [r.id for r in country_rows]
        if not country_ids:
            return set()

        return _resolve_dimension("country", country_ids, org_id)

    elif dimension == "team":
        # values are team IDs
        team_ids = [int(v) for v in values]
        rows = (
            TeamUser.query.filter(TeamUser.team_id.in_(team_ids))
            .with_entities(TeamUser.user_id)
            .all()
        )
        return {r.user_id for r in rows}

    elif dimension == "role":
        # values are role strings
        rows = (
            User.query.filter(
                User.org_id == org_id,
                User.role.in_(values),
            )
            .with_entities(User.id)
            .all()
        )
        return {r.id for r in rows}

    elif dimension == "timezone":
        # values are timezone strings
        rows = (
            User.query.filter(
                User.org_id == org_id,
                User.timezone.in_(values),
            )
            .with_entities(User.id)
            .all()
        )
        return {r.id for r in rows}

    elif dimension == "user":
        # values are user IDs (direct user filter, replaces old userId param)
        return set(values)

    return None


def get_user_country_ids(user_id):
    """
    Return the set of country IDs associated with a user.

    Combines UserCountry associations AND the user's direct country_id field.
    """
    rows = (
        UserCountry.query.filter_by(user_id=user_id)
        .with_entities(UserCountry.country_id)
        .all()
    )
    ids = {r.country_id for r in rows}

    user = User.query.get(user_id)
    if user and user.country_id:
        ids.add(user.country_id)

    return ids


def is_visible_by_location(item_country_ids, user_country_ids):
    """
    Check if an item is visible to a user based on location restrictions.

    - No assignments on the item → visible to all (returns True).
    - Has assignments → must share at least one country with the user.
    """
    if not item_country_ids:
        return True
    return bool(item_country_ids & user_country_ids)
