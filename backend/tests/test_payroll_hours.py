"""
Characterization tests for the payroll cycle-hours window.

Payroll is the one read path that windows on ``clock_out`` (not ``clock_in``)
and uses an INCLUSIVE calendar-date range (``cast(clock_out, Date)`` between
cycle_start and cycle_end), because a session that crosses midnight is paid in
the cycle it *ends* in. These tests pin that behavior so the Phase 4c
extraction onto PayrollHoursQuery is provably equivalent.

All fixtures live in a single org so the org-scoping added by the query class
stays a no-op — the assertions hold against both the pre- and post-refactor
implementations.

Uses the shared db_session fixture (PostgreSQL, rolled back per test).
"""

from datetime import datetime, date

from api.database import TimeEntry
from api.services.payment_cycle import PaymentCycleService
from api.time_tracking import PayrollHoursQuery
from tests.conftest import USER_ID, OTHER_USER_ID, ORG

CYCLE_START = date(2026, 5, 1)
CYCLE_END = date(2026, 5, 15)


def _entry(**kwargs):
    defaults = dict(
        user_id=USER_ID,
        org_id=ORG,
        activity="editing",
        status="completed",
        clock_in=datetime(2026, 5, 5, 9, 0),
        clock_out=datetime(2026, 5, 5, 11, 0),
        duration_seconds=7200,
    )
    defaults.update(kwargs)
    return TimeEntry(**defaults)


def _hours(user_ids=None, start=CYCLE_START, end=CYCLE_END):
    return PaymentCycleService(ORG).hours_by_user(user_ids, start, end)


# Full-month cycle for the weekly-bucket tests. week 1 is anchored to the
# Sunday on/before May 1 (Sun Apr 26), so May Sun–Sat weeks fall as:
#   wk1 Apr26–May2 · wk2 May3–9 · wk3 May10–16 · wk4 May17–23 · (overflow→wk4)
MONTH_START = date(2026, 5, 1)
MONTH_END = date(2026, 5, 31)


def _weekly(user_ids=None, start=MONTH_START, end=MONTH_END):
    return PaymentCycleService(ORG).hours_by_user_and_week(user_ids, start, end)


# ── clock_out is the window column ───────────────────────────────────────────


def test_windows_on_clock_out_not_clock_in(db_session):
    """A session starting before the cycle but ending inside it counts;
    one starting inside but ending after does NOT."""
    db_session.add_all(
        [
            # clock_in Apr 30 (before), clock_out May 1 (inside) → counted
            _entry(
                user_id=USER_ID,
                clock_in=datetime(2026, 4, 30, 23, 0),
                clock_out=datetime(2026, 5, 1, 1, 0),
                duration_seconds=7200,
            ),
            # clock_in May 15 (inside), clock_out May 16 (after) → excluded
            _entry(
                user_id=OTHER_USER_ID,
                clock_in=datetime(2026, 5, 15, 23, 0),
                clock_out=datetime(2026, 5, 16, 1, 0),
                duration_seconds=7200,
            ),
        ]
    )
    db_session.flush()

    assert _hours() == {USER_ID: 7200}


def test_inclusive_on_both_cycle_ends(db_session):
    """clock_out on cycle_start and on cycle_end (any time of day) are both in."""
    db_session.add_all(
        [
            _entry(
                clock_out=datetime(2026, 5, 1, 0, 1), duration_seconds=100
            ),  # start day
            _entry(
                clock_out=datetime(2026, 5, 15, 23, 59), duration_seconds=200
            ),  # end day, late
        ]
    )
    db_session.flush()

    assert _hours() == {USER_ID: 300}


def test_excludes_clock_out_outside_window(db_session):
    db_session.add_all(
        [
            _entry(
                clock_out=datetime(2026, 4, 30, 23, 59), duration_seconds=9999
            ),  # day before
            _entry(
                clock_out=datetime(2026, 5, 16, 0, 1), duration_seconds=8888
            ),  # day after
            _entry(
                clock_out=datetime(2026, 5, 7, 12, 0), duration_seconds=3600
            ),  # inside
        ]
    )
    db_session.flush()

    assert _hours() == {USER_ID: 3600}


# ── status / null clock_out ──────────────────────────────────────────────────


def test_excludes_active_and_voided(db_session):
    db_session.add_all(
        [
            _entry(status="completed", duration_seconds=3600),
            _entry(status="voided", duration_seconds=9999),
            _entry(status="active", clock_out=None, duration_seconds=None),
        ]
    )
    db_session.flush()

    assert _hours() == {USER_ID: 3600}


# ── user_ids filtering ───────────────────────────────────────────────────────


def test_user_ids_none_sums_all_users(db_session):
    db_session.add_all(
        [
            _entry(user_id=USER_ID, duration_seconds=3600),
            _entry(user_id=OTHER_USER_ID, duration_seconds=1800),
        ]
    )
    db_session.flush()

    assert _hours(user_ids=None) == {USER_ID: 3600, OTHER_USER_ID: 1800}


def test_user_ids_subset_filters(db_session):
    db_session.add_all(
        [
            _entry(user_id=USER_ID, duration_seconds=3600),
            _entry(user_id=OTHER_USER_ID, duration_seconds=1800),
        ]
    )
    db_session.flush()

    assert _hours(user_ids=[USER_ID]) == {USER_ID: 3600}


def test_user_ids_empty_short_circuits_to_empty(db_session):
    db_session.add(_entry(duration_seconds=3600))
    db_session.flush()

    assert _hours(user_ids=[]) == {}


def test_seconds_summed_per_user(db_session):
    db_session.add_all(
        [
            _entry(
                user_id=USER_ID,
                clock_out=datetime(2026, 5, 3, 11, 0),
                duration_seconds=3600,
            ),
            _entry(
                user_id=USER_ID,
                clock_out=datetime(2026, 5, 8, 11, 0),
                duration_seconds=1800,
            ),
        ]
    )
    db_session.flush()

    assert _hours(user_ids=[USER_ID]) == {USER_ID: 5400}


# ── sessions_in_cycle (Payments contributor-detail breakdown) ────────────────


def _sessions(user_id=USER_ID, start=CYCLE_START, end=CYCLE_END):
    return PayrollHoursQuery(ORG, {}, viewer=None).sessions_in_cycle(
        user_id, start, end
    )


def test_sessions_in_cycle_ordered_clock_in_asc_for_one_user(db_session):
    db_session.add_all(
        [
            _entry(
                user_id=USER_ID,
                clock_in=datetime(2026, 5, 8, 9, 0),
                clock_out=datetime(2026, 5, 8, 11, 0),
            ),
            _entry(
                user_id=USER_ID,
                clock_in=datetime(2026, 5, 3, 9, 0),
                clock_out=datetime(2026, 5, 3, 11, 0),
            ),
            _entry(
                user_id=OTHER_USER_ID,
                clock_in=datetime(2026, 5, 4, 9, 0),
                clock_out=datetime(2026, 5, 4, 11, 0),
            ),  # different user — excluded
        ]
    )
    db_session.flush()

    rows = _sessions(USER_ID)

    assert [r.clock_in.day for r in rows] == [3, 8]  # clock_in ascending
    assert all(r.user_id == USER_ID for r in rows)


def test_sessions_in_cycle_window_and_status(db_session):
    db_session.add_all(
        [
            _entry(user_id=USER_ID, clock_out=datetime(2026, 5, 7, 11, 0)),  # in window
            _entry(user_id=USER_ID, clock_out=datetime(2026, 4, 30, 11, 0)),  # before
            _entry(user_id=USER_ID, clock_out=datetime(2026, 5, 16, 11, 0)),  # after
            _entry(
                user_id=USER_ID, status="voided", clock_out=datetime(2026, 5, 7, 11, 0)
            ),  # voided
            _entry(user_id=USER_ID, status="active", clock_out=None),  # active
        ]
    )
    db_session.flush()

    rows = _sessions(USER_ID)

    assert len(rows) == 1
    assert rows[0].clock_out == datetime(2026, 5, 7, 11, 0)


# ── weekly buckets (Sun–Sat calendar weeks, CSV export) ─────────────────────


def test_weekly_buckets_by_clock_out_week(db_session):
    """Sessions land in the Sun–Sat week their clock_out falls in, indexed
    from the week containing cycle_start (week 1 = Apr 26–May 2)."""
    db_session.add_all(
        [
            _entry(clock_out=datetime(2026, 5, 1, 11, 0), duration_seconds=7200),  # wk1
            _entry(clock_out=datetime(2026, 5, 4, 11, 0), duration_seconds=3600),  # wk2
            _entry(clock_out=datetime(2026, 5, 11, 11, 0), duration_seconds=1800),  # wk3
            _entry(clock_out=datetime(2026, 5, 18, 11, 0), duration_seconds=3600),  # wk4
        ]
    )
    db_session.flush()

    assert _weekly([USER_ID])[USER_ID] == [7200, 3600, 1800, 3600]


def test_weekly_buckets_overflow_folds_into_last_week(db_session):
    """A 5th-calendar-week session (May 25) folds into week 4 rather than
    spilling past the fixed four buckets."""
    db_session.add_all(
        [
            _entry(clock_out=datetime(2026, 5, 18, 11, 0), duration_seconds=3600),  # wk4
            _entry(clock_out=datetime(2026, 5, 25, 11, 0), duration_seconds=3600),  # ↳wk4
            _entry(clock_out=datetime(2026, 5, 31, 11, 0), duration_seconds=1800),  # ↳wk4
        ]
    )
    db_session.flush()

    buckets = _weekly([USER_ID])[USER_ID]
    assert buckets == [0, 0, 0, 9000]
    # Weekly total matches the single-number cycle total (no double counting).
    assert sum(buckets) == _hours([USER_ID], MONTH_START, MONTH_END)[USER_ID]


def test_weekly_respects_clock_out_window_and_status(db_session):
    """Out-of-window and non-completed sessions are excluded, same as the
    single-total query."""
    db_session.add_all(
        [
            _entry(clock_out=datetime(2026, 5, 4, 11, 0), duration_seconds=3600),  # in
            _entry(clock_out=datetime(2026, 4, 30, 11, 0), duration_seconds=9999),  # pre
            _entry(clock_out=datetime(2026, 6, 1, 11, 0), duration_seconds=9999),  # post
            _entry(
                status="voided",
                clock_out=datetime(2026, 5, 4, 11, 0),
                duration_seconds=9999,
            ),  # voided
        ]
    )
    db_session.flush()

    assert _weekly([USER_ID])[USER_ID] == [0, 3600, 0, 0]


def test_weekly_empty_user_ids_short_circuits(db_session):
    assert _weekly([]) == {}
