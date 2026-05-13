from ...auth import managed_team_ids_for, team_member_ids_for
from ...database import User, TeamUser
from ...filters import resolve_filtered_osm_usernames, resolve_filtered_user_ids


def _team_admin_osm_usernames(viewer):
    """Return the OSM-usernames of users on `viewer`'s managed teams.

    Returns:
      - None if viewer is not team_admin (no scoping needed)
      - [] if viewer has no managed members with OSM usernames
      - list[str] of allowed OSM usernames otherwise
    """
    if viewer is None or getattr(viewer, "role", None) != "team_admin":
        return None
    managed = managed_team_ids_for(viewer)
    if not managed:
        return []
    member_ids = team_member_ids_for(managed)
    if not member_ids:
        return []
    rows = (
        User.query
        .with_entities(User.osm_username)
        .filter(User.id.in_(member_ids))
        .all()
    )
    return [r.osm_username for r in rows if r.osm_username]


def _intersect_or_assign(existing, new):
    """Combine an existing osm_usernames filter with a new one.

    If `existing` is None, the result is `new`.
    If both are lists, returns the intersection.
    """
    if existing is None:
        return new
    if new is None:
        return existing
    return [u for u in existing if u in set(new)]


def resolve_osm_username_filter(org_id, viewer, filters, user_id, team_id):
    """Resolve the osm_usernames allow-list from request filter params.

    Returns:
      - None  → no filter (all org members)
      - []    → sentinel meaning no results should be returned
      - list[str] → specific OSM usernames to allow
    """
    osm_usernames = None
    if filters:
        osm_usernames = resolve_filtered_osm_usernames(filters, org_id)
    elif user_id:
        user_obj = User.query.get(user_id)
        osm_usernames = [user_obj.osm_username] if (user_obj and user_obj.osm_username) else []
    elif team_id:
        member_users = (
            User.query.join(TeamUser, TeamUser.user_id == User.id)
            .filter(TeamUser.team_id == team_id)
            .all()
        )
        osm_usernames = [u.osm_username for u in member_users if u.osm_username]

    ta_osm = _team_admin_osm_usernames(viewer)
    if ta_osm is not None:
        osm_usernames = _intersect_or_assign(osm_usernames, ta_osm)
        if not osm_usernames:
            # Sentinel: ensure the query matches nothing rather than leaking org data
            osm_usernames = ["__team_admin_no_match__"]

    return osm_usernames


def resolve_member_id_filter(org_id, viewer, filters, user_id, team_id):
    """Resolve the user-ID allow-list for TimeEntry queries.

    Returns:
      - None  → no filter (all org members)
      - []    → no users allowed (caller should short-circuit or use sentinel)
      - list  → specific user IDs to allow
    """
    member_ids = None
    if filters:
        filtered_ids = resolve_filtered_user_ids(filters, org_id)
        if filtered_ids is not None:
            member_ids = filtered_ids
    elif user_id:
        member_ids = [user_id]
    elif team_id:
        member_ids = [tu.user_id for tu in TeamUser.query.filter_by(team_id=team_id).all()]

    if viewer and getattr(viewer, "role", None) == "team_admin":
        managed = managed_team_ids_for(viewer)
        if not managed:
            return []
        ta_member_ids = list(team_member_ids_for(managed))
        if member_ids is not None:
            member_ids = [u for u in member_ids if u in set(ta_member_ids)]
        else:
            member_ids = ta_member_ids

    return member_ids
