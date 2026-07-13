#!/usr/bin/env python3
"""
Report Layouts API — persistence for the configurable Reports v2 page.

One saved layout per (org_id, team_id, name); team_id NULL = the org-level
default. Access rules:
  - Org admin and above: read/write any team's layout in their org, plus the
    org-level default.
  - Team lead (team_admin): read/write only layouts for teams they manage; may
    READ the org default as a fallback but not write it.

The stored ``config`` is the Puck layout JSON produced by the builder.
"""

from flask import g, request, jsonify
from flask.views import MethodView

from ..database import ReportLayout, db
from ..utils import requires_team_admin_or_above
from ..auth.team_scoping import (
    managed_team_ids_for,
    team_admin_can_access_team,
    is_org_admin_or_above,
)

DEFAULT_NAME = "default"


def _resolve_team_id(data):
    """Pick the target team for a request when the client doesn't specify one.

    Org admins default to the org-level layout (team_id NULL). A team lead with
    exactly one managed team defaults to that team; otherwise the org default.
    """
    if "team_id" in data:
        tid = data.get("team_id")
        return int(tid) if tid not in (None, "", 0) else None
    if is_org_admin_or_above(g.user):
        return None
    managed = managed_team_ids_for(g.user)
    return managed[0] if len(managed) == 1 else None


def _can_access(team_id, *, write):
    """Access check for a (viewer, team_id) pair. ``write`` tightens the
    org-default (team_id NULL) case to org-admin-only."""
    if is_org_admin_or_above(g.user):
        return True
    # Team lead:
    if team_id is None:
        return not write  # may read the org default, may not overwrite it
    return team_admin_can_access_team(g.user, team_id)


class ReportLayoutsAPI(MethodView):
    """Reports v2 layout persistence endpoints."""

    def post(self, path: str):
        if path == "fetch_layout":
            return self.fetch_layout()
        elif path == "save_layout":
            return self.save_layout()
        elif path == "list_layouts":
            return self.list_layouts()
        elif path == "delete_layout":
            return self.delete_layout()
        return jsonify({"message": "Endpoint not found", "status": 404}), 404

    @requires_team_admin_or_above
    def fetch_layout(self):
        data = request.get_json() or {}
        team_id = _resolve_team_id(data)
        name = (data.get("name") or DEFAULT_NAME).strip() or DEFAULT_NAME
        if not _can_access(team_id, write=False):
            return jsonify({"message": "Forbidden", "status": 403}), 403

        row = ReportLayout.query.filter_by(
            org_id=g.user.org_id, team_id=team_id, name=name
        ).first()
        return (
            jsonify(
                {
                    "status": 200,
                    "layout": (
                        {
                            "id": row.id,
                            "teamId": row.team_id,
                            "name": row.name,
                            "config": row.config,
                            "version": row.version,
                            "updatedBy": row.updated_by,
                            "updatedAt": (
                                row.updated_at.isoformat() + "Z"
                                if row.updated_at
                                else None
                            ),
                        }
                        if row
                        else None
                    ),
                }
            ),
            200,
        )

    @requires_team_admin_or_above
    def save_layout(self):
        data = request.get_json() or {}
        team_id = _resolve_team_id(data)
        name = (data.get("name") or DEFAULT_NAME).strip() or DEFAULT_NAME
        config = data.get("config")
        if not isinstance(config, dict):
            return (
                jsonify({"message": "config must be an object", "status": 400}),
                400,
            )
        if not _can_access(team_id, write=True):
            return jsonify({"message": "Forbidden", "status": 403}), 403

        row = ReportLayout.query.filter_by(
            org_id=g.user.org_id, team_id=team_id, name=name
        ).first()
        if row is None:
            row = ReportLayout()
            row.org_id = g.user.org_id
            row.team_id = team_id
            row.name = name
            row.created_by = g.user.id
        row.config = config
        row.version = int(data.get("version") or 1)
        row.updated_by = g.user.id
        row.save()

        return (
            jsonify({"status": 200, "message": "Layout saved", "layout_id": row.id}),
            200,
        )

    @requires_team_admin_or_above
    def list_layouts(self):
        q = ReportLayout.query.filter_by(org_id=g.user.org_id)
        if not is_org_admin_or_above(g.user):
            # Team leads see their teams' layouts plus the org default.
            managed = managed_team_ids_for(g.user)
            q = q.filter(
                (ReportLayout.team_id.in_(managed)) | (ReportLayout.team_id.is_(None))
            )
        rows = q.order_by(ReportLayout.updated_at.desc()).all()
        return (
            jsonify(
                {
                    "status": 200,
                    "layouts": [
                        {
                            "id": r.id,
                            "teamId": r.team_id,
                            "name": r.name,
                            "version": r.version,
                            "updatedAt": (
                                r.updated_at.isoformat() + "Z" if r.updated_at else None
                            ),
                        }
                        for r in rows
                    ],
                }
            ),
            200,
        )

    @requires_team_admin_or_above
    def delete_layout(self):
        data = request.get_json() or {}
        layout_id = data.get("layout_id")
        row = ReportLayout.query.filter_by(id=layout_id, org_id=g.user.org_id).first()
        if not row:
            return jsonify({"message": "Layout not found", "status": 404}), 404
        if not _can_access(row.team_id, write=True):
            return jsonify({"message": "Forbidden", "status": 403}), 403
        db.session.delete(row)
        db.session.commit()
        return jsonify({"status": 200, "message": "Layout deleted"}), 200
