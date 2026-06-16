#!/usr/bin/env python3
"""
Punks List API endpoints for Mikro.

Manages a watchlist of problematic OSM editors ("punks"),
caches their changeset activity from the OSM API, and provides
detail/heatmap data for analysis.
"""

from flask.views import MethodView
from flask import g, request, current_app
from ..utils import requires_team_admin_or_above
from ..utils.watchlist_osm import refresh_entry_stats, fetch_discussions_live
from ..database import db, Punk, PunkChangeset
import json


class PunkAPI(MethodView):
    """Punks watchlist management API."""

    def post(self, path: str):
        if path == "fetch_punks":
            return self.fetch_punks()
        elif path == "create_punk":
            return self.create_punk()
        elif path == "update_punk":
            return self.update_punk()
        elif path == "delete_punk":
            return self.delete_punk()
        elif path == "fetch_punk_detail":
            return self.fetch_punk_detail()
        elif path == "refresh_punk_activity":
            return self.refresh_punk_activity()
        elif path == "fetch_punk_discussions":
            return self.fetch_punk_discussions()
        elif path == "toggle_discussion_flag":
            return self.toggle_discussion_flag()
        return {"message": "Unknown path", "status": 404}

    # ─── List all punks ──────────────────────────────────

    @requires_team_admin_or_above
    def fetch_punks(self):
        """Return all punks for the org with cached stats."""
        org_id = g.user.org_id
        punks = (
            Punk.query.filter_by(org_id=org_id).order_by(Punk.created_at.desc()).all()
        )

        result = []
        for p in punks:
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

        return {"status": 200, "punks": result}

    # ─── Create punk ─────────────────────────────────────

    @requires_team_admin_or_above
    def create_punk(self):
        """Add a new punk to the watchlist."""
        data = request.json or {}
        osm_username = (data.get("osm_username") or "").strip()
        if not osm_username:
            return {"message": "osm_username is required", "status": 400}

        # Check for duplicate
        existing = Punk.query.filter_by(osm_username=osm_username).first()
        if existing:
            return {
                "message": f"'{osm_username}' is already on the watchlist",
                "status": 400,
            }

        # Build added_by_name from the current user
        first = g.user.first_name or ""
        last = g.user.last_name or ""
        added_by_name = f"{first} {last}".strip() or g.user.email or str(g.user.id)

        punk = Punk.create(
            osm_username=osm_username,
            notes=data.get("notes"),
            tags=data.get("tags"),
            added_by=g.user.id,
            added_by_name=added_by_name,
            org_id=g.user.org_id,
        )

        # Populate initial data from OSM
        try:
            self._refresh_punk(punk)
        except Exception as e:
            current_app.logger.warning(
                f"Failed to fetch initial OSM data for punk '{osm_username}': {e}"
            )

        return {
            "status": 200,
            "message": f"'{osm_username}' added to watchlist",
            "punk": {"id": punk.id, "osm_username": punk.osm_username},
        }

    # ─── Update punk ─────────────────────────────────────

    @requires_team_admin_or_above
    def update_punk(self):
        """Update notes and/or tags for a punk."""
        data = request.json or {}
        punk_id = data.get("punk_id")
        if not punk_id:
            return {"message": "punk_id is required", "status": 400}

        punk = Punk.query.get(punk_id)
        if not punk:
            return {"message": "Punk not found", "status": 404}

        updates = {}
        if "notes" in data:
            updates["notes"] = data["notes"]
        if "tags" in data:
            updates["tags"] = data["tags"]

        if updates:
            punk.update(**updates)

        return {"status": 200, "message": "Punk updated"}

    # ─── Delete punk ─────────────────────────────────────

    @requires_team_admin_or_above
    def delete_punk(self):
        """Hard delete a punk and its cached changesets."""
        data = request.json or {}
        punk_id = data.get("punk_id")
        if not punk_id:
            return {"message": "punk_id is required", "status": 400}

        punk = Punk.query.get(punk_id)
        if not punk:
            return {"message": "Punk not found", "status": 404}

        # Delete cached changesets first
        PunkChangeset.query.filter_by(punk_id=punk_id).delete()
        db.session.delete(punk)
        db.session.commit()

        return {"status": 200, "message": "Punk deleted"}

    # ─── Punk detail ─────────────────────────────────────

    @requires_team_admin_or_above
    def fetch_punk_detail(self):
        """Return punk info, cached changesets, heatmap points, and summary."""
        data = request.json or {}
        punk_id = data.get("punk_id")
        if not punk_id:
            return {"message": "punk_id is required", "status": 400}

        punk = Punk.query.get(punk_id)
        if not punk:
            return {"message": "Punk not found", "status": 404}

        changesets = (
            PunkChangeset.query.filter_by(punk_id=punk_id)
            .order_by(PunkChangeset.created_at.desc())
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

        punk_info = {
            "id": punk.id,
            "osm_username": punk.osm_username,
            "osm_uid": punk.osm_uid,
            "notes": punk.notes,
            "tags": punk.tags or [],
            "added_by": punk.added_by,
            "added_by_name": punk.added_by_name,
            "created_at": punk.created_at.isoformat() if punk.created_at else None,
            "cached_total_changesets": punk.cached_total_changesets,
            "cached_last_active": (
                punk.cached_last_active.isoformat() if punk.cached_last_active else None
            ),
            "cached_account_created": (
                punk.cached_account_created.isoformat()
                if punk.cached_account_created
                else None
            ),
            "cache_updated_at": (
                punk.cache_updated_at.isoformat() if punk.cache_updated_at else None
            ),
        }

        return {
            "status": 200,
            "punk": punk_info,
            "changesets": changeset_list,
            "heatmapPoints": heatmap_points,
            "hashtagSummary": hashtag_summary,
            "summary": {
                "totalChangesets": len(changeset_list),
                "totalChanges": total_changes,
            },
        }

    # ─── Punk discussions (lazy, live) ────────────────────

    @requires_team_admin_or_above
    def fetch_punk_discussions(self):
        """Fetch discussion comments live from the OSM API (no caching)."""
        data = request.json or {}
        punk_id = data.get("punk_id")
        if not punk_id:
            return {"message": "punk_id is required", "status": 400}

        punk = Punk.query.get(punk_id)
        if not punk:
            return {"message": "Punk not found", "status": 404}

        try:
            discussions = fetch_discussions_live(punk)
        except Exception as e:
            current_app.logger.error(
                f"Failed to fetch discussions for punk '{punk.osm_username}': {e}"
            )
            return {"message": f"OSM API error: {str(e)}", "status": 502}

        return {"status": 200, "discussions": discussions}

    # ─── Refresh punk activity ───────────────────────────

    @requires_team_admin_or_above
    def refresh_punk_activity(self):
        """Fetch latest changeset data from OSM API and update cache."""
        data = request.json or {}
        punk_id = data.get("punk_id")
        if not punk_id:
            return {"message": "punk_id is required", "status": 400}

        punk = Punk.query.get(punk_id)
        if not punk:
            return {"message": "Punk not found", "status": 404}

        try:
            self._refresh_punk(punk)
        except Exception as e:
            current_app.logger.error(
                f"Failed to refresh punk '{punk.osm_username}': {e}"
            )
            return {"message": f"OSM API error: {str(e)}", "status": 502}

        return {
            "status": 200,
            "message": f"Activity refreshed for '{punk.osm_username}'",
        }

    # ─── Toggle discussion flag ───────────────────────────

    @requires_team_admin_or_above
    def toggle_discussion_flag(self):
        """Toggle a discussion link as flagged/unflagged."""
        data = request.json or {}
        punk_id = data.get("punk_id")
        link = data.get("link")
        if not punk_id or not link:
            return {"message": "punk_id and link are required", "status": 400}

        punk = Punk.query.get(punk_id)
        if not punk:
            return {"message": "Punk not found", "status": 404}

        flagged = set()
        if punk.flagged_discussions:
            try:
                flagged = set(json.loads(punk.flagged_discussions))
            except Exception:
                pass

        if link in flagged:
            flagged.discard(link)
            is_flagged = False
        else:
            flagged.add(link)
            is_flagged = True

        punk.flagged_discussions = json.dumps(list(flagged))
        db.session.commit()

        return {"status": 200, "flagged": is_flagged, "message": "Flag toggled"}

    # ─── Internal refresh logic ──────────────────────────

    def _refresh_punk(self, punk):
        """Fetch changesets from OSM API and update the punk's cached stats."""
        refresh_entry_stats(punk, PunkChangeset)
