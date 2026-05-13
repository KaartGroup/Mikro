#!/usr/bin/env python3
"""
Community Data API endpoints for Mikro.

Handles syncing community data from Google Sheets and managing entries.
"""

import json
import logging
from datetime import datetime

from flask.views import MethodView
from flask import g, request, current_app

from datetime import timedelta

from ..utils import requires_admin, requires_team_admin_or_above
from ..utils.tz import parse_filter_datetime
from ..auth import is_org_admin_or_above, team_admin_visible_user_ids
from ..database import db, CommunityEntry, User

logger = logging.getLogger(__name__)


def _read_google_sheet():
    """Read all rows from the configured Google Sheet."""
    creds_json = current_app.config.get("GOOGLE_SERVICE_ACCOUNT_JSON")
    spreadsheet_id = current_app.config.get("GOOGLE_SHEETS_SPREADSHEET_ID")
    tab_name = current_app.config.get("GOOGLE_SHEETS_TAB_NAME", "Form Responses 1")

    if not creds_json or not spreadsheet_id:
        return None, None, "Google Sheets not configured"

    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build

        creds_dict = json.loads(creds_json)
        creds = service_account.Credentials.from_service_account_info(
            creds_dict,
            scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"],
        )
        service = build("sheets", "v4", credentials=creds)
        result = (
            service.spreadsheets()
            .values()
            .get(spreadsheetId=spreadsheet_id, range=f"'{tab_name}'")
            .execute()
        )
        rows = result.get("values", [])
        if not rows:
            return [], [], None
        headers = rows[0]
        data_rows = rows[1:]
        return headers, data_rows, None
    except Exception as e:
        logger.error(f"Failed to read Google Sheet: {e}")
        return None, None, str(e)


class CommunityDataAPI(MethodView):
    """Community Data API endpoints."""

    def post(self, path: str):
        if path == "sync_from_sheet":
            return self.sync_from_sheet()
        elif path == "fetch_entries":
            return self.fetch_entries()
        elif path == "update_entry":
            return self.update_entry()
        elif path == "fetch_sheet_config":
            return self.fetch_sheet_config()
        return {"message": "Unknown path", "status": 404}

    @requires_admin
    def sync_from_sheet(self):
        """Sync new rows from Google Sheet into CommunityEntry table."""
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        headers, data_rows, error = _read_google_sheet()
        if error:
            return {"message": error, "status": 500}

        if not data_rows:
            return {
                "message": "Sync complete",
                "synced": 0,
                "skipped": 0,
                "total": 0,
                "status": 200,
            }

        try:
            # Get existing sheet_row_index values for this org to skip duplicates
            existing_indices = set(
                idx
                for (idx,) in db.session.query(CommunityEntry.sheet_row_index)
                .filter_by(org_id=g.user.org_id)
                .all()
            )

            # Determine if there's an "Email" or "Username" column
            headers_lower = [h.lower() for h in headers]
            email_col = None
            for i, h in enumerate(headers_lower):
                if h in ("email", "username"):
                    email_col = i
                    break

            count_new = 0
            count_skipped = 0

            for idx, row_values in enumerate(data_rows):
                # Row index is 1-based; row 1 is the header, so data starts at row 2
                row_index = idx + 2

                if row_index in existing_indices:
                    count_skipped += 1
                    continue

                # Pad row_values with empty strings if shorter than headers
                padded = row_values + [""] * (len(headers) - len(row_values))
                original_data = json.dumps(dict(zip(headers, padded)))

                # Try to parse the first column as a datetime (Google Forms timestamp)
                submitted_at = None
                if padded[0]:
                    for fmt in (
                        "%m/%d/%Y %H:%M:%S",
                        "%Y-%m-%d %H:%M:%S",
                        "%Y-%m-%dT%H:%M:%S",
                        "%m/%d/%Y",
                        "%Y-%m-%d",
                    ):
                        try:
                            submitted_at = datetime.strptime(padded[0], fmt)
                            break
                        except ValueError:
                            continue

                # Extract submitter from Email/Username column if present
                submitted_by = None
                if email_col is not None and email_col < len(padded) and padded[email_col]:
                    submitted_by = padded[email_col]

                entry = CommunityEntry(
                    org_id=g.user.org_id,
                    sheet_row_index=row_index,
                    entry_type="outreach",
                    submitted_at=submitted_at,
                    original_data=original_data,
                    submitted_by=submitted_by,
                )
                db.session.add(entry)
                count_new += 1

            db.session.commit()

            return {
                "message": "Sync complete",
                "synced": count_new,
                "skipped": count_skipped,
                "total": len(data_rows),
                "status": 200,
            }
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error syncing community data from sheet: {e}")
            return {"message": "Failed to sync from sheet", "status": 500}

    @requires_team_admin_or_above
    def fetch_entries(self):
        """Fetch community entries with optional filters.

        team_admin sees only entries whose ``submitted_by`` email
        matches a user on one of their managed teams (or themselves).
        Org Admin / super_admin see everything in the org.
        """
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        data = request.json or {}
        start_date_str = data.get("startDate")
        end_date_str = data.get("endDate")
        entry_type = data.get("entryType")

        try:
            query = CommunityEntry.query.filter_by(org_id=g.user.org_id)

            if not is_org_admin_or_above(g.user):
                scope_user_ids = team_admin_visible_user_ids(g.user)
                scope_emails = set()
                if scope_user_ids:
                    scope_emails = {
                        u.email
                        for u in User.query.filter(
                            User.id.in_(list(scope_user_ids))
                        ).all()
                        if u.email
                    }
                # No-match-possible sentinel keeps the query valid + empty
                # for callers with no scope (zero-team team_admin).
                allowed = list(scope_emails) or [""]
                query = query.filter(CommunityEntry.submitted_by.in_(allowed))

            if start_date_str:
                start_date, _ = parse_filter_datetime(start_date_str)
                if start_date is None:
                    return {"message": "Invalid startDate format", "status": 400}
                query = query.filter(CommunityEntry.submitted_at >= start_date)

            if end_date_str:
                end_date, end_was_date_only = parse_filter_datetime(end_date_str)
                if end_date is None:
                    return {"message": "Invalid endDate format", "status": 400}
                # Legacy behavior leaked the full boundary day via `<=`. Use
                # an exclusive upper bound for date-only input (add a day),
                # and treat explicit instants as-is.
                if end_was_date_only:
                    end_date = end_date + timedelta(days=1)
                query = query.filter(CommunityEntry.submitted_at < end_date)

            if entry_type:
                query = query.filter_by(entry_type=entry_type)

            # Order by submitted_at desc (nulls last), then created_at desc
            query = query.order_by(
                CommunityEntry.submitted_at.desc().nullslast(),
                CommunityEntry.created_at.desc(),
            )

            entries = query.all()

            # Build entry list and extract headers from the most recent entry
            entry_list = []
            headers = []

            for entry in entries:
                original = {}
                if entry.original_data:
                    try:
                        original = json.loads(entry.original_data)
                    except (json.JSONDecodeError, TypeError):
                        pass

                edited = {}
                if entry.edited_data:
                    try:
                        edited = json.loads(entry.edited_data)
                    except (json.JSONDecodeError, TypeError):
                        pass

                entry_list.append(
                    {
                        "id": entry.id,
                        "sheet_row_index": entry.sheet_row_index,
                        "entry_type": entry.entry_type,
                        "submitted_at": entry.submitted_at.isoformat() if entry.submitted_at else None,
                        "submitted_by": entry.submitted_by,
                        "original_data": original,
                        "edited_data": edited,
                        "is_edited": entry.is_edited,
                        "created_at": entry.created_at.isoformat() if entry.created_at else None,
                    }
                )

            # Get column headers from the most recent entry's original_data keys
            if entry_list and entry_list[0].get("original_data"):
                headers = list(entry_list[0]["original_data"].keys())

            return {"entries": entry_list, "headers": headers, "status": 200}
        except Exception as e:
            logger.error(f"Error fetching community entries: {e}")
            return {"message": "Failed to fetch entries", "status": 500}

    @requires_team_admin_or_above
    def update_entry(self):
        """Update a community entry's edited_data and/or entry_type.

        team_admin can update only entries submitted by a user on one
        of their managed teams (or themselves).
        """
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        data = request.json
        entry_id = data.get("id")
        edited_data_dict = data.get("edited_data")
        entry_type = data.get("entry_type")

        if not entry_id:
            return {"message": "id is required", "status": 400}

        try:
            entry = CommunityEntry.query.filter_by(
                id=entry_id, org_id=g.user.org_id
            ).first()

            if not entry:
                return {"message": "Entry not found", "status": 404}

            if not is_org_admin_or_above(g.user):
                scope_user_ids = team_admin_visible_user_ids(g.user)
                scope_emails = set()
                if scope_user_ids:
                    scope_emails = {
                        u.email
                        for u in User.query.filter(
                            User.id.in_(list(scope_user_ids))
                        ).all()
                        if u.email
                    }
                if entry.submitted_by not in scope_emails:
                    return {"message": "Entry not in your scope", "status": 403}

            if edited_data_dict is not None:
                entry.edited_data = json.dumps(edited_data_dict)
                entry.is_edited = True

            if entry_type is not None:
                entry.entry_type = entry_type

            db.session.commit()

            return {"message": "Entry updated", "status": 200}
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error updating community entry: {e}")
            return {"message": "Failed to update entry", "status": 500}

    @requires_team_admin_or_above
    def fetch_sheet_config(self):
        """Return current Google Sheet configuration and sync status."""
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        try:
            creds_json = current_app.config.get("GOOGLE_SERVICE_ACCOUNT_JSON")
            spreadsheet_id = current_app.config.get("GOOGLE_SHEETS_SPREADSHEET_ID")
            tab_name = current_app.config.get("GOOGLE_SHEETS_TAB_NAME", "Form Responses 1")

            configured = bool(creds_json and spreadsheet_id)

            # Mask the spreadsheet ID for security
            masked_id = None
            if spreadsheet_id:
                masked_id = spreadsheet_id[:4] + "..." + spreadsheet_id[-4:] if len(spreadsheet_id) > 8 else "***"

            # Get last sync timestamp and total entries for this org
            last_synced = None
            headers = []
            total_entries = 0

            most_recent = (
                CommunityEntry.query.filter_by(org_id=g.user.org_id)
                .order_by(CommunityEntry.created_at.desc())
                .first()
            )

            if most_recent:
                last_synced = most_recent.created_at.isoformat() if most_recent.created_at else None

                if most_recent.original_data:
                    try:
                        original = json.loads(most_recent.original_data)
                        headers = list(original.keys())
                    except (json.JSONDecodeError, TypeError):
                        pass

                total_entries = CommunityEntry.query.filter_by(
                    org_id=g.user.org_id
                ).count()

            return {
                "configured": configured,
                "tab_name": tab_name,
                "spreadsheet_id": masked_id,
                "last_synced": last_synced,
                "headers": headers,
                "total_entries": total_entries,
                "status": 200,
            }
        except Exception as e:
            logger.error(f"Error fetching sheet config: {e}")
            return {"message": "Failed to fetch sheet config", "status": 500}
