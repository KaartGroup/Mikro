#!/usr/bin/env python3
"""
Friends List API endpoints for Mikro.

Manages a watchlist of friendly OSM editors ("friends"),
caches their changeset activity from the OSM API, and provides
detail/heatmap data for analysis.
"""

from flask.views import MethodView
from flask import g, request, current_app
from ..utils import requires_team_admin_or_above
from ..utils.watchlist_osm import refresh_entry_stats, fetch_discussions_live
from ..database import db, Friend, FriendChangeset
import json


class FriendAPI(MethodView):
    """Friends watchlist management API."""

    def post(self, path: str):
        if path == "fetch_friends":
            return self.fetch_friends()
        elif path == "create_friend":
            return self.create_friend()
        elif path == "update_friend":
            return self.update_friend()
        elif path == "delete_friend":
            return self.delete_friend()
        elif path == "fetch_friend_detail":
            return self.fetch_friend_detail()
        elif path == "refresh_friend_activity":
            return self.refresh_friend_activity()
        elif path == "fetch_friend_discussions":
            return self.fetch_friend_discussions()
        elif path == "toggle_discussion_flag":
            return self.toggle_discussion_flag()
        return {"message": "Unknown path", "status": 404}

    # ─── List all friends ──────────────────────────────────

    @requires_team_admin_or_above
    def fetch_friends(self):
        """Return all friends for the org with cached stats."""
        org_id = g.user.org_id
        friends = (
            Friend.query.filter_by(org_id=org_id)
            .order_by(Friend.created_at.desc())
            .all()
        )

        result = []
        for p in friends:
            result.append(
                {
                    "id": p.id,
                    "osm_username": p.osm_username,
                    "osm_uid": p.osm_uid,
                    "notes": p.notes,
                    "tags": p.tags or [],
                    "added_by": p.added_by,
                    "added_by_name": p.added_by_name,
                    "created_at": p.created_at.isoformat() if p.created_at else None,
                    "cached_total_changesets": p.cached_total_changesets,
                    "cached_last_active": (
                        p.cached_last_active.isoformat()
                        if p.cached_last_active
                        else None
                    ),
                    "cached_account_created": (
                        p.cached_account_created.isoformat()
                        if p.cached_account_created
                        else None
                    ),
                    "cache_updated_at": (
                        p.cache_updated_at.isoformat() if p.cache_updated_at else None
                    ),
                }
            )

        return {"status": 200, "friends": result}

    # ─── Create friend ─────────────────────────────────────

    @requires_team_admin_or_above
    def create_friend(self):
        """Add a new friend to the watchlist."""
        data = request.json or {}
        osm_username = (data.get("osm_username") or "").strip()
        if not osm_username:
            return {"message": "osm_username is required", "status": 400}

        # Check for duplicate
        existing = Friend.query.filter_by(osm_username=osm_username).first()
        if existing:
            return {
                "message": f"'{osm_username}' is already on the watchlist",
                "status": 400,
            }

        # Build added_by_name from the current user
        first = g.user.first_name or ""
        last = g.user.last_name or ""
        added_by_name = f"{first} {last}".strip() or g.user.email or str(g.user.id)

        friend = Friend.create(
            osm_username=osm_username,
            notes=data.get("notes"),
            tags=data.get("tags"),
            added_by=g.user.id,
            added_by_name=added_by_name,
            org_id=g.user.org_id,
        )

        # Populate initial data from OSM
        try:
            self._refresh_friend(friend)
        except Exception as e:
            current_app.logger.warning(
                f"Failed to fetch initial OSM data for friend '{osm_username}': {e}"
            )

        return {
            "status": 200,
            "message": f"'{osm_username}' added to watchlist",
            "friend": {"id": friend.id, "osm_username": friend.osm_username},
        }

    # ─── Update friend ─────────────────────────────────────

    @requires_team_admin_or_above
    def update_friend(self):
        """Update notes and/or tags for a friend."""
        data = request.json or {}
        friend_id = data.get("friend_id")
        if not friend_id:
            return {"message": "friend_id is required", "status": 400}

        friend = Friend.query.get(friend_id)
        if not friend:
            return {"message": "Friend not found", "status": 404}

        updates = {}
        if "notes" in data:
            updates["notes"] = data["notes"]
        if "tags" in data:
            updates["tags"] = data["tags"]

        if updates:
            friend.update(**updates)

        return {"status": 200, "message": "Friend updated"}

    # ─── Delete friend ─────────────────────────────────────

    @requires_team_admin_or_above
    def delete_friend(self):
        """Hard delete a friend and its cached changesets."""
        data = request.json or {}
        friend_id = data.get("friend_id")
        if not friend_id:
            return {"message": "friend_id is required", "status": 400}

        friend = Friend.query.get(friend_id)
        if not friend:
            return {"message": "Friend not found", "status": 404}

        # Delete cached changesets first
        FriendChangeset.query.filter_by(friend_id=friend_id).delete()
        db.session.delete(friend)
        db.session.commit()

        return {"status": 200, "message": "Friend deleted"}

    # ─── Friend detail ─────────────────────────────────────

    @requires_team_admin_or_above
    def fetch_friend_detail(self):
        """Return friend info, cached changesets, heatmap points, and summary."""
        data = request.json or {}
        friend_id = data.get("friend_id")
        if not friend_id:
            return {"message": "friend_id is required", "status": 400}

        friend = Friend.query.get(friend_id)
        if not friend:
            return {"message": "Friend not found", "status": 404}

        changesets = (
            FriendChangeset.query.filter_by(friend_id=friend_id)
            .order_by(FriendChangeset.created_at.desc())
            .all()
        )

        changeset_list = []
        heatmap_points = []
        hashtag_counts = {}
        total_changes = 0

        for cs in changesets:
            changeset_list.append(
                {
                    "changeset_id": cs.changeset_id,
                    "created_at": cs.created_at.isoformat() if cs.created_at else None,
                    "closed_at": cs.closed_at.isoformat() if cs.closed_at else None,
                    "changes_count": cs.changes_count or 0,
                    "comment": cs.comment,
                    "editor": cs.editor,
                    "source": cs.source,
                    "centroid_lat": cs.centroid_lat,
                    "centroid_lon": cs.centroid_lon,
                    "hashtags": cs.hashtags or [],
                }
            )

            total_changes += cs.changes_count or 0

            # Heatmap points
            if cs.centroid_lat is not None and cs.centroid_lon is not None:
                weight = cs.changes_count if cs.changes_count else 1
                heatmap_points.append([cs.centroid_lat, cs.centroid_lon, weight])

            # Hashtag summary
            for ht in cs.hashtags or []:
                ht_clean = ht.strip().lower()
                if ht_clean:
                    hashtag_counts[ht_clean] = hashtag_counts.get(ht_clean, 0) + 1

        # Sort hashtags by count descending
        hashtag_summary = [
            {"hashtag": k, "count": v}
            for k, v in sorted(hashtag_counts.items(), key=lambda x: -x[1])
        ]

        friend_info = {
            "id": friend.id,
            "osm_username": friend.osm_username,
            "osm_uid": friend.osm_uid,
            "notes": friend.notes,
            "tags": friend.tags or [],
            "added_by": friend.added_by,
            "added_by_name": friend.added_by_name,
            "created_at": friend.created_at.isoformat() if friend.created_at else None,
            "cached_total_changesets": friend.cached_total_changesets,
            "cached_last_active": (
                friend.cached_last_active.isoformat()
                if friend.cached_last_active
                else None
            ),
            "cached_account_created": (
                friend.cached_account_created.isoformat()
                if friend.cached_account_created
                else None
            ),
            "cache_updated_at": (
                friend.cache_updated_at.isoformat() if friend.cache_updated_at else None
            ),
        }

        return {
            "status": 200,
            "friend": friend_info,
            "changesets": changeset_list,
            "heatmapPoints": heatmap_points,
            "hashtagSummary": hashtag_summary,
            "summary": {
                "totalChangesets": len(changeset_list),
                "totalChanges": total_changes,
            },
        }

    # ─── Friend discussions (lazy, live) ──────────────────

    @requires_team_admin_or_above
    def fetch_friend_discussions(self):
        """Fetch discussion comments live from the OSM API (no caching)."""
        data = request.json or {}
        friend_id = data.get("friend_id")
        if not friend_id:
            return {"message": "friend_id is required", "status": 400}

        friend = Friend.query.get(friend_id)
        if not friend:
            return {"message": "Friend not found", "status": 404}

        try:
            discussions = fetch_discussions_live(friend)
        except Exception as e:
            current_app.logger.error(
                f"Failed to fetch discussions for friend '{friend.osm_username}': {e}"
            )
            return {"message": f"OSM API error: {str(e)}", "status": 502}

        return {"status": 200, "discussions": discussions}

    # ─── Refresh friend activity ───────────────────────────

    @requires_team_admin_or_above
    def refresh_friend_activity(self):
        """Fetch latest changeset data from OSM API and update cache."""
        data = request.json or {}
        friend_id = data.get("friend_id")
        if not friend_id:
            return {"message": "friend_id is required", "status": 400}

        friend = Friend.query.get(friend_id)
        if not friend:
            return {"message": "Friend not found", "status": 404}

        try:
            self._refresh_friend(friend)
        except Exception as e:
            current_app.logger.error(
                f"Failed to refresh friend '{friend.osm_username}': {e}"
            )
            return {"message": f"OSM API error: {str(e)}", "status": 502}

        return {
            "status": 200,
            "message": f"Activity refreshed for '{friend.osm_username}'",
        }

    # ─── Toggle discussion flag ───────────────────────────

    @requires_team_admin_or_above
    def toggle_discussion_flag(self):
        """Toggle a discussion link as flagged/unflagged."""
        data = request.json or {}
        friend_id = data.get("friend_id")
        link = data.get("link")
        if not friend_id or not link:
            return {"message": "friend_id and link are required", "status": 400}

        friend = Friend.query.get(friend_id)
        if not friend:
            return {"message": "Friend not found", "status": 404}

        flagged = set()
        if friend.flagged_discussions:
            try:
                flagged = set(json.loads(friend.flagged_discussions))
            except Exception:
                pass

        if link in flagged:
            flagged.discard(link)
            is_flagged = False
        else:
            flagged.add(link)
            is_flagged = True

        friend.flagged_discussions = json.dumps(list(flagged))
        db.session.commit()

        return {"status": 200, "flagged": is_flagged, "message": "Flag toggled"}

    # ─── Internal refresh logic ──────────────────────────

    def _refresh_friend(self, friend):
        """Fetch changesets from OSM API and update the friend's cached stats."""
        refresh_entry_stats(friend, FriendChangeset)
