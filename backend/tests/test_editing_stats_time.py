"""
Characterization tests for the TimeEntry-backed pieces of editing_stats.

editing_stats is mostly Task-driven, but two helpers aggregate TimeEntry:
``_get_time_per_project`` (all-time completed seconds per project) and the
per-contributor ``total_hours`` inside ``_get_top_contributors`` (completed
seconds for a user inside the date window). These pin that behavior so the
Phase 4 migration onto AggregateQuery is provably equivalent.

Uses the shared db_session fixture (PostgreSQL, rolled back per test).
"""

from datetime import datetime

from api.database import TimeEntry, Task, User, Project
from api.views.reports.editing_stats import (
    _get_time_per_project,
    _get_top_contributors,
)
from tests.conftest import USER_ID, OTHER_USER_ID, ORG

WIN_START = datetime(2026, 4, 1)
WIN_END = datetime(2026, 5, 1)


def _projects(db_session, *pids):
    """time_entries.project_id has an FK to projects — seed the rows."""
    for pid in pids:
        db_session.add(
            Project(
                id=pid,
                url=f"https://example.com/{pid}",
                org_id=ORG,
                status=True,
                source="tm4",
            )
        )
    db_session.flush()


def _entry(**kwargs):
    defaults = dict(
        user_id=USER_ID,
        org_id=ORG,
        activity="editing",
        status="completed",
        clock_in=datetime(2026, 4, 15, 10, 0),
        clock_out=datetime(2026, 4, 15, 12, 0),
        duration_seconds=7200,
    )
    defaults.update(kwargs)
    return TimeEntry(**defaults)


# ── _get_time_per_project ───────────────────────────────────────────────────


def test_time_per_project_sums_completed_by_project(db_session):
    _projects(db_session, 10, 20)
    db_session.add_all(
        [
            _entry(project_id=10, duration_seconds=3600),
            _entry(project_id=10, duration_seconds=1800),
            _entry(project_id=20, duration_seconds=600),
        ]
    )
    db_session.flush()

    result = _get_time_per_project(ORG)

    assert result == {10: 5400, 20: 600}


def test_time_per_project_excludes_active_and_other_org_and_null_project(db_session):
    _projects(db_session, 10)
    db_session.add_all(
        [
            _entry(project_id=10, duration_seconds=3600),
            _entry(
                project_id=10, status="active", clock_out=None, duration_seconds=None
            ),
            _entry(project_id=10, org_id="other-org", duration_seconds=9999),
            _entry(project_id=None, duration_seconds=4242),
        ]
    )
    db_session.flush()

    result = _get_time_per_project(ORG)

    assert result == {10: 3600}


def test_time_per_project_is_all_time_ignores_dates(db_session):
    """No date window — a 2019 entry still counts."""
    _projects(db_session, 10)
    db_session.add(
        _entry(
            project_id=10,
            clock_in=datetime(2019, 1, 1, 9, 0),
            clock_out=datetime(2019, 1, 1, 10, 0),
            duration_seconds=3600,
        )
    )
    db_session.flush()

    assert _get_time_per_project(ORG) == {10: 3600}


# ── _get_top_contributors (total_hours field) ───────────────────────────────


def _contributor_setup(db_session):
    """One contributor (USER_ID / osm 'mapper1') with one mapped task in window."""
    user = User.query.get(USER_ID)
    user.osm_username = "mapper1"
    user.org_id = (
        ORG  # _get_top_contributors looks up the user by (osm_username, org_id)
    )
    user.first_name = "Map"
    user.last_name = "Per"
    db_session.add(
        Task(
            id=1,
            project_id=10,
            org_id=ORG,
            source="tm4",
            mapped=True,
            mapped_by="mapper1",
            date_mapped=datetime(2026, 4, 15, 9, 0),
        )
    )
    db_session.flush()


def test_top_contributor_hours_sum_completed_in_window(db_session):
    _contributor_setup(db_session)
    db_session.add_all(
        [
            _entry(duration_seconds=3600, clock_in=datetime(2026, 4, 10, 10, 0)),
            _entry(duration_seconds=1800, clock_in=datetime(2026, 4, 20, 10, 0)),
        ]
    )
    db_session.flush()

    rows = _get_top_contributors(ORG, "tm4", WIN_START, WIN_END, None)

    assert len(rows) == 1
    assert rows[0]["osm_username"] == "mapper1"
    assert rows[0]["total_hours"] == 1.5  # (3600 + 1800) / 3600


def test_top_contributor_hours_exclude_out_of_window_and_non_completed(db_session):
    _contributor_setup(db_session)
    db_session.add_all(
        [
            _entry(
                duration_seconds=3600, clock_in=datetime(2026, 4, 15, 10, 0)
            ),  # in window
            _entry(
                duration_seconds=9999, clock_in=datetime(2026, 3, 1, 10, 0)
            ),  # before window
            _entry(
                duration_seconds=9999, clock_in=datetime(2026, 6, 1, 10, 0)
            ),  # after window
            _entry(
                duration_seconds=None,
                status="active",
                clock_out=None,
                clock_in=datetime(2026, 4, 16, 10, 0),
            ),  # active
        ]
    )
    db_session.flush()

    rows = _get_top_contributors(ORG, "tm4", WIN_START, WIN_END, None)

    assert rows[0]["total_hours"] == 1.0  # only the single in-window completed entry
