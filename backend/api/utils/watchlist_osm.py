#!/usr/bin/env python3
"""
Shared OSM helpers for the Friends / Punks watchlists.

Single source of truth for the OSM API constants and the two distinct kinds of
work the watchlist does:

- ``refresh_entry_stats`` — cheap (~2 OSM calls): upsert changesets and refresh
  cached stats (last active, total changesets, account created). Does NOT fetch
  or store discussions.
- ``fetch_discussions_live`` — expensive, lazy, read-only: fetch changeset
  discussion comments on demand. Does NOT touch the DB.
"""

from datetime import datetime
import json
import xml.etree.ElementTree as ET

from flask import current_app
import requests as http_requests

from ..database import db

OSM_API_BASE = "https://api.openstreetmap.org/api/0.6"
OSM_HEADERS = {"User-Agent": "Mikro/1.0 (https://mikro.kaart.com)"}
OSM_TIMEOUT = 30


def _fk_name(changeset_model):
    """Return the FK column name linking a changeset row back to its entry.

    FriendChangeset -> "friend_id", PunkChangeset -> "punk_id".
    """
    return "friend_id" if changeset_model.__name__.startswith("Friend") else "punk_id"


def refresh_entry_stats(entry, changeset_model):
    """Fetch changesets from the OSM API and update the entry's cached stats.

    This is the stats-only path: it upserts new changesets and refreshes
    ``osm_uid``, ``cached_total_changesets``, ``cached_account_created``,
    ``cached_last_active``, and ``cache_updated_at``. It does NOT fetch or write
    discussions.

    ``changeset_model`` is FriendChangeset or PunkChangeset.
    """
    fk = _fk_name(changeset_model)

    # 1. Fetch changesets
    url = f"{OSM_API_BASE}/changesets?display_name={entry.osm_username}&limit=100"
    resp = http_requests.get(url, headers=OSM_HEADERS, timeout=OSM_TIMEOUT)
    resp.raise_for_status()

    root = ET.fromstring(resp.content)
    changesets = root.findall("changeset")

    # 2. Extract uid from first changeset
    uid = None
    if changesets:
        uid_str = changesets[0].get("uid")
        if uid_str:
            uid = int(uid_str)

    # 3. Upsert changesets
    existing_ids = set()
    existing_rows = changeset_model.query.filter_by(**{fk: entry.id}).all()
    for row in existing_rows:
        existing_ids.add(row.changeset_id)

    latest_closed = None
    new_count = 0

    for cs_elem in changesets:
        cs_id = int(cs_elem.get("id"))
        if cs_id in existing_ids:
            continue

        created_at_str = cs_elem.get("created_at")
        closed_at_str = cs_elem.get("closed_at")
        changes_count_str = cs_elem.get("changes_count", "0")

        created_at = (
            datetime.fromisoformat(created_at_str.replace("Z", "+00:00"))
            if created_at_str
            else datetime.utcnow()
        )
        closed_at = (
            datetime.fromisoformat(closed_at_str.replace("Z", "+00:00"))
            if closed_at_str
            else None
        )
        changes_count = int(changes_count_str) if changes_count_str else 0

        # Compute centroid from bbox
        min_lat = cs_elem.get("min_lat")
        max_lat = cs_elem.get("max_lat")
        min_lon = cs_elem.get("min_lon")
        max_lon = cs_elem.get("max_lon")
        centroid_lat = None
        centroid_lon = None
        if min_lat and max_lat and min_lon and max_lon:
            centroid_lat = (float(min_lat) + float(max_lat)) / 2
            centroid_lon = (float(min_lon) + float(max_lon)) / 2

        # Extract tags
        tags = {}
        for tag_elem in cs_elem.findall("tag"):
            tags[tag_elem.get("k")] = tag_elem.get("v")

        comment = tags.get("comment")
        editor = tags.get("created_by")
        source_val = tags.get("source")
        hashtags_raw = tags.get("hashtags", "")
        hashtags = (
            [h.strip() for h in hashtags_raw.split(";") if h.strip()]
            if hashtags_raw
            else []
        )

        cs_row = changeset_model(
            **{fk: entry.id},
            changeset_id=cs_id,
            created_at=created_at,
            closed_at=closed_at,
            changes_count=changes_count,
            comment=comment,
            editor=editor,
            source=source_val,
            centroid_lat=centroid_lat,
            centroid_lon=centroid_lon,
            hashtags=hashtags if hashtags else None,
        )
        db.session.add(cs_row)
        new_count += 1

        # Track latest closed_at
        if closed_at and (latest_closed is None or closed_at > latest_closed):
            latest_closed = closed_at

    if new_count > 0:
        db.session.flush()

    # 4. Try to fetch user profile for account_created and total changesets
    account_created = None
    total_changesets = None
    if uid:
        try:
            user_url = f"{OSM_API_BASE}/user/{uid}"
            user_resp = http_requests.get(
                user_url, headers=OSM_HEADERS, timeout=OSM_TIMEOUT
            )
            if user_resp.status_code == 200:
                user_root = ET.fromstring(user_resp.content)
                user_elem = user_root.find("user")
                if user_elem is not None:
                    acct_str = user_elem.get("account_created")
                    if acct_str:
                        account_created = datetime.fromisoformat(
                            acct_str.replace("Z", "+00:00")
                        )
                    cs_count_elem = user_elem.find("changesets")
                    if cs_count_elem is not None:
                        count_str = cs_count_elem.get("count")
                        if count_str:
                            total_changesets = int(count_str)
        except Exception as e:
            current_app.logger.warning(
                f"Failed to fetch OSM user profile for uid {uid}: {e}"
            )

    # 5. Update entry cached fields
    entry.osm_uid = uid
    if total_changesets is not None:
        entry.cached_total_changesets = total_changesets
    if account_created is not None:
        entry.cached_account_created = account_created

    # Determine last active from cached changesets
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

    1. List the entry's changesets (1 call), reading ``comments_count``.
    2. Only for changesets with comments_count > 0, fetch the changeset with
       ``include_discussion=true`` and collect comments from OTHER users.
    3. Merge flagged state from the entry's ``flagged_discussions`` (read-only).
    4. Sort newest-first by pubDate, then flagged-first.

    Returns a list of discussion dicts.
    """
    username = entry.osm_username or ""

    # 1. List changesets and read comments_count per changeset.
    url = f"{OSM_API_BASE}/changesets?display_name={username}&limit=100"
    resp = http_requests.get(url, headers=OSM_HEADERS, timeout=OSM_TIMEOUT)
    resp.raise_for_status()
    root = ET.fromstring(resp.content)

    cs_with_comments = []
    for cs_elem in root.findall("changeset"):
        cs_id = cs_elem.get("id")
        if not cs_id:
            continue
        comments_count_str = cs_elem.get("comments_count", "0") or "0"
        try:
            comments_count = int(comments_count_str)
        except (TypeError, ValueError):
            comments_count = 0
        if comments_count > 0:
            cs_with_comments.append(cs_id)

    discussions = []
    for cs_id in cs_with_comments:
        try:
            cs_url = f"{OSM_API_BASE}/changeset/{cs_id}?include_discussion=true"
            cs_resp = http_requests.get(
                cs_url, headers=OSM_HEADERS, timeout=OSM_TIMEOUT
            )
            if cs_resp.status_code != 200:
                continue
            cs_root = ET.fromstring(cs_resp.content)
            cs_elem = cs_root.find("changeset")
            if cs_elem is None:
                continue
            disc_elem = cs_elem.find("discussion")
            if disc_elem is None:
                continue
            for comment in disc_elem.findall("comment"):
                comment_user = comment.get("user", "")
                # Skip the entry's own comments
                if comment_user.lower() == username.lower():
                    continue
                comment_date = comment.get("date", "")
                comment_text = comment.findtext("text", "")
                comment_id = comment.get("id", "")
                discussions.append(
                    {
                        "title": f"Changeset {cs_id} — comment by {comment_user}",
                        "link": f"https://www.openstreetmap.org/changeset/{cs_id}",
                        "description": comment_text,
                        "pubDate": comment_date,
                        "commentId": comment_id,
                        "author": comment_user,
                    }
                )
        except Exception as e:
            current_app.logger.warning(
                f"Failed to fetch discussion for changeset {cs_id}: {e}"
            )

    # 3. Merge flagged state (read-only).
    flagged_links = set()
    if entry.flagged_discussions:
        try:
            flagged_links = set(json.loads(entry.flagged_discussions))
        except Exception:
            pass

    for disc in discussions:
        disc["flagged"] = disc.get("link", "") in flagged_links

    # 4. Sort: newest first by pubDate, then flagged first.
    discussions.sort(key=lambda d: d.get("pubDate", "") or "", reverse=True)
    discussions.sort(key=lambda d: not d.get("flagged", False))

    return discussions
