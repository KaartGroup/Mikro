"""
Tests for the watchlist lazy-discussions refactor.

Covers:
  1. fetch_discussions_live — comments_count filter, own-comment skip, flagged merge
  2. refresh_entry_stats — refreshes stats but does NOT write cached_discussions
  3. fetch_friend_discussions endpoint — returns live discussions
  4. run_watchlist_refresh_job — iterates entries and completes
"""

import json
import types

from flask import g

import api.utils.watchlist_osm as watchlist_osm
from api.utils.watchlist_osm import (
    refresh_entry_stats,
    fetch_discussions_live,
)
from api.database import Friend, FriendChangeset
from api.views.Friends import FriendAPI
from api.worker.jobs import watchlist_refresh

ORG = "org_watchlist_test"


# ---------------------------------------------------------------------------
# Canned OSM XML
# ---------------------------------------------------------------------------

# Changeset list: cs 100 has 2 comments, cs 200 has 0, cs 300 has 3.
_CHANGESETS_XML = b"""<?xml version="1.0"?>
<osm>
  <changeset id="100" uid="42" created_at="2026-06-01T10:00:00Z"
             closed_at="2026-06-01T11:00:00Z" changes_count="5"
             comments_count="2"
             min_lat="1.0" max_lat="2.0" min_lon="3.0" max_lon="4.0">
    <tag k="created_by" v="JOSM"/>
    <tag k="comment" v="hello"/>
  </changeset>
  <changeset id="200" uid="42" created_at="2026-05-01T10:00:00Z"
             changes_count="3" comments_count="0"/>
  <changeset id="300" uid="42" created_at="2026-04-01T10:00:00Z"
             changes_count="7" comments_count="3"/>
</osm>
"""

_USER_XML = b"""<?xml version="1.0"?>
<osm>
  <user account_created="2020-01-01T00:00:00Z">
    <changesets count="999"/>
  </user>
</osm>
"""

# Discussion for cs 100: one comment from someone else, one from the entry itself.
_CS_100_XML = b"""<?xml version="1.0"?>
<osm>
  <changeset id="100">
    <discussion>
      <comment id="1" user="reviewer_bob" date="2026-06-02T09:00:00Z">
        <text>please fix this</text>
      </comment>
      <comment id="2" user="WatchedUser" date="2026-06-02T10:00:00Z">
        <text>my own reply, should be skipped</text>
      </comment>
    </discussion>
  </changeset>
</osm>
"""

# Discussion for cs 300: one comment from someone else.
_CS_300_XML = b"""<?xml version="1.0"?>
<osm>
  <changeset id="300">
    <discussion>
      <comment id="9" user="reviewer_amy" date="2026-04-02T09:00:00Z">
        <text>old note</text>
      </comment>
    </discussion>
  </changeset>
</osm>
"""


class _FakeResp:
    def __init__(self, content, status_code=200):
        self.content = content
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


def _make_get(routes):
    """Return a fake requests.get that maps URL substrings to responses.

    Records which URLs were called on the returned function's .calls list.
    """
    calls = []

    def _get(url, headers=None, timeout=None):
        calls.append(url)
        for needle, resp in routes:
            if needle in url:
                return resp
        raise AssertionError(f"Unexpected URL: {url}")

    _get.calls = calls
    return _get


# ---------------------------------------------------------------------------
# 1. fetch_discussions_live
# ---------------------------------------------------------------------------


def test_fetch_discussions_live_filters_and_merges(app, monkeypatch):
    routes = [
        ("/changesets?display_name", _FakeResp(_CHANGESETS_XML)),
        ("/changeset/100", _FakeResp(_CS_100_XML)),
        ("/changeset/300", _FakeResp(_CS_300_XML)),
    ]
    fake_get = _make_get(routes)
    monkeypatch.setattr(watchlist_osm.http_requests, "get", fake_get)

    entry = types.SimpleNamespace(
        osm_username="WatchedUser",
        flagged_discussions=json.dumps(["https://www.openstreetmap.org/changeset/300"]),
    )

    with app.app_context():
        discussions = fetch_discussions_live(entry)

    # Only cs 100 and cs 300 (comments_count > 0) are fetched, NOT cs 200.
    assert any("/changeset/100" in u for u in fake_get.calls)
    assert any("/changeset/300" in u for u in fake_get.calls)
    assert not any("/changeset/200" in u for u in fake_get.calls)

    # Own comment (WatchedUser on cs 100) is skipped; two foreign comments remain.
    authors = {d["author"] for d in discussions}
    assert authors == {"reviewer_bob", "reviewer_amy"}
    assert "WatchedUser" not in authors

    # Flagged merge: cs 300's link is flagged and sorts first.
    cs300 = next(d for d in discussions if "/changeset/300" in d["link"])
    cs100 = next(d for d in discussions if "/changeset/100" in d["link"])
    assert cs300["flagged"] is True
    assert cs100["flagged"] is False
    assert discussions[0]["flagged"] is True  # flagged-first sort


# ---------------------------------------------------------------------------
# 2. refresh_entry_stats does NOT write cached_discussions
# ---------------------------------------------------------------------------


def test_refresh_entry_stats_no_discussions(app, db_session, monkeypatch):
    routes = [
        ("/changesets?display_name", _FakeResp(_CHANGESETS_XML)),
        ("/user/42", _FakeResp(_USER_XML)),
    ]
    fake_get = _make_get(routes)
    monkeypatch.setattr(watchlist_osm.http_requests, "get", fake_get)

    friend = Friend.create(
        osm_username="StatsUser",
        added_by="auth0|timekeeping-test",
        org_id=ORG,
    )

    refresh_entry_stats(friend, FriendChangeset)

    # No per-changeset discussion endpoint should ever be hit here.
    assert not any("include_discussion" in u for u in fake_get.calls)

    refreshed = Friend.query.get(friend.id)
    assert refreshed.cached_last_active is not None
    assert refreshed.cached_total_changesets == 999
    assert refreshed.cached_account_created is not None
    assert refreshed.osm_uid == 42
    # The critical assertion: discussions are never written.
    assert refreshed.cached_discussions is None
    # Changesets were upserted.
    assert FriendChangeset.query.filter_by(friend_id=friend.id).count() == 3


# ---------------------------------------------------------------------------
# 3. fetch_friend_discussions endpoint
# ---------------------------------------------------------------------------


def test_fetch_friend_discussions_endpoint(app, db_session, monkeypatch):
    routes = [
        ("/changesets?display_name", _FakeResp(_CHANGESETS_XML)),
        ("/changeset/100", _FakeResp(_CS_100_XML)),
        ("/changeset/300", _FakeResp(_CS_300_XML)),
    ]
    fake_get = _make_get(routes)
    monkeypatch.setattr(watchlist_osm.http_requests, "get", fake_get)

    friend = Friend.create(
        osm_username="WatchedUser",
        added_by="auth0|timekeeping-test",
        org_id=ORG,
    )
    db_session.flush()

    admin = types.SimpleNamespace(
        id="auth0|admin-test", role="admin", is_active=True, org_id=ORG
    )

    with app.test_request_context(json={"friend_id": friend.id}):
        g.user = admin
        resp = FriendAPI().post("fetch_friend_discussions")

    assert resp["status"] == 200
    assert "discussions" in resp
    authors = {d["author"] for d in resp["discussions"]}
    assert authors == {"reviewer_bob", "reviewer_amy"}


def test_fetch_friend_discussions_missing_id(app, db_session):
    admin = types.SimpleNamespace(
        id="auth0|admin-test", role="admin", is_active=True, org_id=ORG
    )
    with app.test_request_context(json={}):
        g.user = admin
        resp = FriendAPI().post("fetch_friend_discussions")
    assert resp["status"] == 400


# ---------------------------------------------------------------------------
# 4. run_watchlist_refresh_job
# ---------------------------------------------------------------------------


def test_run_watchlist_refresh_job_completes(app, db_session, monkeypatch):
    Friend.create(osm_username="F1", added_by="auth0|timekeeping-test", org_id=ORG)
    Friend.create(osm_username="F2", added_by="auth0|timekeeping-test", org_id=ORG)
    db_session.flush()

    refreshed = []
    monkeypatch.setattr(
        watchlist_refresh,
        "refresh_entry_stats",
        lambda entry, model: refreshed.append(entry.osm_username),
    )
    monkeypatch.setattr(watchlist_refresh.time, "sleep", lambda s: None)

    job = types.SimpleNamespace(
        id="job-test",
        org_id=ORG,
        status=None,
        started_at=None,
        completed_at=None,
        progress=None,
        error=None,
    )

    with app.app_context():
        watchlist_refresh.run_watchlist_refresh_job(job)

    assert job.status == "completed"
    assert "refreshed 2, failed 0" == job.progress
    assert set(refreshed) == {"F1", "F2"}


def test_run_watchlist_refresh_job_counts_failures(app, db_session, monkeypatch):
    Friend.create(osm_username="GoodOne", added_by="auth0|timekeeping-test", org_id=ORG)
    Friend.create(osm_username="BadOne", added_by="auth0|timekeeping-test", org_id=ORG)
    db_session.flush()

    def _refresh(entry, model):
        if entry.osm_username == "BadOne":
            raise RuntimeError("OSM down")

    monkeypatch.setattr(watchlist_refresh, "refresh_entry_stats", _refresh)
    monkeypatch.setattr(watchlist_refresh.time, "sleep", lambda s: None)

    job = types.SimpleNamespace(
        id="job-test-2",
        org_id=ORG,
        status=None,
        started_at=None,
        completed_at=None,
        progress=None,
        error=None,
    )

    with app.app_context():
        watchlist_refresh.run_watchlist_refresh_job(job)

    assert job.status == "completed"
    assert job.progress == "refreshed 1, failed 1"
