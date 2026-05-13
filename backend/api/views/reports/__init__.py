#!/usr/bin/env python3
"""
Reports API endpoints for Mikro.

Handles editing statistics and timekeeping reports for admin dashboards.
"""

from flask.views import MethodView

from ...utils import requires_admin, requires_team_admin_or_above
from .editing_stats import fetch_editing_stats
from .timekeeping_stats import fetch_timekeeping_stats
from .changeset_heatmap import fetch_changeset_heatmap
from .element_analysis import (
    fetch_element_analysis,
    queue_element_analysis,
    check_element_analysis_status,
)
from .mapillary_stats import fetch_mapillary_stats


class ReportsAPI(MethodView):
    """Reports API endpoints."""

    def post(self, path: str):
        if path == "fetch_editing_stats":
            return self.fetch_editing_stats()
        elif path == "fetch_mr_stats":
            return self.fetch_editing_stats(source="mr")
        elif path == "fetch_timekeeping_stats":
            return self.fetch_timekeeping_stats()
        elif path == "fetch_changeset_heatmap":
            return self.fetch_changeset_heatmap()
        elif path == "fetch_element_analysis":
            return self.fetch_element_analysis()
        elif path == "queue_element_analysis":
            return self.queue_element_analysis()
        elif path == "check_element_analysis_status":
            return self.check_element_analysis_status()
        elif path == "fetch_mapillary_stats":
            return self.fetch_mapillary_stats()
        return {"message": "Unknown path", "status": 404}

    @requires_team_admin_or_above
    def fetch_editing_stats(self, source=None):
        return fetch_editing_stats(source)

    @requires_team_admin_or_above
    def fetch_timekeeping_stats(self):
        return fetch_timekeeping_stats()

    @requires_team_admin_or_above
    def fetch_changeset_heatmap(self):
        return fetch_changeset_heatmap()

    @requires_team_admin_or_above
    def fetch_element_analysis(self):
        return fetch_element_analysis()

    @requires_team_admin_or_above
    def queue_element_analysis(self):
        return queue_element_analysis()

    @requires_team_admin_or_above
    def check_element_analysis_status(self):
        return check_element_analysis_status()

    @requires_team_admin_or_above
    def fetch_mapillary_stats(self):
        return fetch_mapillary_stats()
