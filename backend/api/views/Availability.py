#!/usr/bin/env python3
"""
Availability API — recurring weekly working hours + date exceptions.

Routes mounted under ``/api/availability/`` in ``app.py``.

Permission model:
  - Everyone reads availability for anyone in their own org. These are working
    hours, not private data, and the whole point is cross-timezone visibility.
  - Writes are self-only, except org admins (and above), who may set another
    user's grid on their behalf.
  - Every read path is org-scoped; cross-org requests are rejected explicitly
    in the handler (the decorators do not do this).

All time math lives in ``services/availability.py`` — this module only parses
requests, checks permissions, and serializes.
"""

from datetime import datetime, timedelta, timezone

from flask import g, request
from flask.views import MethodView

from ..auth.team_scoping import is_org_admin_or_above
from ..database import Team, TeamUser, User
from ..services.availability import (
    DEFAULT_WEEKLY_BLOCKS,
    KIND_PREFERRED,
    MAX_BLOCKS_PER_GRID,
    MAX_RANGE_DAYS,
    MAX_USERS_PER_OVERLAP,
    AvailabilityService,
    intersect_intervals,
    resolve_timezone,
    validate_block,
    validate_exception,
)
from ..utils import requires_auth


class AvailabilityAPI(MethodView):
    """User availability endpoints."""

    def post(self, path: str):
        if path == "my":
            return self.my()
        elif path == "set_my":
            return self.set_my()
        elif path == "add_exception":
            return self.add_exception()
        elif path == "delete_exception":
            return self.delete_exception()
        elif path == "for_user":
            return self.for_user()
        elif path == "set_for_user":
            return self.set_for_user()
        elif path == "for_team":
            return self.for_team()
        elif path == "overlap":
            return self.overlap()
        return {"message": f"Unknown availability path: {path}", "status": 404}, 404

    # ── Serializers ───────────────────────────────────────────────────

    @staticmethod
    def _format_block(block) -> dict:
        return {
            "id": block.id,
            "user_id": block.user_id,
            "day_of_week": block.day_of_week,
            "start_minute": block.start_minute,
            "end_minute": block.end_minute,
            "kind": block.kind,
        }

    @staticmethod
    def _format_exception(exc, include_note: bool = True) -> dict:
        """Serialize one exception.

        ``note`` is free text where people write *why* they are out ("surgery",
        "custody week"). Working hours are org-visible by design; the reason is
        not, so it is withheld from everyone but the owner and org admins.
        """
        return {
            "id": exc.id,
            "user_id": exc.user_id,
            "date": exc.date.isoformat() if exc.date else None,
            "kind": exc.kind,
            "start_minute": exc.start_minute,
            "end_minute": exc.end_minute,
            "note": exc.note if include_note else None,
        }

    @staticmethod
    def _may_see_notes(user_id: str) -> bool:
        return user_id == g.user.id or is_org_admin_or_above(g.user)

    @classmethod
    def _format_user_availability(cls, user, blocks, exceptions) -> dict:
        """The per-user payload shape shared by every read endpoint."""
        include_note = cls._may_see_notes(user.id)
        return {
            "user_id": user.id,
            "first_name": user.first_name,
            "last_name": user.last_name,
            "email": user.email,
            "timezone": user.timezone,
            "has_timezone": bool(user.timezone),
            "blocks": [cls._format_block(b) for b in blocks],
            "exceptions": [
                cls._format_exception(e, include_note=include_note) for e in exceptions
            ],
        }

    # ── Request helpers ───────────────────────────────────────────────

    @staticmethod
    def _body():
        """The request body as a dict.

        ``request.json or {}`` is not enough: a valid JSON body may be a list,
        string, or number, all of which are truthy and have no ``.get``, so
        they would escape as an AttributeError -> HTTP 500.
        """
        raw = request.json
        return raw if isinstance(raw, dict) else {}

    @staticmethod
    def _parse_date(raw, field: str):
        """Return ``(date_or_None, error_dict_or_None)``.

        Absent -> ``(None, None)``. Malformed -> a 400 rather than silently
        substituting a default window the caller never asked for.
        """
        if raw in (None, ""):
            return None, None
        if not isinstance(raw, str):
            return None, {
                "message": f"{field} must be a YYYY-MM-DD string",
                "status": 400,
            }
        try:
            return datetime.strptime(raw[:10], "%Y-%m-%d").date(), None
        except ValueError:
            return None, {
                "message": f"{field} must be a valid YYYY-MM-DD date",
                "status": 400,
            }

    @classmethod
    def _parse_range(cls, body):
        """Return ``(start_date, end_date, error_dict)`` for a bounded range."""
        start, error_response = cls._parse_date(body.get("start_date"), "start_date")
        if error_response:
            return None, None, error_response
        end, error_response = cls._parse_date(body.get("end_date"), "end_date")
        if error_response:
            return None, None, error_response

        if start is None:
            start = datetime.now(timezone.utc).date()
        if end is None:
            end = start + timedelta(days=13)

        if end < start:
            return (
                None,
                None,
                {
                    "message": "end_date must not precede start_date",
                    "status": 400,
                },
            )
        if (end - start).days + 1 > MAX_RANGE_DAYS:
            return (
                None,
                None,
                {
                    "message": f"range must not exceed {MAX_RANGE_DAYS} days",
                    "status": 400,
                },
            )
        return start, end, None

    @staticmethod
    def _parse_int(raw, field: str):
        """Return ``(value, error_dict)``. A non-numeric body value is a 400.

        Without this, ``int(raw)`` on client-supplied JSON raises straight out
        of the handler and Flask turns it into a 500.
        """
        if raw is None:
            return None, {"message": f"{field} required", "status": 400}
        try:
            return int(raw), None
        except (TypeError, ValueError):
            return None, {"message": f"{field} must be an integer", "status": 400}

    @staticmethod
    def _same_org_user(user_id: str):
        """Return ``(user, error_dict)`` for a target in the viewer's org."""
        if not user_id:
            return None, {"message": "user_id required", "status": 400}
        # User.id is a varchar Auth0 sub; a non-string reaches psycopg2 as an
        # un-adaptable type and 500s, leaving the session in a failed txn.
        if not isinstance(user_id, str):
            return None, {"message": "user_id must be a string", "status": 400}
        target = User.query.filter(User.id == user_id).first()
        if target is None:
            return None, {"message": "User not found", "status": 404}
        if target.org_id != g.user.org_id:
            return None, {"message": "Cross-org request denied", "status": 403}
        return target, None

    # ── Self endpoints ────────────────────────────────────────────────

    @requires_auth
    def my(self):
        """My weekly grid + exceptions.

        A user who has never set a grid gets ``DEFAULT_WEEKLY_BLOCKS`` as a
        *suggestion* (``is_default: true``) — nothing is written until they
        save, so an untouched grid stays distinguishable from a deliberate one.
        """
        body = self._body()
        start, end, error_response = self._parse_range(body)
        if error_response:
            return error_response

        svc = AvailabilityService(g.user.org_id)
        blocks = svc.get_blocks(g.user.id)
        exceptions = svc.get_exceptions(g.user.id, start, end)

        payload = self._format_user_availability(g.user, blocks, exceptions)
        payload["is_default"] = not blocks
        if not blocks:
            payload["suggested_blocks"] = [dict(b) for b in DEFAULT_WEEKLY_BLOCKS]
        return {"availability": payload, "status": 200}

    @requires_auth
    def set_my(self):
        """Replace my entire weekly grid."""
        body = self._body()
        blocks = body.get("blocks")
        if not isinstance(blocks, list):
            return {"message": "blocks must be a list", "status": 400}
        if len(blocks) > MAX_BLOCKS_PER_GRID:
            return {
                "message": f"at most {MAX_BLOCKS_PER_GRID} blocks per grid",
                "status": 400,
            }

        for index, block in enumerate(blocks):
            if not isinstance(block, dict):
                return {"message": f"block {index} must be an object", "status": 400}
            error = validate_block(block)
            if error:
                return {"message": f"block {index}: {error}", "status": 400}

        svc = AvailabilityService(g.user.org_id)
        saved = svc.set_weekly(g.user.id, blocks)
        return {
            "blocks": [self._format_block(b) for b in saved],
            "count": len(saved),
            "message": "Availability saved",
            "status": 200,
        }

    @requires_auth
    def add_exception(self):
        """Add a date-specific override to my availability."""
        body = self._body()

        day = self._parse_date(body.get("date"), None)
        if day is None:
            return {"message": "date required (YYYY-MM-DD)", "status": 400}

        raw_kind = body.get("kind")
        raw_note = body.get("note")
        if raw_kind is not None and not isinstance(raw_kind, str):
            return {"message": "kind must be a string", "status": 400}
        if raw_note is not None and not isinstance(raw_note, str):
            return {"message": "note must be a string", "status": 400}
        kind = (raw_kind or "").strip().lower()
        start_minute = body.get("start_minute")
        end_minute = body.get("end_minute")
        error = validate_exception(kind, start_minute, end_minute)
        if error:
            return {"message": error, "status": 400}

        note = (raw_note or "").strip() or None

        svc = AvailabilityService(g.user.org_id)
        exc = svc.add_exception(
            user_id=g.user.id,
            day=day,
            kind=kind,
            start_minute=int(start_minute) if start_minute is not None else None,
            end_minute=int(end_minute) if end_minute is not None else None,
            note=note,
        )
        return {
            "exception": self._format_exception(exc),
            "message": "Exception added",
            "status": 200,
        }

    @requires_auth
    def delete_exception(self):
        """Delete one of my own exceptions."""
        body = self._body()
        exception_id, error_response = self._parse_int(
            body.get("exception_id"), "exception_id"
        )
        if error_response:
            return error_response

        svc = AvailabilityService(g.user.org_id)
        if not svc.delete_exception(g.user.id, exception_id):
            return {"message": "Exception not found", "status": 404}
        return {"message": "Exception deleted", "status": 200}

    # ── Other-user endpoints ──────────────────────────────────────────

    @requires_auth
    def for_user(self):
        """One teammate's availability (same org)."""
        body = self._body()
        start, end, error_response = self._parse_range(body)
        if error_response:
            return error_response

        target, error_response = self._same_org_user(body.get("user_id"))
        if error_response:
            return error_response

        svc = AvailabilityService(g.user.org_id)
        return {
            "availability": self._format_user_availability(
                target,
                svc.get_blocks(target.id),
                svc.get_exceptions(target.id, start, end),
            ),
            "status": 200,
        }

    @requires_auth
    def set_for_user(self):
        """Org admin sets another user's grid on their behalf."""
        body = self._body()
        if not is_org_admin_or_above(g.user):
            return {"message": "Org admin access required", "status": 403}

        target, error_response = self._same_org_user(body.get("user_id"))
        if error_response:
            return error_response

        blocks = body.get("blocks")
        if not isinstance(blocks, list):
            return {"message": "blocks must be a list", "status": 400}
        if len(blocks) > MAX_BLOCKS_PER_GRID:
            return {
                "message": f"at most {MAX_BLOCKS_PER_GRID} blocks per grid",
                "status": 400,
            }
        for index, block in enumerate(blocks):
            if not isinstance(block, dict):
                return {"message": f"block {index} must be an object", "status": 400}
            error = validate_block(block)
            if error:
                return {"message": f"block {index}: {error}", "status": 400}

        svc = AvailabilityService(g.user.org_id)
        saved = svc.set_weekly(target.id, blocks)
        return {
            "blocks": [self._format_block(b) for b in saved],
            "count": len(saved),
            "message": "Availability saved",
            "status": 200,
        }

    @requires_auth
    def for_team(self):
        """Every member of a team, for the overlap grid."""
        body = self._body()
        team_id, error_response = self._parse_int(body.get("team_id"), "team_id")
        if error_response:
            return error_response

        start, end, error_response = self._parse_range(body)
        if error_response:
            return error_response

        team = Team.query.filter(Team.id == team_id).first()
        if team is None:
            return {"message": "Team not found", "status": 404}
        if team.org_id != g.user.org_id:
            return {"message": "Cross-org request denied", "status": 403}

        member_ids = [
            row.user_id
            for row in TeamUser.query.filter(TeamUser.team_id == team.id).all()
        ]
        # Scope to the org too: a user who moved orgs may still carry a stale
        # TeamUser row, which would leak their availability to the old org.
        members = (
            User.query.filter(
                User.id.in_(member_ids), User.org_id == g.user.org_id
            ).all()
            if member_ids
            else []
        )

        svc = AvailabilityService(g.user.org_id)
        blocks = svc.get_blocks_for_users([u.id for u in members])
        exceptions = svc.get_exceptions_for_users([u.id for u in members], start, end)

        return {
            "team_id": team.id,
            "team_name": team.name,
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
            "members": [
                self._format_user_availability(
                    user, blocks.get(user.id, []), exceptions.get(user.id, [])
                )
                for user in members
            ],
            "count": len(members),
            "status": 200,
        }

    @requires_auth
    def overlap(self):
        """Common availability windows across a set of users.

        Body: ``user_ids`` (required), ``start_date``/``end_date`` (optional),
        ``threshold`` (optional, default = everyone), ``preferred_only``.
        Windows are returned as UTC ISO instants; the client renders them in
        the viewer's own zone.
        """
        body = self._body()
        user_ids = body.get("user_ids")
        if not isinstance(user_ids, list) or not user_ids:
            return {"message": "user_ids must be a non-empty list", "status": 400}
        # Non-string ids reach psycopg2 as an un-adaptable type and 500.
        if not all(isinstance(uid, str) for uid in user_ids):
            return {"message": "user_ids must all be strings", "status": 400}
        if len(user_ids) > MAX_USERS_PER_OVERLAP:
            return {
                "message": f"at most {MAX_USERS_PER_OVERLAP} user_ids per request",
                "status": 400,
            }

        start, end, error_response = self._parse_range(body)
        if error_response:
            return error_response

        users = User.query.filter(User.id.in_(user_ids)).all()
        # Cross-org check BEFORE the not-found check: reporting "unknown id"
        # only for ids that exist nowhere would confirm whether an arbitrary
        # Auth0 sub exists in another org.
        if any(u.org_id != g.user.org_id for u in users):
            return {"message": "Cross-org request denied", "status": 403}
        found_ids = {u.id for u in users}
        missing = [uid for uid in user_ids if uid not in found_ids]
        if missing:
            return {"message": f"Unknown user_ids: {missing}", "status": 404}

        threshold = body.get("threshold")
        if threshold is not None:
            try:
                threshold = int(threshold)
            except (TypeError, ValueError):
                return {"message": "threshold must be an integer", "status": 400}
            if not 1 <= threshold <= len(users):
                return {
                    "message": f"threshold must be between 1 and {len(users)}",
                    "status": 400,
                }

        kinds = {KIND_PREFERRED} if body.get("preferred_only") else None

        svc = AvailabilityService(g.user.org_id)
        per_user = svc.resolve_for_users(users, start, end, kinds=kinds)
        windows = intersect_intervals(per_user, threshold=threshold)

        viewer_timezone = g.user.timezone or str(resolve_timezone(None))
        return {
            "windows": [
                {
                    "start": w["start"].isoformat(),
                    "end": w["end"].isoformat(),
                    "count": w["count"],
                    "user_ids": w["user_ids"],
                }
                for w in windows
            ],
            "count": len(windows),
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
            "threshold": threshold if threshold is not None else len(users),
            "viewer_timezone": viewer_timezone,
            "users_without_timezone": [u.id for u in users if not u.timezone],
            "status": 200,
        }
