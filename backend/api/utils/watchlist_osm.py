#!/usr/bin/env python3
"""
Shared OSM helpers for the Friends / Punks watchlists.

Single source of truth for the two distinct kinds of work the watchlist does:

- ``refresh_entry_stats`` — cheap: pull the entry's recent changesets and
  refresh cached stats (last active, total changesets, account created). Does
  NOT fetch or store discussions.
- ``fetch_discussions_live`` — lazy, read-only: fetch changeset discussion
  comments on demand. Does NOT touch the DB.

Changeset listing is delegated to ``api.utils.changeset_fetcher.ChangesetFetcher``
so the watchlist shares one OSM-changeset fetch path with element analysis
(pagination + HTTP 429 backoff included). The per-changeset discussion read and
the OSM user-profile read are watchlist-specific and stay here.
"""

from datetime import datetime
import json
import xml.etree.ElementTree as ET

from flask import current_app
import requests as http_requests

from ..database import db
from .changeset_fetcher import ChangesetFetcher

OSM_API_BASE = "https://api.openstreetmap.org/api/0.6"
OSM_HEADERS = {"User-Agent": "Mikro/1.0 (https://mikro.kaart.com)"}
OSM_TIMEOUT = 30

# ChangesetFetcher requires a `since`; the watchlist wants the most recent N
# changesets regardless of age, so we page back from a date safely before OSM
# existed and cap with max_results.
_RECENT_LIMIT = 100
_OSM_EPOCH = datetime(2001, 1, 1)


def _fk_name(changeset_model):
    """FriendChangeset -> "friend_id", PunkChangeset -> "punk_id"."""
    return "friend_id" if changeset_model.__name__.startswith("Friend") else "punk_id"


def _parse_osm_dt(value):
    """Parse an OSM ISO8601 timestamp (``...Z``) to datetime, or None."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def _centroid(cs):
    """Centroid (lat, lon) from a changeset dict's bbox, or (None, None)."""
    min_lat = cs.get("min_lat")
    max_lat = cs.get("max_lat")
    min_lon = cs.get("min_lon")
    max_lon = cs.get("max_lon")
    if None in (min_lat, max_lat, min_lon, max_lon):
        return None, None
    return (
        (float(min_lat) + float(max_lat)) / 2,
        (float(min_lon) + float(max_lon)) / 2,
    )


def _split_hashtags(raw):
    if not raw:
        return []
    return [h.strip() for h in raw.split(";") if h.strip()]


def _recent_changesets(username):
    """Most-recent changeset dicts for a username via the shared fetcher."""
    if not username:
        return []
    return ChangesetFetcher().fetch(
        [username], since=_OSM_EPOCH, max_results=_RECENT_LIMIT
    )


def refresh_entry_stats(entry, changeset_model):
    """Fetch changesets from the OSM API and update the entry's cached stats.

    Stats-only: upserts new changesets and refreshes ``osm_uid``,
    ``cached_total_changesets``, ``cached_account_created``,
    ``cached_last_active``, and ``cache_updated_at``. Does NOT fetch or write
    discussions. ``changeset_model`` is FriendChangeset or PunkChangeset.
    """
    fk = _fk_name(changeset_model)

    # 1. Recent changesets (shared fetcher: paginates + retries on 429).
    changesets = _recent_changesets(entry.osm_username)

    # 2. uid comes from the changeset rows.
    uid = changesets[0].get("uid") if changesets else None

    # 3. Upsert changesets we don't already have.
    existing_ids = {
        row.changeset_id
        for row in changeset_model.query.filter_by(**{fk: entry.id}).all()
    }
    new_count = 0
    for cs in changesets:
        cs_id = cs.get("id")
        if cs_id is None or cs_id in existing_ids:
            continue
        centroid_lat, centroid_lon = _centroid(cs)
        tags = cs.get("tags") or {}
        hashtags = _split_hashtags(tags.get("hashtags"))
        db.session.add(
            changeset_model(
                **{fk: entry.id},
                changeset_id=cs_id,
                created_at=_parse_osm_dt(cs.get("created_at")) or datetime.utcnow(),
                closed_at=_parse_osm_dt(cs.get("closed_at")),
                changes_count=int(cs.get("changes_count") or 0),
                comment=tags.get("comment"),
                editor=tags.get("created_by"),
                source=tags.get("source"),
                centroid_lat=centroid_lat,
                centroid_lon=centroid_lon,
                hashtags=hashtags or None,
            )
        )
        new_count += 1

    if new_count > 0:
        db.session.flush()

    # 4. OSM user profile for account_created + lifetime changeset count.
    account_created = None
    total_changesets = None
    if uid:
        try:
            user_resp = http_requests.get(
                f"{OSM_API_BASE}/user/{uid}",
                headers=OSM_HEADERS,
                timeout=OSM_TIMEOUT,
            )
            if user_resp.status_code == 200:
                user_elem = ET.fromstring(user_resp.content).find("user")
                if user_elem is not None:
                    account_created = _parse_osm_dt(user_elem.get("account_created"))
                    cs_count_elem = user_elem.find("changesets")
                    if cs_count_elem is not None and cs_count_elem.get("count"):
                        total_changesets = int(cs_count_elem.get("count"))
        except Exception as e:
            current_app.logger.warning(
                f"Failed to fetch OSM user profile for uid {uid}: {e}"
            )

    # 5. Update cached fields.
    entry.osm_uid = uid
    if total_changesets is not None:
        entry.cached_total_changesets = total_changesets
    if account_created is not None:
        entry.cached_account_created = account_created

    last_active_row = (
        changeset_model.query.filter_by(**{fk: entry.id})
        .order_by(changeset_model.created_at.desc())
        .first()
    )
    if last_active_row:
        entry.cached_last_active = last_active_row.created_at

    entry.cache_updated_at = datetime.utcnow()
    db.session.commit()


def fetch_discussions_live(entry):
    """Fetch changeset discussion comments for an entry, live, with NO DB writes.

    1. List recent changesets (shared fetcher) and read ``comments_count``.
    2. Only for changesets with comments_count > 0, read the changeset with
       ``include_discussion=true`` and collect comments from OTHER users.
    3. Merge flagged state from ``flagged_discussions`` (read-only).
    4. Sort newest-first by pubDate, then flagged-first.

    Returns a list of discussion dicts.
    """
    username = entry.osm_username or ""

    cs_with_comments = [
        cs["id"]
        for cs in _recent_changesets(username)
        if cs.get("id") is not None and int(cs.get("comments_count") or 0) > 0
    ]

    discussions = []
    for cs_id in cs_with_comments:
        try:
            cs_resp = http_requests.get(
                f"{OSM_API_BASE}/changeset/{cs_id}?include_discussion=true",
                headers=OSM_HEADERS,
                timeout=OSM_TIMEOUT,
            )
            if cs_resp.status_code != 200:
                continue
            cs_elem = ET.fromstring(cs_resp.content).find("changeset")
            if cs_elem is None:
                continue
            disc_elem = cs_elem.find("discussion")
            if disc_elem is None:
                continue
            for comment in disc_elem.findall("comment"):
                comment_user = comment.get("user", "")
                # Skip the entry's own comments.
                if comment_user.lower() == username.lower():
                    continue
                discussions.append(
                    {
                        "title": f"Changeset {cs_id} — comment by {comment_user}",
                        "link": f"https://www.openstreetmap.org/changeset/{cs_id}",
                        "description": comment.findtext("text", ""),
                        "pubDate": comment.get("date", ""),
                        "commentId": comment.get("id", ""),
                        "author": comment_user,
                    }
                )
        except Exception as e:
            current_app.logger.warning(
                f"Failed to fetch discussion for changeset {cs_id}: {e}"
            )

    # Merge flagged state (read-only).
    flagged_links = set()
    if entry.flagged_discussions:
        try:
            flagged_links = set(json.loads(entry.flagged_discussions))
        except Exception:
            pass
    for disc in discussions:
        disc["flagged"] = disc.get("link", "") in flagged_links

    # Sort: newest first by pubDate, then flagged first.
    discussions.sort(key=lambda d: d.get("pubDate", "") or "", reverse=True)
    discussions.sort(key=lambda d: not d.get("flagged", False))
    return discussions
