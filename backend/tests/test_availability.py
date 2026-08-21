"""
Tests for the scheduling & availability feature (Phase 1).

Three layers:
  - Pure time math (no DB): validation, normalization, local->UTC conversion,
    interval algebra, sweep-line intersection.
  - Service (DB-backed): whole-grid replacement, exceptions.
  - Handlers: request parsing, permission gates, org scoping.

The DST cases are the load-bearing ones — they are the reason availability is
stored as local wall-clock rather than as UTC instants.
"""

from datetime import date, datetime, timezone
from types import SimpleNamespace

import pytest
from flask import g

from api.services.availability import (
    EXCEPTION_AVAILABLE,
    EXCEPTION_UNAVAILABLE,
    KIND_AVAILABLE,
    KIND_PREFERRED,
    MAX_BLOCKS_PER_GRID,
    MAX_USERS_PER_OVERLAP,
    AvailabilityService,
    intersect_intervals,
    local_minute_to_utc,
    merge_ranges,
    normalize_blocks,
    resolve_intervals,
    resolve_timezone,
    subtract_range,
    validate_block,
    validate_exception,
)
from api.views.Availability import AvailabilityAPI
from api.database import User, Team, TeamUser

from tests.conftest import USER_ID, OTHER_USER_ID, ORG

# ── Helpers ─────────────────────────────────────────────────────────────


def _block(dow, start, end, kind=KIND_AVAILABLE):
    """A stand-in for a UserAvailability row (pure-math tests)."""
    return SimpleNamespace(
        day_of_week=dow, start_minute=start, end_minute=end, kind=kind
    )


def _exception(day, kind, start=None, end=None):
    return SimpleNamespace(date=day, kind=kind, start_minute=start, end_minute=end)


def _utc(y, m, d, hh, mm=0):
    return datetime(y, m, d, hh, mm, tzinfo=timezone.utc)


@pytest.fixture
def availability_users(db_session):
    """Give the conftest-seeded users an org, role, and timezone."""
    u1 = db_session.get(User, USER_ID)
    u2 = db_session.get(User, OTHER_USER_ID)
    for user in (u1, u2):
        user.org_id = ORG
        user.role = "user"
        user.is_active = True
    u1.timezone = "America/Denver"
    u2.timezone = "America/Bogota"
    db_session.flush()
    return u1, u2


# ── Validation ──────────────────────────────────────────────────────────


def test_validate_block_accepts_a_normal_workday():
    assert (
        validate_block({"day_of_week": 0, "start_minute": 540, "end_minute": 1020})
        is None
    )


@pytest.mark.parametrize(
    "block",
    [
        {"day_of_week": 7, "start_minute": 540, "end_minute": 1020},
        {"day_of_week": -1, "start_minute": 540, "end_minute": 1020},
        {"day_of_week": 0, "start_minute": 1020, "end_minute": 540},
        {"day_of_week": 0, "start_minute": 540, "end_minute": 540},
        {"day_of_week": 0, "start_minute": -1, "end_minute": 540},
        {"day_of_week": 0, "start_minute": 540, "end_minute": 1441},
        {"day_of_week": 0, "start_minute": 540},
        {"day_of_week": 0, "start_minute": 540, "end_minute": 1020, "kind": "nope"},
    ],
)
def test_validate_block_rejects_bad_input(block):
    assert validate_block(block) is not None


def test_validate_block_rejects_crossing_midnight_with_a_helpful_message():
    """A night shift must be two rows; the message has to say so."""
    error = validate_block({"day_of_week": 0, "start_minute": 1320, "end_minute": 360})
    assert error is not None
    assert "midnight" in error


def test_validate_exception_allows_whole_day_but_not_half_a_range():
    assert validate_exception(EXCEPTION_UNAVAILABLE, None, None) is None
    assert validate_exception(EXCEPTION_UNAVAILABLE, 540, None) is not None
    assert validate_exception(EXCEPTION_UNAVAILABLE, None, 540) is not None
    assert validate_exception("bogus", None, None) is not None


def test_resolve_timezone_falls_back_to_utc():
    """User.timezone is nullable — every read path must tolerate it."""
    assert str(resolve_timezone(None)) == "UTC"
    assert str(resolve_timezone("Not/AZone")) == "UTC"
    assert str(resolve_timezone("America/Bogota")) == "America/Bogota"


# ── Interval algebra ────────────────────────────────────────────────────


def test_merge_ranges_collapses_overlapping_and_adjacent():
    assert merge_ranges([(0, 10), (5, 20)]) == [(0, 20)]
    assert merge_ranges([(0, 10), (10, 20)]) == [(0, 20)]
    assert merge_ranges([(30, 40), (0, 10)]) == [(0, 10), (30, 40)]


def test_subtract_range_splits_a_block_in_two():
    assert subtract_range([(0, 100)], 40, 60) == [(0, 40), (60, 100)]
    assert subtract_range([(0, 100)], 0, 100) == []
    assert subtract_range([(0, 100)], 200, 300) == [(0, 100)]


def test_normalize_blocks_merges_within_a_kind_but_not_across_kinds():
    out = normalize_blocks(
        [
            {"day_of_week": 0, "start_minute": 540, "end_minute": 720},
            {"day_of_week": 0, "start_minute": 700, "end_minute": 1020},
            {
                "day_of_week": 0,
                "start_minute": 540,
                "end_minute": 600,
                "kind": KIND_PREFERRED,
            },
        ]
    )
    available = [b for b in out if b["kind"] == KIND_AVAILABLE]
    preferred = [b for b in out if b["kind"] == KIND_PREFERRED]
    assert available == [
        {
            "day_of_week": 0,
            "start_minute": 540,
            "end_minute": 1020,
            "kind": KIND_AVAILABLE,
        }
    ]
    assert len(preferred) == 1


# ── Local wall-clock -> UTC (the DST-critical part) ─────────────────────


def test_local_minute_to_utc_tracks_dst():
    """09:00 in Denver is a DIFFERENT UTC instant in January vs July.

    This is precisely why availability is stored as wall-clock: a fixed UTC
    instant would silently move a user's declared hours twice a year.
    """
    denver = resolve_timezone("America/Denver")
    january = local_minute_to_utc(date(2026, 1, 15), 9 * 60, denver)
    july = local_minute_to_utc(date(2026, 7, 15), 9 * 60, denver)
    assert january.hour == 16  # MST = UTC-7
    assert july.hour == 15  # MDT = UTC-6


def test_local_minute_to_utc_handles_end_of_day():
    """Minute 1440 is midnight at the END of the given day."""
    utc = resolve_timezone("UTC")
    assert local_minute_to_utc(date(2026, 3, 1), 1440, utc) == _utc(2026, 3, 2, 0)


def test_local_minute_to_utc_in_a_zone_without_dst():
    bogota = resolve_timezone("America/Bogota")
    january = local_minute_to_utc(date(2026, 1, 15), 9 * 60, bogota)
    july = local_minute_to_utc(date(2026, 7, 15), 9 * 60, bogota)
    assert january.hour == july.hour == 14  # COT = UTC-5 year round


# ── resolve_intervals ───────────────────────────────────────────────────


def test_resolve_intervals_expands_a_weekly_block_across_a_range():
    # 2026-08-17 is a Monday.
    blocks = [_block(0, 9 * 60, 17 * 60)]
    intervals = resolve_intervals(
        blocks, [], "UTC", date(2026, 8, 17), date(2026, 8, 30)
    )
    assert len(intervals) == 2  # two Mondays in the range
    assert intervals[0] == (_utc(2026, 8, 17, 9), _utc(2026, 8, 17, 17))
    assert intervals[1] == (_utc(2026, 8, 24, 9), _utc(2026, 8, 24, 17))


def test_whole_day_unavailable_exception_clears_the_date():
    blocks = [_block(0, 9 * 60, 17 * 60)]
    exceptions = [_exception(date(2026, 8, 17), EXCEPTION_UNAVAILABLE)]
    intervals = resolve_intervals(
        blocks, exceptions, "UTC", date(2026, 8, 17), date(2026, 8, 23)
    )
    assert intervals == []


def test_partial_unavailable_exception_splits_the_day():
    blocks = [_block(0, 9 * 60, 17 * 60)]
    exceptions = [
        _exception(date(2026, 8, 17), EXCEPTION_UNAVAILABLE, 12 * 60, 13 * 60)
    ]
    intervals = resolve_intervals(
        blocks, exceptions, "UTC", date(2026, 8, 17), date(2026, 8, 17)
    )
    assert intervals == [
        (_utc(2026, 8, 17, 9), _utc(2026, 8, 17, 12)),
        (_utc(2026, 8, 17, 13), _utc(2026, 8, 17, 17)),
    ]


def test_available_exception_adds_a_day_with_no_weekly_block():
    """Working an unusual Saturday."""
    blocks = [_block(0, 9 * 60, 17 * 60)]  # Mondays only
    exceptions = [
        _exception(date(2026, 8, 22), EXCEPTION_AVAILABLE, 10 * 60, 12 * 60)
    ]  # a Saturday
    intervals = resolve_intervals(
        blocks, exceptions, "UTC", date(2026, 8, 22), date(2026, 8, 22)
    )
    assert intervals == [(_utc(2026, 8, 22, 10), _utc(2026, 8, 22, 12))]


def test_resolve_intervals_can_filter_to_preferred_only():
    blocks = [
        _block(0, 9 * 60, 17 * 60, KIND_AVAILABLE),
        _block(0, 10 * 60, 12 * 60, KIND_PREFERRED),
    ]
    intervals = resolve_intervals(
        blocks, [], "UTC", date(2026, 8, 17), date(2026, 8, 17), kinds={KIND_PREFERRED}
    )
    assert intervals == [(_utc(2026, 8, 17, 10), _utc(2026, 8, 17, 12))]


# ── intersect_intervals ─────────────────────────────────────────────────


def test_intersect_finds_the_common_window():
    per_user = {
        "a": [(_utc(2026, 8, 17, 9), _utc(2026, 8, 17, 17))],
        "b": [(_utc(2026, 8, 17, 15), _utc(2026, 8, 17, 23))],
    }
    windows = intersect_intervals(per_user)
    assert len(windows) == 1
    assert windows[0]["start"] == _utc(2026, 8, 17, 15)
    assert windows[0]["end"] == _utc(2026, 8, 17, 17)
    assert windows[0]["count"] == 2
    assert windows[0]["user_ids"] == ["a", "b"]


def test_intersect_returns_nothing_when_nobody_overlaps():
    per_user = {
        "a": [(_utc(2026, 8, 17, 9), _utc(2026, 8, 17, 12))],
        "b": [(_utc(2026, 8, 17, 13), _utc(2026, 8, 17, 17))],
    }
    assert intersect_intervals(per_user) == []


def test_touching_windows_do_not_count_as_overlap():
    """A window ending exactly where another starts is not an overlap."""
    per_user = {
        "a": [(_utc(2026, 8, 17, 9), _utc(2026, 8, 17, 12))],
        "b": [(_utc(2026, 8, 17, 12), _utc(2026, 8, 17, 17))],
    }
    assert intersect_intervals(per_user) == []


def test_intersect_honours_a_threshold_below_full_attendance():
    per_user = {
        "a": [(_utc(2026, 8, 17, 9), _utc(2026, 8, 17, 17))],
        "b": [(_utc(2026, 8, 17, 15), _utc(2026, 8, 17, 23))],
        "c": [(_utc(2026, 8, 18, 9), _utc(2026, 8, 18, 17))],
    }
    assert intersect_intervals(per_user) == []  # all three never coincide
    windows = intersect_intervals(per_user, threshold=2)
    assert len(windows) == 1
    assert windows[0]["user_ids"] == ["a", "b"]


def test_adjacent_segments_merge_only_when_membership_is_identical():
    """b's two back-to-back blocks yield ONE window, not two."""
    per_user = {
        "a": [(_utc(2026, 8, 17, 9), _utc(2026, 8, 17, 17))],
        "b": [
            (_utc(2026, 8, 17, 10), _utc(2026, 8, 17, 12)),
            (_utc(2026, 8, 17, 12), _utc(2026, 8, 17, 14)),
        ],
    }
    windows = intersect_intervals(per_user)
    assert len(windows) == 1
    assert windows[0]["start"] == _utc(2026, 8, 17, 10)
    assert windows[0]["end"] == _utc(2026, 8, 17, 14)


def test_intersect_of_nothing_is_empty():
    assert intersect_intervals({}) == []
    assert intersect_intervals({"a": []}) == []


def test_cross_timezone_overlap_end_to_end():
    """Denver 09:00-17:00 vs Bogota 09:00-17:00 on the same Monday.

    In August Denver is MDT (UTC-6) -> 15:00-23:00 UTC; Bogota is COT
    (UTC-5, no DST) -> 14:00-22:00 UTC. The *intersection* is therefore
    15:00-22:00 UTC — i.e. the pair genuinely share seven hours, and the
    grid must not imply either end of the union.
    """
    monday = date(2026, 8, 17)
    blocks = [_block(0, 9 * 60, 17 * 60)]
    denver = resolve_intervals(blocks, [], "America/Denver", monday, monday)
    bogota = resolve_intervals(blocks, [], "America/Bogota", monday, monday)
    assert denver == [(_utc(2026, 8, 17, 15), _utc(2026, 8, 17, 23))]
    assert bogota == [(_utc(2026, 8, 17, 14), _utc(2026, 8, 17, 22))]

    windows = intersect_intervals({"denver": denver, "bogota": bogota})
    assert len(windows) == 1
    assert windows[0]["start"] == _utc(2026, 8, 17, 15)
    assert windows[0]["end"] == _utc(2026, 8, 17, 22)


# ── Service (DB-backed) ─────────────────────────────────────────────────


def test_set_weekly_replaces_the_whole_grid(db_session, availability_users):
    svc = AvailabilityService(ORG)
    svc.set_weekly(
        USER_ID, [{"day_of_week": 0, "start_minute": 540, "end_minute": 1020}]
    )
    saved = svc.set_weekly(
        USER_ID, [{"day_of_week": 2, "start_minute": 600, "end_minute": 720}]
    )
    assert len(saved) == 1
    assert saved[0].day_of_week == 2
    assert saved[0].org_id == ORG


def test_set_weekly_is_idempotent(db_session, availability_users):
    svc = AvailabilityService(ORG)
    blocks = [{"day_of_week": 1, "start_minute": 540, "end_minute": 1020}]
    first = svc.set_weekly(USER_ID, blocks)
    second = svc.set_weekly(USER_ID, blocks)
    assert len(first) == len(second) == 1


def test_set_weekly_normalizes_overlaps_on_write(db_session, availability_users):
    svc = AvailabilityService(ORG)
    saved = svc.set_weekly(
        USER_ID,
        [
            {"day_of_week": 0, "start_minute": 540, "end_minute": 720},
            {"day_of_week": 0, "start_minute": 700, "end_minute": 1020},
        ],
    )
    assert len(saved) == 1
    assert (saved[0].start_minute, saved[0].end_minute) == (540, 1020)


def test_set_weekly_clears_the_grid_when_given_an_empty_list(
    db_session, availability_users
):
    svc = AvailabilityService(ORG)
    svc.set_weekly(
        USER_ID, [{"day_of_week": 0, "start_minute": 540, "end_minute": 1020}]
    )
    assert svc.set_weekly(USER_ID, []) == []


def test_exceptions_round_trip(db_session, availability_users):
    svc = AvailabilityService(ORG)
    exc = svc.add_exception(
        USER_ID, date(2026, 8, 20), EXCEPTION_UNAVAILABLE, note="PTO"
    )
    assert exc.id is not None
    found = svc.get_exceptions(USER_ID, date(2026, 8, 1), date(2026, 8, 31))
    assert [e.id for e in found] == [exc.id]
    assert svc.delete_exception(USER_ID, exc.id) is True
    assert svc.get_exceptions(USER_ID) == []


def test_delete_exception_refuses_another_users_row(db_session, availability_users):
    svc = AvailabilityService(ORG)
    exc = svc.add_exception(USER_ID, date(2026, 8, 20), EXCEPTION_UNAVAILABLE)
    assert svc.delete_exception(OTHER_USER_ID, exc.id) is False
    assert svc.delete_exception(USER_ID, 999999) is False


def test_get_exceptions_respects_the_date_window(db_session, availability_users):
    svc = AvailabilityService(ORG)
    svc.add_exception(USER_ID, date(2026, 8, 20), EXCEPTION_UNAVAILABLE)
    svc.add_exception(USER_ID, date(2026, 12, 25), EXCEPTION_UNAVAILABLE)
    august = svc.get_exceptions(USER_ID, date(2026, 8, 1), date(2026, 8, 31))
    assert len(august) == 1


def test_resolve_for_users_uses_each_users_own_timezone(db_session, availability_users):
    u1, u2 = availability_users  # Denver, Bogota
    svc = AvailabilityService(ORG)
    blocks = [{"day_of_week": 0, "start_minute": 9 * 60, "end_minute": 17 * 60}]
    svc.set_weekly(u1.id, blocks)
    svc.set_weekly(u2.id, blocks)

    monday = date(2026, 8, 17)
    resolved = svc.resolve_for_users([u1, u2], monday, monday)
    assert resolved[u1.id][0][0] == _utc(2026, 8, 17, 15)  # Denver 09:00 MDT
    assert resolved[u2.id][0][0] == _utc(2026, 8, 17, 14)  # Bogota 09:00 COT


# ── Handlers ────────────────────────────────────────────────────────────


def test_my_suggests_a_default_grid_before_anything_is_saved(
    app, db_session, availability_users
):
    with app.test_request_context(json={}):
        g.user = db_session.get(User, USER_ID)
        resp = AvailabilityAPI().my()
    assert resp["status"] == 200
    assert resp["availability"]["is_default"] is True
    assert len(resp["availability"]["suggested_blocks"]) == 5  # Mon-Fri
    assert resp["availability"]["blocks"] == []


def test_my_reports_saved_blocks_and_drops_the_default_flag(
    app, db_session, availability_users
):
    AvailabilityService(ORG).set_weekly(
        USER_ID, [{"day_of_week": 0, "start_minute": 540, "end_minute": 1020}]
    )
    with app.test_request_context(json={}):
        g.user = db_session.get(User, USER_ID)
        resp = AvailabilityAPI().my()
    assert resp["availability"]["is_default"] is False
    assert len(resp["availability"]["blocks"]) == 1


def test_set_my_rejects_an_invalid_block(app, db_session, availability_users):
    body = {"blocks": [{"day_of_week": 9, "start_minute": 540, "end_minute": 1020}]}
    with app.test_request_context(json=body):
        g.user = db_session.get(User, USER_ID)
        resp = AvailabilityAPI().set_my()
    assert resp["status"] == 400
    assert "day_of_week" in resp["message"]


def test_set_my_rejects_a_non_list_payload(app, db_session, availability_users):
    with app.test_request_context(json={"blocks": "nope"}):
        g.user = db_session.get(User, USER_ID)
        resp = AvailabilityAPI().set_my()
    assert resp["status"] == 400


def test_set_my_saves_a_valid_grid(app, db_session, availability_users):
    body = {"blocks": [{"day_of_week": 0, "start_minute": 540, "end_minute": 1020}]}
    with app.test_request_context(json=body):
        g.user = db_session.get(User, USER_ID)
        resp = AvailabilityAPI().set_my()
    assert resp["status"] == 200
    assert resp["count"] == 1


def test_for_user_denies_cross_org(app, db_session, availability_users):
    other = db_session.get(User, OTHER_USER_ID)
    other.org_id = "some-other-org"
    db_session.flush()
    with app.test_request_context(json={"user_id": OTHER_USER_ID}):
        g.user = db_session.get(User, USER_ID)
        resp = AvailabilityAPI().for_user()
    assert resp["status"] == 403


def test_for_user_404s_on_an_unknown_user(app, db_session, availability_users):
    with app.test_request_context(json={"user_id": "auth0|nope"}):
        g.user = db_session.get(User, USER_ID)
        resp = AvailabilityAPI().for_user()
    assert resp["status"] == 404


def test_set_for_user_requires_org_admin(app, db_session, availability_users):
    body = {"user_id": OTHER_USER_ID, "blocks": []}
    with app.test_request_context(json=body):
        g.user = db_session.get(User, USER_ID)  # role='user'
        resp = AvailabilityAPI().set_for_user()
    assert resp["status"] == 403


def test_set_for_user_allows_an_org_admin(app, db_session, availability_users):
    admin = db_session.get(User, USER_ID)
    admin.role = "admin"
    db_session.flush()
    body = {
        "user_id": OTHER_USER_ID,
        "blocks": [{"day_of_week": 3, "start_minute": 540, "end_minute": 1020}],
    }
    with app.test_request_context(json=body):
        g.user = admin
        resp = AvailabilityAPI().set_for_user()
    assert resp["status"] == 200
    assert resp["count"] == 1


def test_overlap_requires_a_non_empty_user_list(app, db_session, availability_users):
    with app.test_request_context(json={"user_ids": []}):
        g.user = db_session.get(User, USER_ID)
        resp = AvailabilityAPI().overlap()
    assert resp["status"] == 400


def test_overlap_computes_a_cross_timezone_window(app, db_session, availability_users):
    u1, u2 = availability_users
    svc = AvailabilityService(ORG)
    blocks = [{"day_of_week": 0, "start_minute": 9 * 60, "end_minute": 17 * 60}]
    svc.set_weekly(u1.id, blocks)
    svc.set_weekly(u2.id, blocks)

    body = {
        "user_ids": [u1.id, u2.id],
        "start_date": "2026-08-17",
        "end_date": "2026-08-17",
    }
    with app.test_request_context(json=body):
        g.user = u1
        resp = AvailabilityAPI().overlap()
    assert resp["status"] == 200
    assert resp["count"] == 1
    # Denver (MDT, UTC-6) and Bogota (COT, UTC-5) share 15:00-22:00 UTC.
    assert resp["windows"][0]["start"].startswith("2026-08-17T15:00")
    assert resp["windows"][0]["end"].startswith("2026-08-17T22:00")
    assert resp["threshold"] == 2


def test_overlap_flags_users_with_no_timezone(app, db_session, availability_users):
    u1, u2 = availability_users
    u2.timezone = None
    db_session.flush()
    AvailabilityService(ORG).set_weekly(
        u1.id, [{"day_of_week": 0, "start_minute": 540, "end_minute": 1020}]
    )
    body = {
        "user_ids": [u1.id, u2.id],
        "start_date": "2026-08-17",
        "end_date": "2026-08-17",
    }
    with app.test_request_context(json=body):
        g.user = u1
        resp = AvailabilityAPI().overlap()
    assert resp["users_without_timezone"] == [u2.id]


def test_overlap_rejects_an_out_of_bounds_threshold(
    app, db_session, availability_users
):
    u1, u2 = availability_users
    body = {"user_ids": [u1.id, u2.id], "threshold": 5}
    with app.test_request_context(json=body):
        g.user = u1
        resp = AvailabilityAPI().overlap()
    assert resp["status"] == 400


def test_overlap_rejects_an_overlong_range(app, db_session, availability_users):
    u1, _ = availability_users
    body = {
        "user_ids": [u1.id],
        "start_date": "2026-01-01",
        "end_date": "2026-12-31",
    }
    with app.test_request_context(json=body):
        g.user = u1
        resp = AvailabilityAPI().overlap()
    assert resp["status"] == 400


def test_for_team_lists_members_with_their_timezones(
    app, db_session, availability_users
):
    u1, u2 = availability_users
    team = Team(name="Globe", org_id=ORG)
    db_session.add(team)
    db_session.flush()
    db_session.add(TeamUser(user_id=u1.id, team_id=team.id))
    db_session.add(TeamUser(user_id=u2.id, team_id=team.id))
    db_session.flush()

    with app.test_request_context(json={"team_id": team.id}):
        g.user = u1
        resp = AvailabilityAPI().for_team()
    assert resp["status"] == 200
    assert resp["count"] == 2
    zones = {m["user_id"]: m["timezone"] for m in resp["members"]}
    assert zones[u1.id] == "America/Denver"
    assert zones[u2.id] == "America/Bogota"


def test_for_team_denies_cross_org(app, db_session, availability_users):
    u1, _ = availability_users
    team = Team(name="Elsewhere", org_id="another-org")
    db_session.add(team)
    db_session.flush()
    with app.test_request_context(json={"team_id": team.id}):
        g.user = u1
        resp = AvailabilityAPI().for_team()
    assert resp["status"] == 403


@pytest.mark.parametrize(
    "method,body,field",
    [
        ("for_team", {"team_id": "abc"}, "team_id"),
        ("for_team", {"team_id": None}, "team_id"),
        ("delete_exception", {"exception_id": "abc"}, "exception_id"),
        ("delete_exception", {}, "exception_id"),
    ],
)
def test_non_numeric_ids_are_400_not_500(
    app, db_session, availability_users, method, body, field
):
    """A non-numeric id must not escape as a ValueError -> HTTP 500."""
    with app.test_request_context(json=body):
        g.user = db_session.get(User, USER_ID)
        resp = getattr(AvailabilityAPI(), method)()
    assert resp["status"] == 400
    assert field in resp["message"]


def test_unknown_path_returns_404(app, db_session, availability_users):
    with app.test_request_context(json={}):
        g.user = db_session.get(User, USER_ID)
        resp = AvailabilityAPI().post("bogus")
    assert isinstance(resp, tuple)
    assert resp[1] == 404


# ── Regressions from the Phase 1 review (2026-08-20) ────────────────────


def test_overlap_survives_the_range_edges_across_timezones(
    app, db_session, availability_users
):
    """A Denver Sunday-evening block and a Tokyo Monday-morning block are the
    SAME UTC hours. Resolving only the requested local dates dropped the
    Denver side entirely and reported no common window.
    """
    u1, u2 = availability_users
    u1.timezone = "America/Denver"
    u2.timezone = "Asia/Tokyo"
    db_session.flush()

    svc = AvailabilityService(ORG)
    # Sunday 18:00-22:00 Denver == Mon 00:00-04:00Z
    svc.set_weekly(
        u1.id, [{"day_of_week": 6, "start_minute": 18 * 60, "end_minute": 22 * 60}]
    )
    # Monday 09:00-13:00 Tokyo == Mon 00:00-04:00Z
    svc.set_weekly(
        u2.id, [{"day_of_week": 0, "start_minute": 9 * 60, "end_minute": 13 * 60}]
    )

    monday = date(2026, 8, 17)
    resolved = svc.resolve_for_users([u1, u2], monday, monday)
    assert resolved[u1.id] == [(_utc(2026, 8, 17, 0), _utc(2026, 8, 17, 4))]
    assert resolved[u2.id] == [(_utc(2026, 8, 17, 0), _utc(2026, 8, 17, 4))]

    windows = intersect_intervals(resolved)
    assert len(windows) == 1
    assert windows[0]["start"] == _utc(2026, 8, 17, 0)
    assert windows[0]["end"] == _utc(2026, 8, 17, 4)


def test_resolve_for_users_clips_to_the_requested_utc_window(
    db_session, availability_users
):
    """Padding must not leak availability from outside the requested range."""
    u1, _ = availability_users
    u1.timezone = "UTC"
    db_session.flush()
    svc = AvailabilityService(ORG)
    svc.set_weekly(
        u1.id,
        [{"day_of_week": d, "start_minute": 0, "end_minute": 1440} for d in range(7)],
    )
    monday = date(2026, 8, 17)
    resolved = svc.resolve_for_users([u1], monday, monday)
    assert resolved[u1.id] == [(_utc(2026, 8, 17, 0), _utc(2026, 8, 18, 0))]


def test_intersect_handles_one_user_with_overlapping_intervals():
    """`active` must count, not set-track: the first close event previously
    dropped a user whose longer interval was still open."""
    per_user = {
        "a": [
            (_utc(2026, 8, 17, 9), _utc(2026, 8, 17, 17)),
            (_utc(2026, 8, 17, 10), _utc(2026, 8, 17, 12)),
        ],
        "b": [(_utc(2026, 8, 17, 9), _utc(2026, 8, 17, 17))],
    }
    windows = intersect_intervals(per_user)
    assert len(windows) == 1
    assert windows[0]["start"] == _utc(2026, 8, 17, 9)
    assert windows[0]["end"] == _utc(2026, 8, 17, 17)


def test_adjacent_segments_do_not_merge_when_membership_differs():
    """The other half of the merge guard: same instant, different members."""
    per_user = {
        "a": [(_utc(2026, 8, 17, 9), _utc(2026, 8, 17, 17))],
        "b": [(_utc(2026, 8, 17, 9), _utc(2026, 8, 17, 12))],
        "c": [(_utc(2026, 8, 17, 12), _utc(2026, 8, 17, 15))],
    }
    windows = intersect_intervals(per_user, threshold=2)
    assert len(windows) == 2
    assert windows[0]["user_ids"] == ["a", "b"]
    assert windows[1]["user_ids"] == ["a", "c"]
    assert windows[0]["end"] == windows[1]["start"] == _utc(2026, 8, 17, 12)


def test_exceptions_apply_in_a_deterministic_order():
    """Same rows, either DB order, same answer — unavailable wins."""
    blocks = [_block(0, 9 * 60, 17 * 60)]
    excs = [
        _exception(date(2026, 8, 17), EXCEPTION_UNAVAILABLE),
        _exception(date(2026, 8, 17), EXCEPTION_AVAILABLE, 10 * 60, 12 * 60),
    ]
    forward = resolve_intervals(
        blocks, excs, "UTC", date(2026, 8, 17), date(2026, 8, 17)
    )
    backward = resolve_intervals(
        blocks, list(reversed(excs)), "UTC", date(2026, 8, 17), date(2026, 8, 17)
    )
    assert forward == backward == []


def test_preferred_only_ignores_available_exceptions():
    """A whole-day 'available' exception must not manufacture 24h of core hours."""
    blocks = [_block(0, 10 * 60, 12 * 60, KIND_PREFERRED)]
    excs = [_exception(date(2026, 8, 22), EXCEPTION_AVAILABLE)]
    intervals = resolve_intervals(
        blocks,
        excs,
        "UTC",
        date(2026, 8, 22),
        date(2026, 8, 22),
        kinds={KIND_PREFERRED},
    )
    assert intervals == []


def test_preferred_only_still_honours_unavailable_exceptions():
    """PTO removes core hours even when resolving preferred-only."""
    blocks = [_block(0, 10 * 60, 12 * 60, KIND_PREFERRED)]
    excs = [_exception(date(2026, 8, 17), EXCEPTION_UNAVAILABLE)]
    intervals = resolve_intervals(
        blocks,
        excs,
        "UTC",
        date(2026, 8, 17),
        date(2026, 8, 17),
        kinds={KIND_PREFERRED},
    )
    assert intervals == []


@pytest.mark.parametrize(
    "method",
    [
        "my",
        "set_my",
        "add_exception",
        "delete_exception",
        "for_user",
        "set_for_user",
        "for_team",
        "overlap",
    ],
)
def test_non_dict_json_body_is_not_a_500(app, db_session, availability_users, method):
    """A JSON body of `[1,2,3]` is truthy and has no ``.get`` — it used to
    escape as AttributeError -> HTTP 500.

    It must now degrade to an empty body: a 400 for handlers with required
    fields, or a normal 200 for ``my``, whose fields are all optional. The
    assertion is deliberately about *not raising*, not about a specific code.
    """
    with app.test_request_context(json=[1, 2, 3]):
        g.user = db_session.get(User, USER_ID)
        resp = getattr(AvailabilityAPI(), method)()
    assert isinstance(resp, dict)
    assert resp["status"] in (200, 400, 403)


@pytest.mark.parametrize(
    "body,expected_word",
    [
        ({"date": "2026-08-20", "kind": 123}, "kind"),
        ({"date": "2026-08-20", "kind": "unavailable", "note": 5}, "note"),
        ({"date": "2026-08-20", "kind": "unavailable", "note": {"a": 1}}, "note"),
    ],
)
def test_add_exception_rejects_non_string_fields(
    app, db_session, availability_users, body, expected_word
):
    with app.test_request_context(json=body):
        g.user = db_session.get(User, USER_ID)
        resp = AvailabilityAPI().add_exception()
    assert resp["status"] == 400
    assert expected_word in resp["message"]


def test_for_user_rejects_a_non_string_user_id(app, db_session, availability_users):
    """A non-string id reached psycopg2 and 500'd on an un-adaptable type."""
    with app.test_request_context(json={"user_id": 5}):
        g.user = db_session.get(User, USER_ID)
        resp = AvailabilityAPI().for_user()
    assert resp["status"] == 400


@pytest.mark.parametrize("bad", [[1, 2], [{"a": 1}], ["ok", 5]])
def test_overlap_rejects_non_string_user_ids(app, db_session, availability_users, bad):
    with app.test_request_context(json={"user_ids": bad}):
        g.user = db_session.get(User, USER_ID)
        resp = AvailabilityAPI().overlap()
    assert resp["status"] == 400


def test_malformed_dates_are_rejected_not_silently_defaulted(
    app, db_session, availability_users
):
    with app.test_request_context(json={"start_date": "2026-13-45"}):
        g.user = db_session.get(User, USER_ID)
        resp = AvailabilityAPI().my()
    assert resp["status"] == 400
    assert "start_date" in resp["message"]


def test_grid_size_is_capped(app, db_session, availability_users):
    blocks = [
        {"day_of_week": 0, "start_minute": 0, "end_minute": 1}
        for _ in range(MAX_BLOCKS_PER_GRID + 1)
    ]
    with app.test_request_context(json={"blocks": blocks}):
        g.user = db_session.get(User, USER_ID)
        resp = AvailabilityAPI().set_my()
    assert resp["status"] == 400


def test_exception_notes_are_hidden_from_other_users(
    app, db_session, availability_users
):
    """Working hours are org-visible; the free-text reason is not."""
    u1, u2 = availability_users
    AvailabilityService(ORG).add_exception(
        u2.id, date(2026, 8, 20), EXCEPTION_UNAVAILABLE, note="surgery"
    )
    body = {"user_id": u2.id, "start_date": "2026-08-01", "end_date": "2026-08-31"}

    with app.test_request_context(json=body):
        g.user = u1  # a peer, role='user'
        peer_view = AvailabilityAPI().for_user()
    assert peer_view["availability"]["exceptions"][0]["note"] is None

    u1.role = "admin"
    db_session.flush()
    with app.test_request_context(json=body):
        g.user = u1
        admin_view = AvailabilityAPI().for_user()
    assert admin_view["availability"]["exceptions"][0]["note"] == "surgery"


def test_owner_still_sees_their_own_notes(app, db_session, availability_users):
    u1, _ = availability_users
    AvailabilityService(ORG).add_exception(
        u1.id, date(2026, 8, 20), EXCEPTION_UNAVAILABLE, note="surgery"
    )
    # Pin the window explicitly. Relying on `my()`'s default [today, today+13]
    # makes the test depend on the wall clock: once UTC passes the fixture
    # date, the exception falls outside the default range and the assertion
    # blows up on an empty list.
    body = {"start_date": "2026-08-01", "end_date": "2026-08-31"}
    with app.test_request_context(json=body):
        g.user = u1
        resp = AvailabilityAPI().my()
    assert resp["availability"]["exceptions"][0]["note"] == "surgery"


def test_for_team_excludes_members_who_moved_org(app, db_session, availability_users):
    """A stale TeamUser row must not leak availability to the old org."""
    u1, u2 = availability_users
    team = Team(name="Globe", org_id=ORG)
    db_session.add(team)
    db_session.flush()
    db_session.add(TeamUser(user_id=u1.id, team_id=team.id))
    db_session.add(TeamUser(user_id=u2.id, team_id=team.id))
    u2.org_id = "moved-away-org"
    db_session.flush()

    with app.test_request_context(json={"team_id": team.id}):
        g.user = u1
        resp = AvailabilityAPI().for_team()
    assert resp["count"] == 1
    assert resp["members"][0]["user_id"] == u1.id


def test_set_for_user_denies_cross_org(app, db_session, availability_users):
    """The write path needs its own org gate, not just the read path."""
    u1, u2 = availability_users
    u1.role = "admin"
    u2.org_id = "another-org"
    db_session.flush()
    body = {
        "user_id": u2.id,
        "blocks": [{"day_of_week": 0, "start_minute": 540, "end_minute": 1020}],
    }
    with app.test_request_context(json=body):
        g.user = u1
        resp = AvailabilityAPI().set_for_user()
    assert resp["status"] == 403


def test_overlap_checks_cross_org_before_reporting_unknown_ids(
    app, db_session, availability_users
):
    """Otherwise the 404 confirms whether an arbitrary sub exists elsewhere."""
    u1, u2 = availability_users
    u2.org_id = "another-org"
    db_session.flush()
    with app.test_request_context(json={"user_ids": [u1.id, u2.id]}):
        g.user = u1
        resp = AvailabilityAPI().overlap()
    assert resp["status"] == 403


def test_overlap_caps_the_number_of_users(app, db_session, availability_users):
    u1, _ = availability_users
    with app.test_request_context(
        json={"user_ids": [f"auth0|{i}" for i in range(MAX_USERS_PER_OVERLAP + 1)]}
    ):
        g.user = u1
        resp = AvailabilityAPI().overlap()
    assert resp["status"] == 400


def test_overlap_preferred_only_flows_through_the_view(
    app, db_session, availability_users
):
    """preferred_only must actually reach `kinds` in the service."""
    u1, u2 = availability_users
    for user in (u1, u2):
        user.timezone = "UTC"
    db_session.flush()
    svc = AvailabilityService(ORG)
    for user in (u1, u2):
        svc.set_weekly(
            user.id,
            [
                {"day_of_week": 0, "start_minute": 9 * 60, "end_minute": 17 * 60},
                {
                    "day_of_week": 0,
                    "start_minute": 10 * 60,
                    "end_minute": 12 * 60,
                    "kind": KIND_PREFERRED,
                },
            ],
        )
    body = {
        "user_ids": [u1.id, u2.id],
        "start_date": "2026-08-17",
        "end_date": "2026-08-17",
        "preferred_only": True,
    }
    with app.test_request_context(json=body):
        g.user = u1
        resp = AvailabilityAPI().overlap()
    assert resp["status"] == 200
    assert resp["count"] == 1
    assert resp["windows"][0]["start"].startswith("2026-08-17T10:00")
    assert resp["windows"][0]["end"].startswith("2026-08-17T12:00")


# ── add_exception request parsing (regression) ──────────────────────────


def test_add_exception_persists_a_real_date(app, db_session, availability_users):
    """`_parse_date` returns a (value, error) tuple.

    The view used to bind the whole tuple to `day` and pass it through as the
    exception date, so every real add_exception call reached psycopg2 with an
    un-adaptable tuple and 500'd. Assert the stored date is a true date.
    """
    u1, _ = availability_users
    body = {"date": "2026-08-20", "kind": EXCEPTION_UNAVAILABLE, "note": "PTO"}
    with app.test_request_context(json=body):
        g.user = u1
        resp = AvailabilityAPI().add_exception()

    assert resp["status"] == 200
    assert resp["exception"]["date"] == "2026-08-20"
    assert resp["exception"]["note"] == "PTO"

    stored = AvailabilityService(ORG).get_exceptions(
        u1.id, date(2026, 8, 20), date(2026, 8, 20)
    )
    assert len(stored) == 1
    assert stored[0].date == date(2026, 8, 20)


def test_add_exception_requires_a_date(app, db_session, availability_users):
    u1, _ = availability_users
    with app.test_request_context(json={"kind": EXCEPTION_UNAVAILABLE}):
        g.user = u1
        resp = AvailabilityAPI().add_exception()
    assert resp["status"] == 400
    assert "date" in resp["message"]


@pytest.mark.parametrize("bad_date", ["not-a-date", "2026-13-45", 20260820])
def test_add_exception_rejects_a_malformed_date(
    app, db_session, availability_users, bad_date
):
    """A bad date is a 400 naming the field — never a 500, and never a
    silent substitution of today."""
    u1, _ = availability_users
    body = {"date": bad_date, "kind": EXCEPTION_UNAVAILABLE}
    with app.test_request_context(json=body):
        g.user = u1
        resp = AvailabilityAPI().add_exception()
    assert resp["status"] == 400
    assert "date" in resp["message"]


def test_add_exception_round_trips_through_delete(app, db_session, availability_users):
    """The UI's add -> list -> delete loop, end to end through the view."""
    u1, _ = availability_users
    with app.test_request_context(
        json={"date": "2026-09-01", "kind": EXCEPTION_UNAVAILABLE}
    ):
        g.user = u1
        added = AvailabilityAPI().add_exception()
    assert added["status"] == 200

    with app.test_request_context(json={"exception_id": added["exception"]["id"]}):
        g.user = u1
        deleted = AvailabilityAPI().delete_exception()
    assert deleted["status"] == 200

    assert (
        AvailabilityService(ORG).get_exceptions(
            u1.id, date(2026, 9, 1), date(2026, 9, 1)
        )
        == []
    )
