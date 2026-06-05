#!/usr/bin/env python3
"""
HourlyRates API — CRUD for per-user time-bounded hourly rates.

Routes mounted under ``/api/hourly-rates/`` in ``app.py``.

Endpoints (all require team_admin or above):
  GET    ?user_id=<id>               list rate history for a user
  POST   {user_id, rate, start_date, end_date?, notes?}  add a new rate entry
  DELETE {rate_id, user_id}          delete an entry (if no paid cycle overlaps)
"""

from datetime import date

from flask import g, request
from flask.views import MethodView

from ..auth import is_org_admin_or_above, team_admin_can_access_user
from ..database import User
from ..services.hourly_rate_history import (
    DeleteGuardError,
    HourlyRateHistoryService,
    OverlapError,
)
from ..utils import requires_team_admin_or_above


def _serialize(entry) -> dict:
    return {
        "id": entry.id,
        "user_id": entry.user_id,
        "org_id": entry.org_id,
        "rate": float(entry.rate),
        "start_date": entry.start_date.isoformat(),
        "end_date": entry.end_date.isoformat() if entry.end_date else None,
        "created_by": entry.created_by,
        "created_at": entry.created_at.isoformat() if entry.created_at else None,
        "notes": entry.notes,
    }


def _load_target_user(user_id: str):
    """Return the target User row or None; also checks cross-org access."""
    user = User.query.get(user_id)
    if not user or user.org_id != g.user.org_id:
        return None
    return user


def _can_access(target_user) -> bool:
    if is_org_admin_or_above(g.user):
        return True
    return team_admin_can_access_user(g.user, target_user.id)


class HourlyRatesAPI(MethodView):

    @requires_team_admin_or_above
    def get(self):
        user_id = request.args.get("user_id", "").strip()
        if not user_id:
            return {"message": "user_id required", "status": 400}

        target = _load_target_user(user_id)
        if not target:
            return {"message": "User not found", "status": 404}
        if not _can_access(target):
            return {"message": "Forbidden", "status": 403}

        svc = HourlyRateHistoryService()
        entries = svc.get_rate_history(user_id)
        return {
            "rates": [_serialize(e) for e in entries],
            "status": 200,
        }

    @requires_team_admin_or_above
    def post(self):
        body = request.json or {}
        user_id = (body.get("user_id") or "").strip()
        if not user_id:
            return {"message": "user_id required", "status": 400}

        target = _load_target_user(user_id)
        if not target:
            return {"message": "User not found", "status": 404}
        if not _can_access(target):
            return {"message": "Forbidden", "status": 403}

        raw_rate = body.get("rate")
        if raw_rate is None:
            return {"message": "rate required", "status": 400}
        try:
            rate = float(raw_rate)
            if rate < 0:
                raise ValueError
        except (TypeError, ValueError):
            return {"message": "rate must be a non-negative number", "status": 400}

        raw_start = body.get("start_date")
        if not raw_start:
            return {"message": "start_date required (YYYY-MM-DD)", "status": 400}
        try:
            start_date = date.fromisoformat(str(raw_start))
        except ValueError:
            return {"message": "start_date must be YYYY-MM-DD", "status": 400}

        end_date = None
        if body.get("end_date"):
            try:
                end_date = date.fromisoformat(str(body["end_date"]))
            except ValueError:
                return {"message": "end_date must be YYYY-MM-DD", "status": 400}
            if end_date < start_date:
                return {"message": "end_date must be on or after start_date", "status": 400}

        notes = (body.get("notes") or "").strip() or None

        try:
            svc = HourlyRateHistoryService()
            entry = svc.create_rate(
                user_id=user_id,
                org_id=g.user.org_id,
                rate=rate,
                start_date=start_date,
                end_date=end_date,
                created_by=g.user.id,
                notes=notes,
            )
        except OverlapError as exc:
            return {"message": str(exc), "status": 409}

        return {"rate": _serialize(entry), "status": 201}

    @requires_team_admin_or_above
    def delete(self):
        body = request.json or {}
        rate_id = body.get("rate_id")
        user_id = (body.get("user_id") or "").strip()

        if not rate_id or not user_id:
            return {"message": "rate_id and user_id required", "status": 400}

        target = _load_target_user(user_id)
        if not target:
            return {"message": "User not found", "status": 404}
        if not _can_access(target):
            return {"message": "Forbidden", "status": 403}

        try:
            svc = HourlyRateHistoryService()
            svc.delete_rate(int(rate_id), user_id)
        except DeleteGuardError as exc:
            return {"message": str(exc), "status": 409}
        except ValueError as exc:
            return {"message": str(exc), "status": 404}

        return {"message": "Rate entry deleted", "status": 200}
