"""
Integration tests for _get_daily_category_hours and _get_weekly_category_hours.

Requires the db_session fixture from conftest.py (real PostgreSQL, mikro_test DB).
Each test rolls back after itself — no data persists between tests.

Week boundaries: weeks run Sunday–Saturday.  The week key is the Sunday that
opens the week (e.g. Wednesday Jan 17 2024 → key "2024-01-14").
"""

import pytest
from datetime import datetime

from api.database import TimeEntry
from api.views.reports.timekeeping_stats import (
    _get_daily_category_hours,
    _get_weekly_category_hours,
)
from tests.conftest import USER_ID, OTHER_USER_ID, ORG

START = datetime(2024, 1, 14)  # Sunday
END = datetime(2024, 1, 29)    # Monday — 15-day window


def _entry(**kwargs):
    defaults = dict(
        user_id=USER_ID,
        org_id=ORG,
        activity="editing",
        subcategory_name=None,
        duration_seconds=3600,  # 1 hour
        status="completed",
        clock_in=datetime(2024, 1, 15, 10, 0),  # Monday
    )
    defaults.update(kwargs)
    return TimeEntry(**defaults)


# ---------------------------------------------------------------------------
# _get_daily_category_hours
# ---------------------------------------------------------------------------

def test_daily_same_day_same_category_sums_hours(db_session):
    db_session.add_all([
        _entry(clock_in=datetime(2024, 1, 15, 9, 0),  duration_seconds=3600),
        _entry(clock_in=datetime(2024, 1, 15, 14, 0), duration_seconds=1800),
    ])
    db_session.flush()

    result, _ = _get_daily_category_hours(ORG, START, END, None)

    assert len(result) == 1
    assert result[0]["day"] == "2024-01-15"
    assert result[0]["editing"] == pytest.approx(1.5, abs=0.05)


def test_daily_different_days_produce_sorted_buckets(db_session):
    db_session.add_all([
        _entry(clock_in=datetime(2024, 1, 16, 9, 0)),  # Tuesday  — inserted second
        _entry(clock_in=datetime(2024, 1, 15, 9, 0)),  # Monday   — inserted first
    ])
    db_session.flush()

    result, _ = _get_daily_category_hours(ORG, START, END, None)

    assert [r["day"] for r in result] == ["2024-01-15", "2024-01-16"]


def test_daily_multiple_categories_on_same_day(db_session):
    db_session.add_all([
        _entry(clock_in=datetime(2024, 1, 15, 9, 0),  activity="editing"),
        _entry(clock_in=datetime(2024, 1, 15, 14, 0), activity="meeting"),
    ])
    db_session.flush()

    result, cats = _get_daily_category_hours(ORG, START, END, None)

    assert len(result) == 1
    assert "editing" in result[0]
    assert "meeting" in result[0]
    assert cats == {"editing", "meeting"}


def test_daily_subcategory_drives_category_key(db_session):
    db_session.add(_entry(
        activity="qc_review",
        subcategory_name="Community QC",
        clock_in=datetime(2024, 1, 15, 10, 0),
    ))
    db_session.flush()

    result, _ = _get_daily_category_hours(ORG, START, END, None)

    assert result[0].get("community_qc") is not None


def test_daily_non_completed_entries_excluded(db_session):
    db_session.add_all([
        _entry(status="active"),
        _entry(status="completed"),
    ])
    db_session.flush()

    result, _ = _get_daily_category_hours(ORG, START, END, None)

    assert len(result) == 1
    assert result[0]["editing"] == pytest.approx(1.0, abs=0.05)


def test_daily_different_org_excluded(db_session):
    db_session.add_all([
        _entry(org_id="other-org"),
        _entry(org_id=ORG),
    ])
    db_session.flush()

    result, _ = _get_daily_category_hours(ORG, START, END, None)

    assert len(result) == 1
    assert result[0]["editing"] == pytest.approx(1.0, abs=0.05)


def test_daily_member_ids_filter_excludes_other_users(db_session):
    db_session.add_all([
        _entry(user_id=OTHER_USER_ID),
        _entry(user_id=USER_ID),
    ])
    db_session.flush()

    result, _ = _get_daily_category_hours(ORG, START, END, [USER_ID])

    assert len(result) == 1
    assert result[0]["editing"] == pytest.approx(1.0, abs=0.05)


# ---------------------------------------------------------------------------
# _get_weekly_category_hours
# ---------------------------------------------------------------------------

def test_weekly_entries_in_same_week_produce_one_bucket(db_session):
    db_session.add_all([
        _entry(clock_in=datetime(2024, 1, 15, 9, 0)),   # Monday Jan 15
        _entry(clock_in=datetime(2024, 1, 17, 14, 0)),  # Wednesday Jan 17
    ])
    db_session.flush()

    result, _ = _get_weekly_category_hours(ORG, START, END, None)

    assert len(result) == 1
    assert result[0]["week"] == "2024-01-14"  # preceding Sunday


def test_weekly_week_key_is_preceding_sunday(db_session):
    db_session.add(_entry(clock_in=datetime(2024, 1, 17, 10, 0)))  # Wednesday Jan 17
    db_session.flush()

    result, _ = _get_weekly_category_hours(ORG, START, END, None)

    assert result[0]["week"] == "2024-01-14"


def test_weekly_sunday_opens_new_week(db_session):
    db_session.add_all([
        _entry(clock_in=datetime(2024, 1, 20, 10, 0)),  # Saturday Jan 20 → week of Jan 14
        _entry(clock_in=datetime(2024, 1, 21, 10, 0)),  # Sunday   Jan 21 → week of Jan 21
    ])
    db_session.flush()

    result, _ = _get_weekly_category_hours(ORG, START, END, None)

    assert [r["week"] for r in result] == ["2024-01-14", "2024-01-21"]


def test_weekly_hours_summed_across_entries_in_same_week(db_session):
    db_session.add_all([
        _entry(clock_in=datetime(2024, 1, 15, 9, 0), duration_seconds=3600),  # 1 h
        _entry(clock_in=datetime(2024, 1, 16, 9, 0), duration_seconds=7200),  # 2 h
    ])
    db_session.flush()

    result, _ = _get_weekly_category_hours(ORG, START, END, None)

    assert len(result) == 1
    assert result[0]["editing"] == pytest.approx(3.0, abs=0.05)


def test_weekly_multiple_weeks_sorted(db_session):
    db_session.add_all([
        _entry(clock_in=datetime(2024, 1, 22, 9, 0)),  # week of Jan 21 — inserted first
        _entry(clock_in=datetime(2024, 1, 15, 9, 0)),  # week of Jan 14 — inserted second
    ])
    db_session.flush()

    result, _ = _get_weekly_category_hours(ORG, START, END, None)

    assert [r["week"] for r in result] == ["2024-01-14", "2024-01-21"]


# ---------------------------------------------------------------------------
# Realistic May 2026 data
#
# Dates: May 1 (Fri) and May 2 (Sat) fall in the week of 2026-04-26 (Sunday).
#        May 3 (Sun) opens a new week: 2026-05-03.
# ---------------------------------------------------------------------------

MAY_START = datetime(2026, 4, 26)  # Sunday
MAY_END = datetime(2026, 5, 5)     # day after last entry

def _may_entry(**kwargs):
    defaults = dict(
        user_id=USER_ID,
        org_id=ORG,
        activity="editing",
        subcategory_name=None,
        duration_seconds=3600,
        status="completed",
        clock_in=datetime(2026, 5, 1, 10, 0),
    )
    defaults.update(kwargs)
    return TimeEntry(**defaults)


def test_daily_two_activities_same_category_are_summed_not_overwritten(db_session):
    """qc_review and validating both map to 'qc'; hours must accumulate."""
    db_session.add_all([
        _may_entry(clock_in=datetime(2026, 5, 1, 9, 0),  activity="qc_review",  duration_seconds=8657),
        _may_entry(clock_in=datetime(2026, 5, 1, 10, 0), activity="validating",  duration_seconds=4409),
        _may_entry(clock_in=datetime(2026, 5, 1, 11, 0), activity="project_creation", duration_seconds=1103),
    ])
    db_session.flush()

    result, cats = _get_daily_category_hours(ORG, MAY_START, MAY_END, None)

    assert len(result) == 1
    day = result[0]
    assert day["day"] == "2026-05-01"
    assert day["qc"] == pytest.approx((8657 + 4409) / 3600, abs=0.05)
    assert day["project_creation"] == pytest.approx(1103 / 3600, abs=0.05)
    assert cats >= {"qc", "project_creation"}


def test_daily_other_with_community_outreach_subcategory(db_session):
    """'other' activity + 'Community Outreach' subcategory → community_outreach bucket."""
    db_session.add_all([
        _may_entry(clock_in=datetime(2026, 5, 3, 9, 0),  activity="other", subcategory_name="Community Outreach", duration_seconds=4893),
        _may_entry(clock_in=datetime(2026, 5, 3, 10, 0), activity="other", subcategory_name=None,                 duration_seconds=10905),
    ])
    db_session.flush()

    result, cats = _get_daily_category_hours(ORG, MAY_START, MAY_END, None)

    assert len(result) == 1
    day = result[0]
    assert day["community_outreach"] == pytest.approx(4893 / 3600, abs=0.05)
    assert day["other"] == pytest.approx(10905 / 3600, abs=0.05)
    assert cats == {"community_outreach", "other"}


def test_daily_multi_day_multi_category_realistic_data(db_session):
    """Four days of realistic data produce correct per-day category buckets."""
    db_session.add_all([
        # May 1 — qc family + project_creation
        _may_entry(clock_in=datetime(2026, 5, 1, 9, 0),  activity="qc_review",      duration_seconds=8657),
        _may_entry(clock_in=datetime(2026, 5, 1, 10, 0), activity="validating",      duration_seconds=4409),
        _may_entry(clock_in=datetime(2026, 5, 1, 11, 0), activity="project_creation",duration_seconds=1103),
        # May 2 — editing + qc + other
        _may_entry(clock_in=datetime(2026, 5, 2, 9, 0),  activity="editing",         duration_seconds=104134),
        _may_entry(clock_in=datetime(2026, 5, 2, 10, 0), activity="qc_review",       duration_seconds=5199),
        _may_entry(clock_in=datetime(2026, 5, 2, 11, 0), activity="other",           subcategory_name="Road updates and improvements", duration_seconds=3872),
        # May 3 — editing + qc + documentation + community_outreach + other
        _may_entry(clock_in=datetime(2026, 5, 3, 8, 0),  activity="documentation",   duration_seconds=1717),
        _may_entry(clock_in=datetime(2026, 5, 3, 9, 0),  activity="editing",         duration_seconds=114977),
        _may_entry(clock_in=datetime(2026, 5, 3, 10, 0), activity="other",           subcategory_name="Community Outreach", duration_seconds=4893),
        _may_entry(clock_in=datetime(2026, 5, 3, 11, 0), activity="other",           duration_seconds=10905),
        _may_entry(clock_in=datetime(2026, 5, 3, 13, 0), activity="qc_review",       duration_seconds=9705),
    ])
    db_session.flush()

    result, _ = _get_daily_category_hours(ORG, MAY_START, MAY_END, None)

    assert [r["day"] for r in result] == ["2026-05-01", "2026-05-02", "2026-05-03"]

    may1 = result[0]
    assert may1["qc"] == pytest.approx((8657 + 4409) / 3600, abs=0.05)
    assert may1["project_creation"] == pytest.approx(1103 / 3600, abs=0.05)

    may2 = result[1]
    assert may2["editing"] == pytest.approx(104134 / 3600, abs=0.05)
    assert may2["qc"] == pytest.approx(5199 / 3600, abs=0.05)
    assert may2["other"] == pytest.approx(3872 / 3600, abs=0.05)

    may3 = result[2]
    assert may3["editing"] == pytest.approx(114977 / 3600, abs=0.05)
    assert may3["qc"] == pytest.approx(9705 / 3600, abs=0.05)
    assert may3["documentation"] == pytest.approx(1717 / 3600, abs=0.05)
    assert may3["community_outreach"] == pytest.approx(4893 / 3600, abs=0.05)
    assert may3["other"] == pytest.approx(10905 / 3600, abs=0.05)


def test_weekly_may_data_spans_two_week_buckets(db_session):
    """May 1-2 (Fri-Sat) → week of 2026-04-26; May 3-4 (Sun-Mon) → week of 2026-05-03."""
    db_session.add_all([
        # Week of 2026-04-26
        _may_entry(clock_in=datetime(2026, 5, 1, 9, 0),  activity="qc_review",   duration_seconds=8657),
        _may_entry(clock_in=datetime(2026, 5, 1, 10, 0), activity="validating",   duration_seconds=4409),
        _may_entry(clock_in=datetime(2026, 5, 2, 9, 0),  activity="editing",      duration_seconds=104134),
        # Week of 2026-05-03
        _may_entry(clock_in=datetime(2026, 5, 3, 9, 0),  activity="editing",      duration_seconds=114977),
        _may_entry(clock_in=datetime(2026, 5, 3, 10, 0), activity="other",        subcategory_name="Community Outreach", duration_seconds=4893),
        _may_entry(clock_in=datetime(2026, 5, 4, 9, 0),  activity="documentation",duration_seconds=1000),
    ])
    db_session.flush()

    result, _ = _get_weekly_category_hours(ORG, MAY_START, MAY_END, None)

    assert [r["week"] for r in result] == ["2026-04-26", "2026-05-03"]

    w1 = result[0]
    assert w1["qc"] == pytest.approx((8657 + 4409) / 3600, abs=0.05)
    assert w1["editing"] == pytest.approx(104134 / 3600, abs=0.05)

    w2 = result[1]
    assert w2["editing"] == pytest.approx(114977 / 3600, abs=0.05)
    assert w2["community_outreach"] == pytest.approx(4893 / 3600, abs=0.05)
    assert w2["documentation"] == pytest.approx(1000 / 3600, abs=0.05)


def test_weekly_subcategory_drives_category_key(db_session):
    """community_outreach subcategory is applied in weekly buckets, not just daily."""
    db_session.add(_may_entry(
        clock_in=datetime(2026, 5, 1, 10, 0),
        activity="other",
        subcategory_name="Community Outreach",
        duration_seconds=3600,
    ))
    db_session.flush()

    result, _ = _get_weekly_category_hours(ORG, MAY_START, MAY_END, None)

    assert len(result) == 1
    assert "community_outreach" in result[0]
    assert "other" not in result[0]
