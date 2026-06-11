"""
Integration tests for TimeEntryQuery.

Requires the db_session fixture from conftest.py (real PostgreSQL, mikro_test DB).
Each test rolls back after itself — no data persists between tests.

Class signature:
    TimeEntryQuery(org_id, data, viewer)

Always scopes to status IN ("completed", "voided"). viewer.role drives user scoping:
  - "user"       → restricted to viewer.id regardless of data filters
  - "team_admin" → admin-level filters apply, then team-scoped via _apply_team_admin_scope
  - others       → admin-level filters (filters / userId / teamId) apply, no extra restriction
"""

import pytest
from datetime import datetime

from api.database import TimeEntry, Team, TeamUser, User
from api.utils.time_entry_query import TimeEntryQuery
from tests.conftest import USER_ID, OTHER_USER_ID, ORG

BASE_CLOCK_IN = datetime(2026, 4, 24, 18, 43, 31)
BASE_CLOCK_OUT = datetime(2026, 4, 24, 21, 26, 14)


def _entry(**kwargs):
    defaults = dict(
        user_id=USER_ID,
        org_id=ORG,
        activity="editing",
        status="completed",
        clock_in=BASE_CLOCK_IN,
        clock_out=BASE_CLOCK_OUT,
        duration_seconds=9762,
    )
    defaults.update(kwargs)
    return TimeEntry(**defaults)


class _FakeViewer:
    def __init__(self, role="org_admin", user_id=USER_ID):
        self.id = user_id
        self.role = role


ADMIN_VIEWER = _FakeViewer(role="org_admin")


def _query(data=None, viewer=None):
    return TimeEntryQuery(ORG, data or {}, viewer=viewer or ADMIN_VIEWER)


def _name(db_session, user_id, first, last):
    """Set first/last name on a fixture user row for search tests."""
    user = User.query.get(user_id)
    user.first_name = first
    user.last_name = last
    db_session.flush()


# ---------------------------------------------------------------------------
# Group 1 — Base scoping & ordering
# ---------------------------------------------------------------------------

def test_different_org_excluded(db_session):
    db_session.add_all([
        _entry(org_id="other-org"),
        _entry(org_id=ORG),
    ])
    db_session.flush()

    results = _query().fetch_all()

    assert len(results) == 1
    assert results[0].org_id == ORG


def test_active_entries_excluded(db_session):
    db_session.add_all([
        _entry(status="active", clock_out=None, duration_seconds=None),
        _entry(status="completed"),
    ])
    db_session.flush()

    results = _query().fetch_all()

    assert len(results) == 1
    assert results[0].status == "completed"


def test_voided_entries_included(db_session):
    db_session.add_all([
        _entry(status="voided"),
        _entry(status="completed"),
    ])
    db_session.flush()

    results = _query().fetch_all()
    statuses = {e.status for e in results}

    assert statuses == {"voided", "completed"}


def test_ordering_is_clock_in_desc(db_session):
    earlier = datetime(2026, 4, 19, 1, 0)
    later = datetime(2026, 5, 3, 17, 25)

    db_session.add_all([
        _entry(clock_in=earlier, user_id=OTHER_USER_ID),
        _entry(clock_in=later),
    ])
    db_session.flush()

    results = _query().fetch_all()

    assert results[0].clock_in == later
    assert results[1].clock_in == earlier


# ---------------------------------------------------------------------------
# Group 2 — user role scoping
# ---------------------------------------------------------------------------

def test_user_role_filters_to_own_entries(db_session):
    db_session.add_all([
        _entry(user_id=USER_ID),
        _entry(user_id=OTHER_USER_ID),
    ])
    db_session.flush()

    results = _query(viewer=_FakeViewer(role="user", user_id=USER_ID)).fetch_all()

    assert all(e.user_id == USER_ID for e in results)
    assert len(results) == 1


def test_user_role_ignores_data_user_id(db_session):
    """user role viewer is restricted to own data even when data specifies a different userId."""
    db_session.add_all([
        _entry(user_id=USER_ID),
        _entry(user_id=OTHER_USER_ID),
    ])
    db_session.flush()

    results = _query(
        data={"userId": OTHER_USER_ID},
        viewer=_FakeViewer(role="user", user_id=USER_ID),
    ).fetch_all()

    assert all(e.user_id == USER_ID for e in results)
    assert len(results) == 1


def test_user_role_ignores_team_id(db_session):
    """user role viewer is restricted to own data even when data specifies a teamId."""
    team = Team(name="Alpha", org_id=ORG)
    db_session.add(team)
    db_session.flush()

    db_session.add(TeamUser(team_id=team.id, user_id=OTHER_USER_ID))
    db_session.add_all([
        _entry(user_id=USER_ID),
        _entry(user_id=OTHER_USER_ID),
    ])
    db_session.flush()

    results = _query(
        data={"teamId": team.id},
        viewer=_FakeViewer(role="user", user_id=USER_ID),
    ).fetch_all()

    assert all(e.user_id == USER_ID for e in results)
    assert len(results) == 1


# ---------------------------------------------------------------------------
# Group 3 — userId filter
# ---------------------------------------------------------------------------

def test_user_id_filter(db_session):
    db_session.add_all([
        _entry(user_id=USER_ID),
        _entry(user_id=OTHER_USER_ID),
    ])
    db_session.flush()

    results = _query(data={"userId": USER_ID}).fetch_all()

    assert len(results) == 1
    assert results[0].user_id == USER_ID


def test_no_filters_returns_all_org_completed_and_voided(db_session):
    db_session.add_all([
        _entry(user_id=USER_ID, status="completed"),
        _entry(user_id=OTHER_USER_ID, status="voided"),
        _entry(user_id=USER_ID, status="active", clock_out=None, duration_seconds=None),
    ])
    db_session.flush()

    results = _query().fetch_all()

    assert len(results) == 2
    assert all(e.status in ("completed", "voided") for e in results)


# ---------------------------------------------------------------------------
# Group 4 — teamId filter
# ---------------------------------------------------------------------------

def test_team_id_includes_members(db_session):
    team = Team(name="Beta", org_id=ORG)
    db_session.add(team)
    db_session.flush()

    db_session.add(TeamUser(team_id=team.id, user_id=USER_ID))
    db_session.add_all([
        _entry(user_id=USER_ID),
        _entry(user_id=OTHER_USER_ID),
    ])
    db_session.flush()

    results = _query(data={"teamId": team.id}).fetch_all()

    assert len(results) == 1
    assert results[0].user_id == USER_ID


def test_team_id_excludes_non_members(db_session):
    team = Team(name="Gamma", org_id=ORG)
    db_session.add(team)
    db_session.flush()

    db_session.add_all([
        _entry(user_id=USER_ID),
        _entry(user_id=OTHER_USER_ID),
    ])
    db_session.flush()

    results = _query(data={"teamId": team.id}).fetch_all()

    assert results == []


def test_team_id_empty_team_returns_no_entries(db_session):
    """A team with zero TeamUser rows triggers the None-guard → empty result."""
    team = Team(name="Empty", org_id=ORG)
    db_session.add(team)
    db_session.flush()

    db_session.add(_entry(user_id=USER_ID))
    db_session.flush()

    results = _query(data={"teamId": team.id}).fetch_all()

    assert results == []


# ---------------------------------------------------------------------------
# Group 5 — filters dict (resolve_filtered_user_ids)
# ---------------------------------------------------------------------------

def test_filters_user_dimension(db_session):
    """filters={"user": [USER_ID]} restricts to that user via resolve_filtered_user_ids."""
    db_session.add_all([
        _entry(user_id=USER_ID),
        _entry(user_id=OTHER_USER_ID),
    ])
    db_session.flush()

    results = _query(data={"filters": {"user": [USER_ID]}}).fetch_all()

    assert len(results) == 1
    assert results[0].user_id == USER_ID


def test_filters_takes_priority_over_user_id(db_session):
    """When both 'filters' and 'userId' are in data, the filters branch runs."""
    db_session.add_all([
        _entry(user_id=USER_ID),
        _entry(user_id=OTHER_USER_ID),
    ])
    db_session.flush()

    results = _query(data={
        "filters": {"user": [USER_ID]},
        "userId": OTHER_USER_ID,
    }).fetch_all()

    assert len(results) == 1
    assert results[0].user_id == USER_ID


# ---------------------------------------------------------------------------
# Group 6 — Date filters
# ---------------------------------------------------------------------------

def test_start_date_only_excludes_earlier_entries(db_session):
    """startDate as a date-only string: entries before that date are excluded."""
    db_session.add_all([
        _entry(clock_in=datetime(2026, 4, 24, 18, 0)),
        _entry(clock_in=datetime(2026, 4, 25, 9, 0), user_id=OTHER_USER_ID),
    ])
    db_session.flush()

    results = _query(data={"startDate": "2026-04-25"}).fetch_all()

    assert len(results) == 1
    assert results[0].clock_in.date().isoformat() == "2026-04-25"


def test_end_date_only_includes_same_day(db_session):
    """endDate as a date-only string gets +1 day so the whole day is included."""
    db_session.add_all([
        _entry(clock_in=datetime(2026, 4, 24, 23, 59)),
        _entry(clock_in=datetime(2026, 4, 25, 0, 0), user_id=OTHER_USER_ID),
    ])
    db_session.flush()

    results = _query(data={"endDate": "2026-04-24"}).fetch_all()

    assert len(results) == 1
    assert results[0].clock_in.date().isoformat() == "2026-04-24"


def test_end_date_iso_datetime_is_exclusive(db_session):
    """endDate as ISO datetime is used as-is (no +1 day)."""
    db_session.add_all([
        _entry(clock_in=datetime(2026, 4, 24, 23, 59)),
        _entry(clock_in=datetime(2026, 4, 25, 0, 0), user_id=OTHER_USER_ID),
    ])
    db_session.flush()

    results = _query(data={"endDate": "2026-04-25T00:00:00Z"}).fetch_all()

    assert len(results) == 1
    assert results[0].clock_in < datetime(2026, 4, 25, 0, 0)


def test_date_range_combined(db_session):
    """start + end together bound the window on both sides."""
    db_session.add_all([
        _entry(clock_in=datetime(2026, 4, 18, 12, 0)),
        _entry(clock_in=datetime(2026, 4, 19, 1, 0), user_id=OTHER_USER_ID),
        _entry(clock_in=datetime(2026, 5, 3, 17, 0)),
    ])
    db_session.flush()

    results = _query(data={
        "startDate": "2026-04-19",
        "endDate": "2026-04-19",
    }).fetch_all()

    assert len(results) == 1
    assert results[0].clock_in.date().isoformat() == "2026-04-19"


# ---------------------------------------------------------------------------
# Group 7 — Activity / category filter
# ---------------------------------------------------------------------------

def test_category_key_filters_by_activity(db_session):
    db_session.add_all([
        _entry(activity="editing"),
        _entry(activity="training", user_id=OTHER_USER_ID),
    ])
    db_session.flush()

    results = _query(data={"category": "editing"}).fetch_all()

    assert len(results) == 1
    assert results[0].activity == "editing"


def test_activity_key_also_filters(db_session):
    db_session.add_all([
        _entry(activity="training"),
        _entry(activity="editing", user_id=OTHER_USER_ID),
    ])
    db_session.flush()

    results = _query(data={"activity": "training"}).fetch_all()

    assert len(results) == 1
    assert results[0].activity == "training"


def test_category_filter_is_case_insensitive(db_session):
    db_session.add(_entry(activity="editing"))
    db_session.flush()

    results = _query(data={"category": "EDITING"}).fetch_all()

    assert len(results) == 1
    assert results[0].activity == "editing"


# ---------------------------------------------------------------------------
# Group 8 — subcategoryName filter
# ---------------------------------------------------------------------------

def test_subcategory_name_match_included(db_session):
    db_session.add_all([
        _entry(subcategory_name="Kaart Project"),
        _entry(subcategory_name="Other Work", user_id=OTHER_USER_ID),
    ])
    db_session.flush()

    results = _query(data={"subcategoryName": "Kaart Project"}).fetch_all()

    assert len(results) == 1
    assert results[0].subcategory_name == "Kaart Project"


def test_subcategory_name_mismatch_excluded(db_session):
    db_session.add(_entry(subcategory_name="Road Updates"))
    db_session.flush()

    results = _query(data={"subcategoryName": "Kaart Project"}).fetch_all()

    assert results == []


# ---------------------------------------------------------------------------
# Group 9 — Cursor-based pagination
# ---------------------------------------------------------------------------

def test_cursor_excludes_entries_at_or_newer_than_cursor(db_session):
    """Entries at or after the cursor position (i.e. already seen) are excluded."""
    newer = datetime(2026, 5, 3, 17, 25)
    older = datetime(2026, 4, 19, 1, 0)

    db_session.add_all([
        _entry(clock_in=newer),
        _entry(clock_in=older, user_id=OTHER_USER_ID),
    ])
    db_session.flush()

    cursor_entry = TimeEntry.query.filter_by(clock_in=newer).first()

    results = _query(data={"cursor": {
        "clockIn": newer.isoformat() + "Z",
        "id": cursor_entry.id,
    }}).fetch_all()

    assert len(results) == 1
    assert results[0].clock_in == older


def test_cursor_tie_breaking_by_id(db_session):
    """When clock_in matches the cursor time, only entries with a lower id are included."""
    same_time = datetime(2026, 4, 24, 18, 43, 31)

    db_session.add_all([
        _entry(clock_in=same_time, user_id=USER_ID),
        _entry(clock_in=same_time, user_id=OTHER_USER_ID),
    ])
    db_session.flush()

    all_at_time = (
        TimeEntry.query
        .filter_by(clock_in=same_time, org_id=ORG)
        .order_by(TimeEntry.id.desc())
        .all()
    )
    cursor_entry = all_at_time[0]  # highest id — already seen

    results = _query(data={"cursor": {
        "clockIn": same_time.isoformat() + "Z",
        "id": cursor_entry.id,
    }}).fetch_all()

    assert len(results) == 1
    assert results[0].id < cursor_entry.id


def test_cursor_no_results_on_last_page(db_session):
    """When the cursor is the oldest entry, the next page is empty."""
    db_session.add(_entry(clock_in=datetime(2026, 4, 24, 18, 0)))
    db_session.flush()

    only_entry = TimeEntry.query.filter_by(org_id=ORG).first()

    results = _query(data={"cursor": {
        "clockIn": only_entry.clock_in.isoformat() + "Z",
        "id": only_entry.id,
    }}).fetch_all()

    assert results == []


# ---------------------------------------------------------------------------
# Group 10 — user name search filter
# ---------------------------------------------------------------------------

def test_search_matches_first_name(db_session):
    _name(db_session, USER_ID, "Jane", "Mapper")
    _name(db_session, OTHER_USER_ID, "Bob", "Builder")
    db_session.add_all([
        _entry(user_id=USER_ID),
        _entry(user_id=OTHER_USER_ID),
    ])
    db_session.flush()

    results = _query(data={"search": "jane"}).fetch_all()

    assert len(results) == 1
    assert results[0].user_id == USER_ID


def test_search_matches_full_name_across_first_and_last(db_session):
    """A term spanning first + last (e.g. 'jane m') matches the concatenation."""
    _name(db_session, USER_ID, "Jane", "Mapper")
    _name(db_session, OTHER_USER_ID, "Bob", "Builder")
    db_session.add_all([
        _entry(user_id=USER_ID),
        _entry(user_id=OTHER_USER_ID),
    ])
    db_session.flush()

    results = _query(data={"search": "jane m"}).fetch_all()

    assert len(results) == 1
    assert results[0].user_id == USER_ID


def test_search_matches_last_name_substring(db_session):
    _name(db_session, USER_ID, "Jane", "Mapper")
    _name(db_session, OTHER_USER_ID, "Bob", "Builder")
    db_session.add_all([
        _entry(user_id=USER_ID),
        _entry(user_id=OTHER_USER_ID),
    ])
    db_session.flush()

    results = _query(data={"search": "builder"}).fetch_all()

    assert len(results) == 1
    assert results[0].user_id == OTHER_USER_ID


def test_search_is_case_insensitive(db_session):
    _name(db_session, USER_ID, "Jane", "Mapper")
    db_session.add(_entry(user_id=USER_ID))
    db_session.flush()

    results = _query(data={"search": "JANE MAPPER"}).fetch_all()

    assert len(results) == 1
    assert results[0].user_id == USER_ID


def test_search_no_match_returns_empty(db_session):
    _name(db_session, USER_ID, "Jane", "Mapper")
    db_session.add(_entry(user_id=USER_ID))
    db_session.flush()

    results = _query(data={"search": "nonexistent"}).fetch_all()

    assert results == []


def test_search_blank_is_noop(db_session):
    """Empty/whitespace search applies no restriction."""
    _name(db_session, USER_ID, "Jane", "Mapper")
    _name(db_session, OTHER_USER_ID, "Bob", "Builder")
    db_session.add_all([
        _entry(user_id=USER_ID),
        _entry(user_id=OTHER_USER_ID),
    ])
    db_session.flush()

    results = _query(data={"search": "   "}).fetch_all()

    assert len(results) == 2


def test_search_combines_with_category(db_session):
    """search AND category both apply (intersection)."""
    _name(db_session, USER_ID, "Jane", "Mapper")
    _name(db_session, OTHER_USER_ID, "Jane", "Validator")
    db_session.add_all([
        _entry(user_id=USER_ID, activity="editing"),
        _entry(user_id=OTHER_USER_ID, activity="training"),
    ])
    db_session.flush()

    results = _query(data={"search": "jane", "category": "editing"}).fetch_all()

    assert len(results) == 1
    assert results[0].user_id == USER_ID


def test_cursor_ordering_is_stable_across_pages(db_session, monkeypatch):
    """Fetching two pages with a cursor produces the same total set as one big query."""
    monkeypatch.setattr(TimeEntryQuery, "PAGE_SIZE", 2)

    clock_ins = [
        datetime(2026, 5, 3, 17, 0),
        datetime(2026, 5, 2, 9, 0),
        datetime(2026, 4, 24, 18, 0),
        datetime(2026, 4, 19, 1, 0),
    ]
    users = [USER_ID, OTHER_USER_ID, USER_ID, OTHER_USER_ID]
    for ci, uid in zip(clock_ins, users):
        db_session.add(_entry(clock_in=ci, user_id=uid))
    db_session.flush()

    page1, cursor1 = _query().fetch_page()
    assert cursor1 is not None
    assert len(page1) == 2

    page2, cursor2 = _query(data={"cursor": cursor1}).fetch_page()
    assert len(page2) == 2
    assert cursor2 is None  # last page — no more entries

    combined_ids = [e.id for e in page1] + [e.id for e in page2]
    all_ids = [e.id for e in _query().fetch_all()]
    assert combined_ids == all_ids
