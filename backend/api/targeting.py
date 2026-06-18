"""
User-targeting helpers — single source of truth for resolving
"everyone in team X" / "everyone in region Y" / "everyone in org Z"
to a list of User rows, scoped to a specific org.

This lives in Mikro (not the comms service) because resolving recipients
requires Mikro's own Team / TeamUser / Country / User models. Mikro uses
these helpers to turn a broadcast target into a list of Auth0 subs, then
hands those subs to ``api.comms_client.emit_batch``.

NOTE on ``require_pref``: this kwarg filters by a per-user notification
preference column (e.g. ``notify_payment``). The current master ``User``
model does NOT carry any ``notify_*`` columns yet, so Mikro callers should
leave ``require_pref`` unset. The parameter is retained for forward
compatibility with the donor contract and is only exercised once those
columns are introduced.
"""

from typing import Optional

from .database import Country, Team, TeamUser, User


def team_member_users(
    team_id: int,
    org_id: str,
    *,
    exclude_user_id: Optional[str] = None,
    require_pref: Optional[str] = None,
) -> list:
    """All users in the given team, scoped to `org_id`. Returns [] if
    the team doesn't exist or isn't in this org.

    `exclude_user_id` drops one user (usually the sender).
    `require_pref` is the name of a User.notify_* column; if set, only
    users with that column = True are returned.
    """
    team = Team.query.get(team_id)
    if not team or team.org_id != org_id:
        return []
    member_rows = TeamUser.query.filter_by(team_id=team_id).all()
    ids = [m.user_id for m in member_rows if m.user_id != exclude_user_id]
    if not ids:
        return []
    q = User.query.filter(User.org_id == org_id, User.id.in_(ids))
    if require_pref:
        q = q.filter(getattr(User, require_pref).is_(True))
    return q.all()


def region_users(
    region_id: int,
    org_id: str,
    *,
    exclude_user_id: Optional[str] = None,
    require_pref: Optional[str] = None,
) -> list:
    """All users whose country belongs to the given region, in this org."""
    q = User.query.join(Country, User.country_id == Country.id).filter(
        User.org_id == org_id, Country.region_id == region_id
    )
    if exclude_user_id:
        q = q.filter(User.id != exclude_user_id)
    if require_pref:
        q = q.filter(getattr(User, require_pref).is_(True))
    return q.all()


def org_users(
    org_id: str,
    *,
    exclude_user_id: Optional[str] = None,
    require_pref: Optional[str] = None,
) -> list:
    """Every user in the given org."""
    q = User.query.filter(User.org_id == org_id)
    if exclude_user_id:
        q = q.filter(User.id != exclude_user_id)
    if require_pref:
        q = q.filter(getattr(User, require_pref).is_(True))
    return q.all()


def org_admin_users(
    org_id: str,
    *,
    exclude_user_id: Optional[str] = None,
) -> list:
    """Every org-admin-or-above user in the given org.

    Matches ``api.auth.team_scoping.is_org_admin_or_above`` — role in
    {``admin``, ``super_admin``}. Team admins are intentionally excluded
    (they are scoped to their own teams, not org-wide events).

    Used by triggers that must notify "all org admins" (adjustment requests,
    bank-info changes). Kept here so the admin-recipient policy stays in one
    place alongside the other fan-out resolvers.
    """
    admin_roles = ("admin", "super_admin")
    q = User.query.filter(User.org_id == org_id, User.role.in_(admin_roles))
    if exclude_user_id:
        q = q.filter(User.id != exclude_user_id)
    return q.all()


def org_admins_incl_team_admins(
    org_id: str,
    *,
    exclude_user_id: Optional[str] = None,
) -> list:
    """Every team-admin-or-above user in the given org.

    Like :func:`org_admin_users` but also includes ``team_admin`` — role in
    {``team_admin``, ``admin``, ``super_admin``}. Used by triggers (e.g.
    project reactivation requests) that any admin tier should be able to act
    on, since any team admin can restore an archived project in their org.
    """
    admin_roles = ("team_admin", "admin", "super_admin")
    q = User.query.filter(User.org_id == org_id, User.role.in_(admin_roles))
    if exclude_user_id:
        q = q.filter(User.id != exclude_user_id)
    return q.all()
