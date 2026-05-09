#!/usr/bin/env python3
"""
Weekly Report API endpoints for Mikro.

Handles CRUD operations for weekly report drafts.
"""

import json
import logging
from datetime import datetime

from flask.views import MethodView
from flask import g, request

from ..utils import requires_admin, requires_team_admin_or_above
from ..auth import is_org_admin_or_above
from ..database import db, WeeklyReport

logger = logging.getLogger(__name__)


class WeeklyReportAPI(MethodView):
    """Weekly Report CRUD endpoints."""

    def post(self, path: str):
        if path == "save_draft":
            return self.save_draft()
        elif path == "fetch_drafts":
            return self.fetch_drafts()
        elif path == "fetch_draft":
            return self.fetch_draft()
        elif path == "delete_draft":
            return self.delete_draft()
        return {"message": "Unknown path", "status": 404}

    @requires_team_admin_or_above
    def save_draft(self):
        """Create or update a weekly report draft."""
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        data = request.json
        title = data.get("title")
        report_date_str = data.get("report_date")
        start_date_str = data.get("start_date")
        end_date_str = data.get("end_date")
        sections = data.get("sections")
        draft_id = data.get("id")

        if not title or not report_date_str or not start_date_str or not end_date_str:
            return {"message": "title, report_date, start_date, and end_date are required", "status": 400}

        if sections is None:
            return {"message": "sections is required", "status": 400}

        try:
            report_date = datetime.strptime(report_date_str, "%Y-%m-%d").date()
            start_date = datetime.strptime(start_date_str, "%Y-%m-%d").date()
            end_date = datetime.strptime(end_date_str, "%Y-%m-%d").date()
        except ValueError:
            return {"message": "Invalid date format. Use YYYY-MM-DD", "status": 400}

        # Serialize sections to JSON string if it's not already a string
        if isinstance(sections, (dict, list)):
            sections_json = json.dumps(sections)
        else:
            sections_json = sections

        try:
            if draft_id:
                # Update existing draft
                report = WeeklyReport.query.filter_by(
                    id=draft_id, org_id=g.user.org_id
                ).first()
                if not report:
                    return {"message": "Draft not found", "status": 404}

                # team_admin: can only update their own drafts
                if not is_org_admin_or_above(g.user) and report.created_by != g.user.id:
                    return {"message": "Not your draft", "status": 403}

                report.title = title
                report.report_date = report_date
                report.start_date = start_date
                report.end_date = end_date
                report.sections = sections_json
                db.session.commit()

                return {
                    "message": "Draft updated",
                    "id": report.id,
                    "status": 200,
                }
            else:
                # Create new draft
                report = WeeklyReport(
                    org_id=g.user.org_id,
                    title=title,
                    report_date=report_date,
                    start_date=start_date,
                    end_date=end_date,
                    sections=sections_json,
                    status="draft",
                    created_by=g.user.id,
                )
                db.session.add(report)
                db.session.commit()

                return {
                    "message": "Draft created",
                    "id": report.id,
                    "status": 200,
                }
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error saving weekly report draft: {e}")
            return {"message": "Failed to save draft", "status": 500}

    @requires_team_admin_or_above
    def fetch_drafts(self):
        """List all weekly report drafts for the org.

        team_admin sees only their own drafts; Org Admin sees all org drafts.
        """
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        try:
            drafts_query = WeeklyReport.query.filter_by(org_id=g.user.org_id)
            if not is_org_admin_or_above(g.user):
                drafts_query = drafts_query.filter(
                    WeeklyReport.created_by == g.user.id
                )
            drafts = drafts_query.order_by(WeeklyReport.updated_at.desc()).all()

            return {
                "drafts": [
                    {
                        "id": d.id,
                        "title": d.title,
                        "report_date": d.report_date.isoformat() if d.report_date else None,
                        "start_date": d.start_date.isoformat() if d.start_date else None,
                        "end_date": d.end_date.isoformat() if d.end_date else None,
                        "sections": d.sections,
                        "status": d.status,
                        "created_by": d.created_by,
                        "created_at": d.created_at.isoformat() if d.created_at else None,
                        "updated_at": d.updated_at.isoformat() if d.updated_at else None,
                    }
                    for d in drafts
                ],
                "status": 200,
            }
        except Exception as e:
            logger.error(f"Error fetching weekly report drafts: {e}")
            return {"message": "Failed to fetch drafts", "status": 500}

    @requires_team_admin_or_above
    def fetch_draft(self):
        """Fetch a single weekly report draft by ID."""
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        data = request.json
        draft_id = data.get("id")

        if not draft_id:
            return {"message": "id is required", "status": 400}

        try:
            report = WeeklyReport.query.filter_by(
                id=draft_id, org_id=g.user.org_id
            ).first()

            if not report:
                return {"message": "Draft not found", "status": 404}

            # team_admin: can only read their own drafts
            if not is_org_admin_or_above(g.user) and report.created_by != g.user.id:
                return {"message": "Not your draft", "status": 403}

            return {
                "draft": {
                    "id": report.id,
                    "title": report.title,
                    "report_date": report.report_date.isoformat() if report.report_date else None,
                    "start_date": report.start_date.isoformat() if report.start_date else None,
                    "end_date": report.end_date.isoformat() if report.end_date else None,
                    "sections": report.sections,
                    "status": report.status,
                    "created_by": report.created_by,
                    "created_at": report.created_at.isoformat() if report.created_at else None,
                    "updated_at": report.updated_at.isoformat() if report.updated_at else None,
                },
                "status": 200,
            }
        except Exception as e:
            logger.error(f"Error fetching weekly report draft: {e}")
            return {"message": "Failed to fetch draft", "status": 500}

    @requires_team_admin_or_above
    def delete_draft(self):
        """Delete a weekly report draft."""
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        data = request.json
        draft_id = data.get("id")

        if not draft_id:
            return {"message": "id is required", "status": 400}

        try:
            report = WeeklyReport.query.filter_by(
                id=draft_id, org_id=g.user.org_id
            ).first()

            if not report:
                return {"message": "Draft not found", "status": 404}

            # team_admin: can only delete their own drafts
            if not is_org_admin_or_above(g.user) and report.created_by != g.user.id:
                return {"message": "Not your draft", "status": 403}

            db.session.delete(report)
            db.session.commit()

            return {"message": "Draft deleted", "status": 200}
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error deleting weekly report draft: {e}")
            return {"message": "Failed to delete draft", "status": 500}
