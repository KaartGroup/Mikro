"""
Unit tests for the equivalent-period comparison helpers in api/utils/tz.py
(org_week_compare_bounds_utc / org_month_compare_bounds_utc).

Pure stdlib date math — no DB, no Flask context, no mocking. ``now_local`` is
passed explicitly (an aware ORG_TIMEZONE datetime) so the windows are
deterministic. Each helper returns naive-UTC bounds; we convert them back to
ORG_TIMEZONE local time to assert the intended wall-clock midnights.

Bug surface tested explicitly:

  - the previous-period window spans the *same number of fully completed days*
    that have elapsed in the current period (not the whole previous period),
  - period start / Sunday-anchor / month-1st edges (0 completed days → an
    empty comparison window),
  - a shorter previous month is clamped to its own end rather than bleeding
    into the current month,
  - local-midnight anchoring stays correct across a DST transition.

NOTE on imports: absolute imports, matching test_payroll_periods.py.
"""

from datetime import datetime, timezone

from api.utils.tz import (
    ORG_TIMEZONE,
    org_month_compare_bounds_utc,
    org_week_compare_bounds_utc,
)


def _local(naive_utc):
    """Render a naive-UTC datetime back in ORG_TIMEZONE for assertions."""
    return naive_utc.replace(tzinfo=timezone.utc).astimezone(ORG_TIMEZONE)


def _at(year, month, day, hour=0, minute=0):
    return datetime(year, month, day, hour, minute, tzinfo=ORG_TIMEZONE)


# ─── org_week_compare_bounds_utc ────────────────────────────────


def test_week_midweek_compares_equal_completed_days():
    # Wed 2026-06-17 → week started Sun 2026-06-14, 3 completed days (Sun-Tue).
    week_start, today_start, prev_week_start, prev_week_compare_end = (
        org_week_compare_bounds_utc(_at(2026, 6, 17, 14, 30))
    )
    assert _local(week_start) == _at(2026, 6, 14)
    assert _local(today_start) == _at(2026, 6, 17)
    assert _local(prev_week_start) == _at(2026, 6, 7)
    # Previous week's first 3 days: 2026-06-07 .. 2026-06-10 (exclusive).
    assert _local(prev_week_compare_end) == _at(2026, 6, 10)


def test_week_on_sunday_has_empty_comparison_window():
    # Sun 2026-06-21 → 0 completed days; both completed-day windows collapse.
    week_start, today_start, prev_week_start, prev_week_compare_end = (
        org_week_compare_bounds_utc(_at(2026, 6, 21, 9, 0))
    )
    assert _local(week_start) == _at(2026, 6, 21)
    assert today_start == week_start  # no completed days yet this week
    assert _local(prev_week_start) == _at(2026, 6, 14)
    assert prev_week_compare_end == prev_week_start  # empty baseline


def test_week_anchors_local_midnight_across_dst():
    # Wed 2026-03-11; the week (starting Sun 2026-03-08) spans the US DST
    # spring-forward. Local midnights must stay midnight: Mar 8 is MST (-7),
    # Mar 11 is MDT (-6).
    week_start, today_start, prev_week_start, prev_week_compare_end = (
        org_week_compare_bounds_utc(_at(2026, 3, 11, 12, 0))
    )
    assert week_start == datetime(2026, 3, 8, 7, 0)
    assert today_start == datetime(2026, 3, 11, 6, 0)
    assert prev_week_start == datetime(2026, 3, 1, 7, 0)
    assert prev_week_compare_end == datetime(2026, 3, 4, 7, 0)


# ─── org_month_compare_bounds_utc ───────────────────────────────


def test_month_midmonth_compares_equal_completed_days():
    # 2026-06-17 → 16 completed days this month (the 1st through the 16th).
    month_start, today_start, prev_month_start, prev_month_compare_end = (
        org_month_compare_bounds_utc(_at(2026, 6, 17, 14, 30))
    )
    assert _local(month_start) == _at(2026, 6, 1)
    assert _local(today_start) == _at(2026, 6, 17)
    assert _local(prev_month_start) == _at(2026, 5, 1)
    # Previous month's first 16 days: 2026-05-01 .. 2026-05-17 (exclusive).
    assert _local(prev_month_compare_end) == _at(2026, 5, 17)


def test_month_on_first_has_empty_comparison_window():
    # The 1st → 0 completed days; the comparison windows collapse to empty.
    month_start, today_start, prev_month_start, prev_month_compare_end = (
        org_month_compare_bounds_utc(_at(2026, 6, 1, 8, 0))
    )
    assert _local(month_start) == _at(2026, 6, 1)
    assert today_start == month_start
    assert _local(prev_month_start) == _at(2026, 5, 1)
    assert prev_month_compare_end == prev_month_start


def test_month_clamps_to_shorter_previous_month():
    # 2026-03-30 → 29 completed days, but February 2026 has only 28. The
    # previous-month window is clamped to Feb's end (= 2026-03-01 exclusive),
    # i.e. all of February, rather than bleeding into March.
    month_start, today_start, prev_month_start, prev_month_compare_end = (
        org_month_compare_bounds_utc(_at(2026, 3, 30, 10, 0))
    )
    assert _local(month_start) == _at(2026, 3, 1)
    assert _local(today_start) == _at(2026, 3, 30)
    assert _local(prev_month_start) == _at(2026, 2, 1)
    assert _local(prev_month_compare_end) == _at(2026, 3, 1)


# ─── smoke: default (now) call returns sane naive-UTC bounds ─────


def test_default_now_returns_ordered_naive_utc_bounds():
    for bounds in (org_week_compare_bounds_utc(), org_month_compare_bounds_utc()):
        period_start, today_start, prev_start, prev_compare_end = bounds
        assert all(b.tzinfo is None for b in bounds)
        assert period_start <= today_start
        assert prev_start < period_start
        assert prev_start <= prev_compare_end <= period_start
