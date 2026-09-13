#!/usr/bin/env python3
"""
Burndown Charts API — Reports v2 rate configuration and series data for the
High/Medium/Low priority burndown blocks.

Recalculating the historical rate and applying a rate are deliberately
separate actions (spec §5/§6): recalculate only refreshes the stored
``calculated_rate``, it never changes what's applied to the chart.
"""

from datetime import datetime

from flask import g, request
from flask.views import MethodView

from ..utils import requires_team_admin_or_above
from ..services import burndown_service as svc

VALID_SOURCES = {"historical_average", "manual"}


def _serialize(cfg):
    return {
        "priority": cfg.priority,
        "burndownStartDate": cfg.burndown_start_date.isoformat(),
        "startingTaskCount": cfg.starting_task_count,
        "calculatedRate": cfg.calculated_rate,
        "manualRate": cfg.manual_rate,
        "appliedRate": svc.applied_rate(cfg),
        "appliedRateSource": cfg.applied_rate_source,
        "lastRecalculatedAt": (
            cfg.last_recalculated_at.isoformat() + "Z"
            if cfg.last_recalculated_at
            else None
        ),
        "plannedSeries": svc.planned_series(cfg, g.user),
        "actualSeries": svc.actual_series(cfg, g.user),
        "projectedCompletionDate": svc.projected_completion_date(cfg, g.user),
    }


class BurndownAPI(MethodView):
    """Reports v2 burndown-chart rate endpoints."""

    def post(self, path: str):
        if path == "fetch_burndown":
            return self.fetch_burndown()
        elif path == "recalculate_rate":
            return self.recalculate_rate()
        elif path == "apply_rate":
            return self.apply_rate()
        return {"message": f"Unknown burndown path: {path}", "status": 404}, 404

    @requires_team_admin_or_above
    def fetch_burndown(self):
        charts = [
            _serialize(svc.get_or_create_config(g.user.org_id, priority, g.user))
            for priority in svc.PRIORITIES
        ]
        return {"status": 200, "charts": charts}

    @requires_team_admin_or_above
    def recalculate_rate(self):
        data = request.get_json() or {}
        priority = data.get("priority")
        if priority not in svc.PRIORITIES:
            return {"message": "Invalid priority", "status": 400}, 400

        cfg = svc.get_or_create_config(g.user.org_id, priority, g.user)
        cfg.calculated_rate = svc.compute_calculated_rate(
            g.user.org_id, priority, g.user
        )
        cfg.last_recalculated_at = datetime.utcnow()
        cfg.save()
        return {"status": 200, "chart": _serialize(cfg)}

    @requires_team_admin_or_above
    def apply_rate(self):
        data = request.get_json() or {}
        priority = data.get("priority")
        source = data.get("source")
        if priority not in svc.PRIORITIES:
            return {"message": "Invalid priority", "status": 400}, 400
        if source not in VALID_SOURCES:
            return {"message": "Invalid rate source", "status": 400}, 400

        cfg = svc.get_or_create_config(g.user.org_id, priority, g.user)
        if source == "manual":
            manual_rate = data.get("manualRate")
            try:
                manual_rate = float(manual_rate)
            except (TypeError, ValueError):
                return {"message": "manualRate must be a number", "status": 400}, 400
            if manual_rate < 0:
                return {"message": "manualRate must be >= 0", "status": 400}, 400
            cfg.manual_rate = manual_rate

        cfg.applied_rate_source = source
        cfg.updated_by = g.user.id
        cfg.save()
        return {"status": 200, "chart": _serialize(cfg)}
