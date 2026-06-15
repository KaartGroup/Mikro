"""
Regression tests for ``TimeEntryService.clock_out``.

These pin the two contracts the time-tracking refactor broke and we restored:

1. ``session_id`` is OPTIONAL. A self clock-out sends an empty body
   (``clockOut({})`` in the frontend); the service must resolve the caller's
   single active session. Admin force-clock-out still pins a specific id.

2. The closing OSM changeset tally is BEST-EFFORT. It uses the injected
   ``ChangesetFetcher.fetch`` (which returns a *list* of changeset dicts),
   derives ``changeset_count``/``changes_count`` from that list, and falls back
   to ``(0, 0)`` on any fetch failure so an OSM hiccup can never block a
   clock-out.

The fetcher is injected (no network) per the service's own design note.
"""

from datetime import datetime, timedelta

from api.database import TimeEntry, User
from api.time_tracking.service import TimeEntryService
from tests.conftest import USER_ID, OTHER_USER_ID, ORG


class _FakeFetcher:
    """Stand-in for ChangesetFetcher. Records calls; returns a canned list or
    raises, to exercise the tally and the best-effort fallback."""

    def __init__(self, changesets=None, exc=None):
        self._changesets = [] if changesets is None else changesets
        self._exc = exc
        self.calls = []

    def fetch(self, osm_usernames, since, until=None, max_results=None):
        self.calls.append((list(osm_usernames), since, until))
        if self._exc is not None:
            raise self._exc
        return self._changesets


def _active_entry(db_session, user_id=USER_ID, **kwargs):
    defaults = dict(
        user_id=user_id,
        org_id=ORG,
        activity="editing",
        status="active",
        clock_in=datetime.utcnow() - timedelta(minutes=30),
        clock_out=None,
        duration_seconds=None,
    )
    defaults.update(kwargs)
    entry = TimeEntry(**defaults)
    db_session.add(entry)
    db_session.flush()
    return entry


# ── session_id is optional (the self clock-out path) ─────────────────────────


def test_clock_out_without_session_id_closes_active_session(db_session):
    entry = _active_entry(db_session)

    result = TimeEntryService(changeset_fetcher=_FakeFetcher()).clock_out(None, USER_ID)

    assert result is not None
    assert result.id == entry.id
    assert result.status == "completed"
    assert result.clock_out is not None
    assert result.duration_seconds is not None and result.duration_seconds >= 0


def test_clock_out_with_explicit_session_id(db_session):
    entry = _active_entry(db_session)

    result = TimeEntryService(changeset_fetcher=_FakeFetcher()).clock_out(
        entry.id, USER_ID
    )

    assert result is not None
    assert result.id == entry.id
    assert result.status == "completed"


def test_clock_out_unknown_session_id_returns_none_and_leaves_session(db_session):
    entry = _active_entry(db_session)

    result = TimeEntryService(changeset_fetcher=_FakeFetcher()).clock_out(
        999_999, USER_ID
    )

    assert result is None
    assert entry.status == "active"  # untouched


def test_clock_out_is_scoped_to_the_caller(db_session):
    """USER_ID's active session must not be closed by OTHER_USER_ID."""
    entry = _active_entry(db_session, user_id=USER_ID)

    result = TimeEntryService(changeset_fetcher=_FakeFetcher()).clock_out(
        None, OTHER_USER_ID
    )

    assert result is None
    assert entry.status == "active"


# ── best-effort changeset tally ──────────────────────────────────────────────


def test_clock_out_tallies_changesets_from_fetcher(db_session):
    User.query.get(USER_ID).osm_username = "mapperjoe"
    _active_entry(db_session)

    # len → changeset_count; sum of changes_count → changes_count (missing → 0)
    fetcher = _FakeFetcher(changesets=[{"changes_count": 3}, {"changes_count": 5}, {}])
    result = TimeEntryService(changeset_fetcher=fetcher).clock_out(None, USER_ID)

    assert result.changeset_count == 3
    assert result.changes_count == 8
    assert len(fetcher.calls) == 1
    usernames, since, _until = fetcher.calls[0]
    assert usernames == ["mapperjoe"]
    assert since == result.clock_in  # window opens at clock-in


def test_clock_out_changeset_failure_is_best_effort(db_session):
    User.query.get(USER_ID).osm_username = "mapperjoe"
    _active_entry(db_session)

    fetcher = _FakeFetcher(exc=RuntimeError("OSM down"))
    result = TimeEntryService(changeset_fetcher=fetcher).clock_out(None, USER_ID)

    # Clock-out still succeeds; counts fall back to zero rather than 500-ing.
    assert result is not None
    assert result.status == "completed"
    assert result.changeset_count == 0
    assert result.changes_count == 0


def test_clock_out_skips_fetch_without_osm_username(db_session):
    # Fixture USER_ID has osm_username=None → fetch must never be attempted.
    _active_entry(db_session)

    fetcher = _FakeFetcher(exc=AssertionError("fetch must not be called"))
    result = TimeEntryService(changeset_fetcher=fetcher).clock_out(None, USER_ID)

    assert result is not None
    assert result.status == "completed"
    assert fetcher.calls == []
