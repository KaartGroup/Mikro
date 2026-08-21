"""
Tests for the projects export endpoint (`/api/project/fetch_projects_export`)
and the batch name-resolution helpers it relies on.

The load-bearing property is that the export does NOT reimplement visibility:
it runs through ProjectService, so a team admin gets exactly the projects they
created plus those assigned to a team they lead — which is precisely what was
asked for. The scope tests below assert that end to end through the handler,
not just on the query helper.
"""

import pytest
from flask import g

from api.database import (
    Country,
    Project,
    ProjectCountry,
    Region,
    User,
)
from api.database.core import ProjectTeam, ProjectUser, Team, TeamLead
from api.services.project_service import ProjectService
from api.views.Projects import ProjectAPI

from tests.conftest import ORG, OTHER_USER_ID, USER_ID

OTHER_ORG = "export-other-org"


def _project(pid, *, org_id=ORG, created_by=None, name=None, status=True):
    return Project(
        id=pid,
        name=name or f"Project {pid}",
        url=f"https://tasks.example.com/projects/{pid}",
        org_id=org_id,
        created_by=created_by,
        status=status,
    )


@pytest.fixture
def export_users(db_session):
    """The caller (a team admin) plus a teammate to assign to projects."""
    caller = db_session.get(User, USER_ID)
    mate = db_session.get(User, OTHER_USER_ID)
    for user in (caller, mate):
        user.org_id = ORG
        user.is_active = True
    caller.role = "team_admin"
    caller.first_name = "Logan"
    caller.last_name = "Lead"
    caller.email = "logan@example.com"
    mate.role = "user"
    mate.first_name = "Ada"
    mate.last_name = "Mapper"
    mate.email = "ada@example.com"
    db_session.flush()
    return caller, mate


def _export(app, caller, body=None):
    with app.test_request_context(json=body or {}):
        g.user = caller
        return ProjectAPI().fetch_projects_export()


def _by_id(response):
    return {row["id"]: row for row in response["projects"]}


# ── Scope: the actual ask ───────────────────────────────────────────────


def test_team_admin_exports_created_and_led_team_projects_only(
    app, db_session, export_users
):
    """ "Projects he created or to which his team is assigned" — and nothing
    else. This is the whole feature in one test."""
    caller, _ = export_users

    team = Team(name="Nigeria Field Team", org_id=ORG)
    other_team = Team(name="Somebody Else's Team", org_id=ORG)
    db_session.add_all([team, other_team])
    db_session.flush()

    db_session.add_all(
        [
            _project(60001, created_by=caller.id),  # created by him
            _project(60002),  # on his team
            _project(60003, created_by=OTHER_USER_ID),  # neither
        ]
    )
    db_session.flush()
    db_session.add_all(
        [
            TeamLead(team_id=team.id, user_id=caller.id),
            ProjectTeam(team_id=team.id, project_id=60002),
            ProjectTeam(team_id=other_team.id, project_id=60003),
        ]
    )
    db_session.flush()

    resp = _export(app, caller)

    assert resp["status"] == 200
    ids = set(_by_id(resp))
    assert 60001 in ids
    assert 60002 in ids
    assert 60003 not in ids


def test_export_never_crosses_org_boundaries(app, db_session, export_users):
    caller, _ = export_users
    db_session.add_all(
        [
            _project(60010, created_by=caller.id),
            _project(60011, org_id=OTHER_ORG, created_by=caller.id),
        ]
    )
    db_session.flush()

    ids = set(_by_id(_export(app, caller)))
    assert 60010 in ids
    assert 60011 not in ids


def test_org_admin_exports_the_whole_org(app, db_session, export_users):
    caller, _ = export_users
    caller.role = "admin"
    db_session.flush()

    db_session.add_all(
        [
            _project(60020, created_by=OTHER_USER_ID),
            _project(60021, created_by=OTHER_USER_ID),
        ]
    )
    db_session.flush()

    ids = set(_by_id(_export(app, caller)))
    assert {60020, 60021}.issubset(ids)


# ── Fields Logan asked for ──────────────────────────────────────────────


def test_row_carries_name_location_creator_and_assignees(app, db_session, export_users):
    caller, mate = export_users

    region = Region(name="West Africa", org_id=ORG)
    db_session.add(region)
    db_session.flush()
    country = Country(name="Nigeria", iso_code="NGA", region_id=region.id, org_id=ORG)
    db_session.add(country)
    db_session.flush()

    team = Team(name="Nigeria Field Team", org_id=ORG)
    db_session.add(team)
    db_session.flush()

    db_session.add(
        _project(60030, created_by=caller.id, name="Kaduna Building Mapping")
    )
    db_session.flush()
    db_session.add_all(
        [
            ProjectCountry(project_id=60030, country_id=country.id),
            ProjectTeam(team_id=team.id, project_id=60030),
            ProjectUser(user_id=mate.id, project_id=60030),
        ]
    )
    db_session.flush()

    row = _by_id(_export(app, caller))[60030]

    assert row["name"] == "Kaduna Building Mapping"
    assert row["countries"] == ["Nigeria"]
    assert row["regions"] == ["West Africa"]
    assert row["created_by_name"] == "Logan Lead"
    assert row["created_by_email"] == "logan@example.com"
    assert row["assigned_teams"] == ["Nigeria Field Team"]
    assert row["assigned_users"] == ["Ada Mapper"]


def test_export_omits_completion_data(app, db_session, export_users):
    """He explicitly does not want progress numbers, and leaving them out
    keeps this off the expensive per-project stats path."""
    caller, _ = export_users
    db_session.add(_project(60040, created_by=caller.id))
    db_session.flush()

    row = _by_id(_export(app, caller))[60040]

    for banned in (
        "total_mapped",
        "total_validated",
        "total_invalidated",
        "total_tasks",
        "payment_due",
        "total_payout",
    ):
        assert banned not in row


def test_multiple_countries_are_all_listed_regions_deduped(
    app, db_session, export_users
):
    caller, _ = export_users

    region = Region(name="East Africa", org_id=ORG)
    db_session.add(region)
    db_session.flush()
    kenya = Country(name="Kenya", iso_code="KEN", region_id=region.id, org_id=ORG)
    uganda = Country(name="Uganda", iso_code="UGA", region_id=region.id, org_id=ORG)
    db_session.add_all([kenya, uganda])
    db_session.flush()

    db_session.add(_project(60050, created_by=caller.id))
    db_session.flush()
    db_session.add_all(
        [
            ProjectCountry(project_id=60050, country_id=kenya.id),
            ProjectCountry(project_id=60050, country_id=uganda.id),
        ]
    )
    db_session.flush()

    row = _by_id(_export(app, caller))[60050]

    assert row["countries"] == ["Kenya", "Uganda"]
    # Both countries share one region — it must appear once, not twice.
    assert row["regions"] == ["East Africa"]


def test_country_without_a_region_contributes_no_blank_entry(
    app, db_session, export_users
):
    caller, _ = export_users
    orphan = Country(name="Atlantis", iso_code="ATL", region_id=None, org_id=ORG)
    db_session.add(orphan)
    db_session.flush()

    db_session.add(_project(60060, created_by=caller.id))
    db_session.flush()
    db_session.add(ProjectCountry(project_id=60060, country_id=orphan.id))
    db_session.flush()

    row = _by_id(_export(app, caller))[60060]

    assert row["countries"] == ["Atlantis"]
    assert row["regions"] == []


def test_project_with_no_creator_exports_blank_not_an_error(
    app, db_session, export_users
):
    """`created_by` is nullable — rows imported before the column existed
    carry none. That must be an empty cell, not a 500."""
    caller, _ = export_users
    team = Team(name="Legacy Team", org_id=ORG)
    db_session.add(team)
    db_session.flush()

    db_session.add(_project(60070, created_by=None))
    db_session.flush()
    db_session.add_all(
        [
            TeamLead(team_id=team.id, user_id=caller.id),
            ProjectTeam(team_id=team.id, project_id=60070),
        ]
    )
    db_session.flush()

    row = _by_id(_export(app, caller))[60070]

    assert row["created_by_name"] == ""
    assert row["created_by_email"] == ""


def test_unnamed_assignee_falls_back_to_email_then_id(app, db_session, export_users):
    """A blank cell reads as "nobody assigned", which is a different fact
    from "assigned to someone whose profile has no name"."""
    caller, mate = export_users
    mate.first_name = None
    mate.last_name = None
    db_session.flush()

    db_session.add(_project(60080, created_by=caller.id))
    db_session.flush()
    db_session.add(ProjectUser(user_id=mate.id, project_id=60080))
    db_session.flush()

    row = _by_id(_export(app, caller))[60080]
    assert row["assigned_users"] == ["ada@example.com"]


def test_soft_deleted_assignee_is_left_out(app, db_session, export_users):
    from datetime import datetime

    caller, mate = export_users
    db_session.add(_project(60090, created_by=caller.id))
    db_session.flush()
    db_session.add(ProjectUser(user_id=mate.id, project_id=60090))
    mate.deleted_date = datetime.utcnow()
    db_session.flush()

    row = _by_id(_export(app, caller))[60090]
    assert row["assigned_users"] == []


# ── Filters and limits ──────────────────────────────────────────────────


def test_filters_pass_through_so_the_file_matches_the_screen(
    app, db_session, export_users
):
    caller, _ = export_users
    db_session.add_all(
        [
            _project(60100, created_by=caller.id, name="Kaduna Buildings"),
            _project(60101, created_by=caller.id, name="Lagos Roads"),
        ]
    )
    db_session.flush()

    ids = set(_by_id(_export(app, caller, {"search": "Kaduna"})))
    assert 60100 in ids
    assert 60101 not in ids


def test_created_by_me_filter_narrows_to_his_own(app, db_session, export_users):
    caller, _ = export_users
    team = Team(name="Delta", org_id=ORG)
    db_session.add(team)
    db_session.flush()

    db_session.add_all([_project(60110, created_by=caller.id), _project(60111)])
    db_session.flush()
    db_session.add_all(
        [
            TeamLead(team_id=team.id, user_id=caller.id),
            ProjectTeam(team_id=team.id, project_id=60111),
        ]
    )
    db_session.flush()

    ids = set(_by_id(_export(app, caller, {"created_by_me": True})))
    assert 60110 in ids
    assert 60111 not in ids


def test_no_status_filter_covers_active_and_inactive(app, db_session, export_users):
    """The tabbed list always sends a status; the export should not have to.
    Omitting it must mean "both", not "active only"."""
    caller, _ = export_users
    db_session.add_all(
        [
            _project(60120, created_by=caller.id, status=True),
            _project(60121, created_by=caller.id, status=False),
        ]
    )
    db_session.flush()

    ids = set(_by_id(_export(app, caller)))
    assert {60120, 60121}.issubset(ids)


def test_status_filter_is_honoured_when_supplied(app, db_session, export_users):
    caller, _ = export_users
    db_session.add_all(
        [
            _project(60130, created_by=caller.id, status=True),
            _project(60131, created_by=caller.id, status=False),
        ]
    )
    db_session.flush()

    ids = set(_by_id(_export(app, caller, {"status": False})))
    assert 60131 in ids
    assert 60130 not in ids


def test_row_cap_truncates_and_says_so(app, db_session, export_users, monkeypatch):
    caller, _ = export_users
    monkeypatch.setattr(ProjectAPI, "EXPORT_ROW_CAP", 2)
    db_session.add_all([_project(60140 + i, created_by=caller.id) for i in range(4)])
    db_session.flush()

    resp = _export(app, caller)

    assert resp["count"] == 2
    assert resp["capped"] is True
    assert resp["row_cap"] == 2


def test_uncapped_export_reports_capped_false(app, db_session, export_users):
    caller, _ = export_users
    db_session.add(_project(60150, created_by=caller.id))
    db_session.flush()

    resp = _export(app, caller)
    assert resp["capped"] is False


# ── Batch helpers: no N+1 ───────────────────────────────────────────────


def test_name_helpers_return_empty_for_no_projects():
    svc = ProjectService()
    assert svc.get_country_and_region_names([]) == {}
    assert svc.get_team_names([]) == {}
    assert svc.get_assigned_user_names([]) == {}
    assert svc.get_creator_labels([]) == {}


def test_helpers_resolve_many_projects_in_one_pass(app, db_session, export_users):
    caller, mate = export_users
    team = Team(name="Batch Team", org_id=ORG)
    db_session.add(team)
    db_session.flush()

    ids = [60160, 60161, 60162]
    db_session.add_all([_project(pid, created_by=caller.id) for pid in ids])
    db_session.flush()
    for pid in ids:
        db_session.add(ProjectTeam(team_id=team.id, project_id=pid))
        db_session.add(ProjectUser(user_id=mate.id, project_id=pid))
    db_session.flush()

    svc = ProjectService()
    teams = svc.get_team_names(ids)
    users = svc.get_assigned_user_names(ids)

    assert all(teams[pid] == ["Batch Team"] for pid in ids)
    assert all(users[pid] == ["Ada Mapper"] for pid in ids)
