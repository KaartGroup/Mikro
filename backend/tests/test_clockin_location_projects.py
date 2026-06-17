"""
Tests for the clock-in project list's location prioritization
(``ProjectAPI._serialize_user_projects`` → ``matches_user_location``).

A project is flagged ``matches_user_location`` when it shares a country with
the user, OR sits in a region the user is associated with. Projects with no
country assignment are never flagged. The frontend uses the flag to float a
mapper's local projects to the top of the clock-in picker.

Uses the shared ``db_session`` fixture (PostgreSQL, rolled back per test).
"""

import pytest
from flask import g

from api.views.Projects import ProjectAPI
from api.database import (
    User,
    Region,
    Country,
    UserCountry,
    Project,
    ProjectCountry,
)

from tests.conftest import USER_ID, ORG

_APP = {}


@pytest.fixture(autouse=True)
def _bind_app(app):
    _APP["app"] = app
    yield
    _APP.pop("app", None)


@pytest.fixture
def location_world(db_session):
    """User in region1/countryA, plus projects spanning every match case.

    - proj_country: in the user's exact country  -> match (country)
    - proj_region:  different country, same region -> match (region)
    - proj_other:   country in a different region  -> no match
    - proj_global:  no country assignment          -> no match
    """
    user = User.query.get(USER_ID)
    user.org_id = ORG
    db_session.flush()

    region1 = Region(name="loc-region-1", org_id=ORG)
    region2 = Region(name="loc-region-2", org_id=ORG)
    db_session.add_all([region1, region2])
    db_session.flush()

    country_a = Country(name="loc-country-a", region_id=region1.id)  # user's
    country_b = Country(name="loc-country-b", region_id=region1.id)  # same rgn
    country_c = Country(name="loc-country-c", region_id=region2.id)  # other rgn
    db_session.add_all([country_a, country_b, country_c])
    db_session.flush()

    db_session.add(
        UserCountry(user_id=USER_ID, country_id=country_a.id, is_primary=True)
    )

    def _proj(pid, name):
        p = Project(
            id=pid,
            name=name,
            url=f"https://example.com/{pid}",
            org_id=ORG,
            status=True,
        )
        db_session.add(p)
        return p

    proj_country = _proj(900001, "proj-country")
    proj_region = _proj(900002, "proj-region")
    proj_other = _proj(900003, "proj-other")
    proj_global = _proj(900004, "proj-global")
    db_session.flush()

    db_session.add_all(
        [
            ProjectCountry(project_id=proj_country.id, country_id=country_a.id),
            ProjectCountry(project_id=proj_region.id, country_id=country_b.id),
            ProjectCountry(project_id=proj_other.id, country_id=country_c.id),
        ]
    )
    db_session.flush()

    return {
        "user": user,
        "projects": [proj_country, proj_region, proj_other, proj_global],
    }


def _serialize(user, projects):
    with _APP["app"].test_request_context(json={}):
        g.user = user
        return ProjectAPI()._serialize_user_projects(projects)


def test_matches_user_location_flags_country_and_region(location_world):
    rows = _serialize(location_world["user"], location_world["projects"])
    flags = {r["id"]: r["matches_user_location"] for r in rows}

    assert flags[900001] is True  # exact country
    assert flags[900002] is True  # same region, different country
    assert flags[900003] is False  # different region
    assert flags[900004] is False  # no country assignment


def test_no_user_countries_means_no_matches(db_session, location_world):
    """A user with no country association matches nothing on location."""
    UserCountry.query.filter_by(user_id=USER_ID).delete()
    db_session.flush()

    rows = _serialize(location_world["user"], location_world["projects"])
    assert all(r["matches_user_location"] is False for r in rows)


def test_user_direct_country_id_also_counts(db_session, location_world):
    """get_user_country_ids folds in User.country_id, not just UserCountry.

    Drop the association but set country_id directly; the country-level
    project should still match.
    """
    UserCountry.query.filter_by(user_id=USER_ID).delete()
    user = location_world["user"]
    # country_a is the user's exact country (id resolved via the project link).
    proj_country = location_world["projects"][0]
    link = ProjectCountry.query.filter_by(project_id=proj_country.id).first()
    user.country_id = link.country_id
    db_session.flush()

    rows = _serialize(user, location_world["projects"])
    flags = {r["id"]: r["matches_user_location"] for r in rows}
    assert flags[900001] is True  # exact country via User.country_id
    assert flags[900003] is False  # different region still excluded
