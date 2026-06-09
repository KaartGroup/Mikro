"""
Integration tests for ProjectService.role_scope_projects_query
and ProjectService.get_project_by_status.

Uses the shared db_session fixture (PostgreSQL, rolled back per test).
"""

import pytest
from api.database import db, Project, Region, Country, ProjectCountry
from api.database.core import Team, TeamLead, ProjectTeam, ProjectUser
from api.services.project_service import ProjectService

ORG = "scope-test-org"
TEAM_ADMIN_ID = "auth0|scope-team-admin"
OTHER_ADMIN_ID = "auth0|scope-other-admin"
PLAIN_USER_ID = "auth0|scope-plain-user"

svc = ProjectService()


class _User:
    def __init__(self, uid, role, org_id=ORG):
        self.id = uid
        self.role = role
        self.org_id = org_id


def _project(pid, org_id=ORG, created_by=None):
    return Project(
        id=pid,
        url=f"https://example.com/{pid}",
        org_id=org_id,
        created_by=created_by,
    )


def _base_query(org_id=ORG):
    """Mirrors what ProjectService.get builds before passing to role_scope_projects_query."""
    return Project.query.filter(Project.org_id == org_id)


# ── org_admin / super_admin ───────────────────────────────────────────────────


@pytest.mark.parametrize("role", ["admin", "super_admin"])
def test_admin_roles_see_all_org_projects(db_session, role):
    db_session.add_all([_project(9001), _project(9002)])
    db_session.flush()

    user = _User("auth0|scope-admin", role)
    ids = {p.id for p in svc.role_scope_projects_query(_base_query(), user).all()}

    assert {9001, 9002}.issubset(ids)


# ── team_admin ────────────────────────────────────────────────────────────────


def test_team_admin_sees_project_on_their_team(db_session):
    team = Team(name="Alpha", org_id=ORG)
    db_session.add(team)
    db_session.flush()

    db_session.add(_project(8001))
    db_session.flush()

    db_session.add(TeamLead(team_id=team.id, user_id=TEAM_ADMIN_ID))
    db_session.add(ProjectTeam(team_id=team.id, project_id=8001))
    db_session.flush()

    user = _User(TEAM_ADMIN_ID, "team_admin")
    ids = {p.id for p in svc.role_scope_projects_query(_base_query(), user).all()}

    assert 8001 in ids


def test_team_admin_sees_project_they_created(db_session):
    db_session.add(_project(8002, created_by=TEAM_ADMIN_ID))
    db_session.flush()

    user = _User(TEAM_ADMIN_ID, "team_admin")
    ids = {p.id for p in svc.role_scope_projects_query(_base_query(), user).all()}

    assert 8002 in ids


def test_team_admin_excluded_from_other_teams_projects(db_session):
    other_team = Team(name="Beta", org_id=ORG)
    db_session.add(other_team)
    db_session.flush()

    db_session.add(_project(8003, created_by=OTHER_ADMIN_ID))
    db_session.flush()

    db_session.add(ProjectTeam(team_id=other_team.id, project_id=8003))
    db_session.flush()

    user = _User(TEAM_ADMIN_ID, "team_admin")
    ids = {p.id for p in svc.role_scope_projects_query(_base_query(), user).all()}

    assert 8003 not in ids


def test_team_admin_sees_union_of_team_and_created_projects(db_session):
    team = Team(name="Gamma", org_id=ORG)
    db_session.add(team)
    db_session.flush()

    team_proj = _project(8004)
    created_proj = _project(8005, created_by=TEAM_ADMIN_ID)
    unrelated = _project(8006, created_by=OTHER_ADMIN_ID)
    db_session.add_all([team_proj, created_proj, unrelated])
    db_session.flush()

    db_session.add(TeamLead(team_id=team.id, user_id=TEAM_ADMIN_ID))
    db_session.add(ProjectTeam(team_id=team.id, project_id=8004))
    db_session.flush()

    user = _User(TEAM_ADMIN_ID, "team_admin")
    ids = {p.id for p in svc.role_scope_projects_query(_base_query(), user).all()}

    assert 8004 in ids      # on their team
    assert 8005 in ids      # created by them
    assert 8006 not in ids  # neither


# ── regular user ─────────────────────────────────────────────────────────────


def test_user_sees_only_explicitly_assigned_projects(db_session):
    db_session.add_all([_project(7001), _project(7002)])
    db_session.flush()

    db_session.add(ProjectUser(user_id=PLAIN_USER_ID, project_id=7001))
    db_session.flush()

    user = _User(PLAIN_USER_ID, "user")
    base = Project.query.filter(Project.org_id == ORG)
    ids = {p.id for p in svc.role_scope_projects_query(base, user).all()}

    assert 7001 in ids
    assert 7002 not in ids


# ── get_project_by_status ─────────────────────────────────────────────────────


def test_status_true_returns_only_active_projects(db_session):
    db_session.add_all([
        Project(id=6001, url="https://example.com/6001", org_id=ORG, status=True),
        Project(id=6002, url="https://example.com/6002", org_id=ORG, status=False),
    ])
    db_session.flush()

    base = Project.query.filter(Project.org_id == ORG)
    ids = {p.id for p in ProjectService.get_project_by_status(base, True).all()}

    assert 6001 in ids
    assert 6002 not in ids


def test_status_false_returns_only_inactive_projects(db_session):
    db_session.add_all([
        Project(id=6003, url="https://example.com/6003", org_id=ORG, status=True),
        Project(id=6004, url="https://example.com/6004", org_id=ORG, status=False),
    ])
    db_session.flush()

    base = Project.query.filter(Project.org_id == ORG)
    ids = {p.id for p in ProjectService.get_project_by_status(base, False).all()}

    assert 6003 not in ids
    assert 6004 in ids


@pytest.mark.parametrize("bad_status", [None, "active", 1, 0])
def test_non_bool_status_returns_query_unchanged(db_session, bad_status):
    db_session.add_all([_project(6005), _project(6006)])
    db_session.flush()

    base = Project.query.filter(Project.org_id == ORG)
    ids = {p.id for p in ProjectService.get_project_by_status(base, bad_status).all()}

    assert {6005, 6006}.issubset(ids)


# ── get_project_by_country ────────────────────────────────────────────────────


def test_country_filter_returns_only_linked_projects(db_session):
    country = Country(name="Testland", iso_code="TX")
    db_session.add(country)
    db_session.add_all([_project(5001), _project(5002)])
    db_session.flush()

    db_session.add(ProjectCountry(project_id=5001, country_id=country.id))
    db_session.flush()

    base = Project.query.filter(Project.org_id == ORG)
    ids = {p.id for p in ProjectService.get_project_by_country(base, country.id).all()}

    assert 5001 in ids
    assert 5002 not in ids


def test_country_filter_excludes_other_country(db_session):
    c1 = Country(name="Alpha", iso_code="AL")
    c2 = Country(name="Beta", iso_code="BT")
    db_session.add_all([c1, c2])
    db_session.add_all([_project(5003), _project(5004)])
    db_session.flush()

    db_session.add(ProjectCountry(project_id=5003, country_id=c1.id))
    db_session.add(ProjectCountry(project_id=5004, country_id=c2.id))
    db_session.flush()

    base = Project.query.filter(Project.org_id == ORG)
    ids = {p.id for p in ProjectService.get_project_by_country(base, c1.id).all()}

    assert 5003 in ids
    assert 5004 not in ids


# ── get_project_by_region ─────────────────────────────────────────────────────


def test_region_filter_returns_projects_in_region_countries(db_session):
    region = Region(name="East Africa")
    db_session.add(region)
    db_session.flush()

    country = Country(name="Kenya", iso_code="KE", region_id=region.id)
    db_session.add(country)
    db_session.add_all([_project(4001), _project(4002)])
    db_session.flush()

    db_session.add(ProjectCountry(project_id=4001, country_id=country.id))
    db_session.flush()

    base = Project.query.filter(Project.org_id == ORG)
    ids = {p.id for p in ProjectService.get_project_by_region(base, region.id).all()}

    assert 4001 in ids
    assert 4002 not in ids


def test_region_filter_excludes_project_in_different_region(db_session):
    r1 = Region(name="West Africa")
    r2 = Region(name="Southeast Asia")
    db_session.add_all([r1, r2])
    db_session.flush()

    c1 = Country(name="Ghana", iso_code="GH", region_id=r1.id)
    c2 = Country(name="Vietnam", iso_code="VN", region_id=r2.id)
    db_session.add_all([c1, c2])
    db_session.add_all([_project(4003), _project(4004)])
    db_session.flush()

    db_session.add(ProjectCountry(project_id=4003, country_id=c1.id))
    db_session.add(ProjectCountry(project_id=4004, country_id=c2.id))
    db_session.flush()

    base = Project.query.filter(Project.org_id == ORG)
    ids = {p.id for p in ProjectService.get_project_by_region(base, r1.id).all()}

    assert 4003 in ids
    assert 4004 not in ids


# ── get_project_by_team ───────────────────────────────────────────────────────


def test_team_filter_returns_only_projects_on_that_team(db_session):
    team = Team(name="Delta", org_id=ORG)
    db_session.add(team)
    db_session.add_all([_project(3001), _project(3002)])
    db_session.flush()

    db_session.add(ProjectTeam(team_id=team.id, project_id=3001))
    db_session.flush()

    base = Project.query.filter(Project.org_id == ORG)
    ids = {p.id for p in ProjectService.get_project_by_team(base, team.id).all()}

    assert 3001 in ids
    assert 3002 not in ids


def test_team_filter_excludes_projects_on_other_teams(db_session):
    t1 = Team(name="Epsilon", org_id=ORG)
    t2 = Team(name="Zeta", org_id=ORG)
    db_session.add_all([t1, t2])
    db_session.add_all([_project(3003), _project(3004)])
    db_session.flush()

    db_session.add(ProjectTeam(team_id=t1.id, project_id=3003))
    db_session.add(ProjectTeam(team_id=t2.id, project_id=3004))
    db_session.flush()

    base = Project.query.filter(Project.org_id == ORG)
    ids = {p.id for p in ProjectService.get_project_by_team(base, t1.id).all()}

    assert 3003 in ids
    assert 3004 not in ids


# ── get_project_by_created_by ─────────────────────────────────────────────────


def test_created_by_returns_only_own_projects(db_session):
    db_session.add_all([
        _project(2001, created_by=TEAM_ADMIN_ID),
        _project(2002, created_by=OTHER_ADMIN_ID),
    ])
    db_session.flush()

    base = Project.query.filter(Project.org_id == ORG)
    ids = {p.id for p in ProjectService.get_project_by_created_by(base, TEAM_ADMIN_ID).all()}

    assert 2001 in ids
    assert 2002 not in ids


def test_created_by_returns_empty_when_no_match(db_session):
    db_session.add(_project(2003, created_by=OTHER_ADMIN_ID))
    db_session.flush()

    base = Project.query.filter(Project.org_id == ORG)
    ids = {p.id for p in ProjectService.get_project_by_created_by(base, TEAM_ADMIN_ID).all()}

    assert 2003 not in ids


# ── get_project_by_assigned_users ─────────────────────────────────────────────


def test_assigned_users_returns_projects_with_any_matching_user(db_session):
    db_session.add_all([_project(1001), _project(1002), _project(1003)])
    db_session.flush()

    db_session.add(ProjectUser(user_id=PLAIN_USER_ID, project_id=1001))
    db_session.add(ProjectUser(user_id=OTHER_ADMIN_ID, project_id=1002))
    db_session.flush()

    base = Project.query.filter(Project.org_id == ORG)
    ids = {
        p.id for p in ProjectService.get_project_by_assigned_users(
            base, [PLAIN_USER_ID, OTHER_ADMIN_ID]
        ).all()
    }

    assert 1001 in ids
    assert 1002 in ids
    assert 1003 not in ids


def test_assigned_users_excludes_projects_for_other_users(db_session):
    db_session.add(_project(1004))
    db_session.flush()

    db_session.add(ProjectUser(user_id=OTHER_ADMIN_ID, project_id=1004))
    db_session.flush()

    base = Project.query.filter(Project.org_id == ORG)
    ids = {
        p.id for p in ProjectService.get_project_by_assigned_users(
            base, [PLAIN_USER_ID]
        ).all()
    }

    assert 1004 not in ids
