"""
Team-admin scoping policy — single source of truth.

Which teams does a `team_admin` manage? Which users are inside those
teams? Can this team_admin act on this team / user?

V1 rule: a `team_admin` manages every team where `Team.lead_id == user.id`.

The lookup is intentionally hidden behind helpers so a future migration
to multi-lead-per-team (a separate `TeamLead` association table) is a
one-function change. Do NOT add `Team.lead_id == ...` checks anywhere
else in the codebase — call `managed_team_ids_for()` instead.

These helpers fail closed: a None viewer, a missing target, or a
cross-org access attempt all return False / [] / set().
"""

from typing import Iterable

from ..database import Team, TeamUser, User


def managed_team_ids_for(viewer) -> list[int]:
    """Return the IDs of teams this user leads (i.e. acts as team_admin for).

    Empty list for any user who isn't a lead anywhere — including users
    whose role is `team_admin` but who haven't been assigned as the lead
    of any team yet (the "zero-team team_admin" empty state).
    """
    if viewer is None or getattr(viewer, "id", None) is None:
        return []
    rows = Team.query.filter_by(
        lead_id=viewer.id, org_id=viewer.org_id
    ).all()
    # Soft-deleted teams excluded — Team uses ModelWithSoftDeleteAndCRUD,
    # whose default query already filters deleted_date IS NULL.
    return [t.id for t in rows]


def team_member_ids_for(team_ids: Iterable[int]) -> set[str]:
    """Return the set of user IDs who are members of any of these teams."""
    ids = list(team_ids)
    if not ids:
        return set()
    rows = TeamUser.query.filter(TeamUser.team_id.in_(ids)).all()
    return {tu.user_id for tu in rows}


def team_admin_can_access_team(viewer, team_id: int) -> bool:
    """True if `viewer` is the lead of the given team.

    Used as the gate for team-write operations (assign/unassign members,
    projects, trainings, checklists). Caller must already have confirmed
    `viewer.role == "team_admin"`. Org Admin / super_admin bypass this
    check via the decorator layer; they don't need a lead row.
    """
    if viewer is None or team_id is None:
        return False
    return team_id in managed_team_ids_for(viewer)


def team_admin_can_access_user(viewer, target_user_id: str) -> bool:
    """True if `target_user_id` is a member of any team `viewer` leads.

    A team_admin acting on a user (editing profile, processing payment,
    viewing time entries) must pass this gate. Self-access is allowed
    independently — the caller usually checks `viewer.id == target_id`
    before falling through to this function.

    Cross-org leakage prevention: `managed_team_ids_for` already
    constrains team rows to `org_id == viewer.org_id`, so a `team_admin`
    cannot reach a user in another org via this helper even if a
    pathological data state existed.
    """
    if viewer is None or not target_user_id:
        return False
    managed = managed_team_ids_for(viewer)
    if not managed:
        return False
    return TeamUser.query.filter(
        TeamUser.user_id == target_user_id,
        TeamUser.team_id.in_(managed),
    ).first() is not None


def is_admin_tier(viewer) -> bool:
    """True if viewer is any admin tier (super_admin, admin, team_admin).

    Convenience for places that already authorize all three but want a
    single predicate. Most call sites should use the appropriate
    `requires_*` decorator instead of calling this directly.
    """
    if viewer is None:
        return False
    return getattr(viewer, "role", None) in {"super_admin", "admin", "team_admin"}


def is_org_admin_or_above(viewer) -> bool:
    """True if viewer is admin or super_admin (NOT team_admin).

    Use for operations only Org Admins should perform (create/delete
    teams, projects, trainings, promote-to-team_admin, region admin).
    """
    if viewer is None:
        return False
    return getattr(viewer, "role", None) in {"super_admin", "admin"}


def is_super_admin(viewer) -> bool:
    """True if viewer is super_admin. Cross-org operations only."""
    if viewer is None:
        return False
    return getattr(viewer, "role", None) == "super_admin"
