#!/usr/bin/env python3
"""
Payments page v1 API endpoints for Mikro.

End-of-month payroll workspace for org admins: cycle selector, per-
contributor payments table, adjustments, status state machine,
contributor drill-in, CSV export. Hourly-contractor scope only for v1
(see Trello DWAbQFlL and .claude/payments-page-v1-plan.md).

Routes mounted under ``/api/payments/`` in ``app.py``.
"""

import csv
import io
from datetime import date, datetime

from flask import Response, g, jsonify, request
from flask.views import MethodView

from ..auth import (
    is_org_admin_or_above,
    managed_team_ids_for,
    team_member_ids_for,
)
from ..auth.pay_visibility import can_view_pay_for
from ..database import (
    PaymentAdjustment,
    PaymentCycleStatus,
    TimeEntry,
    User,
    db,
)
from ..utils import requires_admin, requires_team_admin_or_above


# Status state machine for the cycle row pill
STATUS_PENDING = "pending"
STATUS_APPROVED = "approved"
STATUS_HELD = "held"
STATUS_PAID = "paid"
VALID_STATUSES = {STATUS_PENDING, STATUS_APPROVED, STATUS_HELD, STATUS_PAID}


def _parse_iso_date(raw):
    """Parse an ISO date (YYYY-MM-DD) from a request payload. Returns None on bad input."""
    if not raw:
        return None
    try:
        if isinstance(raw, date):
            return raw
        return datetime.strptime(raw[:10], "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def _scoped_user_ids(viewer):
    """Resolve the user-id set the viewer is allowed to see on the Payments page.

    - super_admin / admin: all users in their org (returns ``None`` to signal "no filter").
    - team_admin: union of members across managed teams.
    - anyone else: empty set (UI route blocks this anyway).
    """
    if is_org_admin_or_above(viewer):
        return None
    if getattr(viewer, "role", None) == "team_admin":
        return team_member_ids_for(managed_team_ids_for(viewer))
    return set()


class PaymentsAPI(MethodView):
    """Payments v1 endpoints."""

    def post(self, path: str):
        if path == "cycle":
            return self.fetch_cycle()
        elif path == "cycle/kpis":
            return self.fetch_cycle_kpis()
        elif path == "contributor":
            return self.fetch_contributor()
        elif path == "adjustment/create":
            return self.create_adjustment()
        elif path == "adjustment/delete":
            return self.delete_adjustment()
        elif path == "status/set":
            return self.set_status()
        elif path == "cycle/export":
            return self.export_cycle()
        return {"message": f"Unknown payments path: {path}", "status": 404}, 404

    # ────────────────────────── cycle table ──────────────────────────

    @requires_team_admin_or_above
    def fetch_cycle(self):
        """Return per-contributor rows for the given cycle range.

        Defaults to non-zero hours only (Logan's 2026-05-12 decision).
        Pass ``include_zero_hours: true`` to show every hourly contractor
        regardless of activity in the period.
        """
        return {"message": "Not implemented", "status": 501}, 501

    @requires_team_admin_or_above
    def fetch_cycle_kpis(self):
        """Return total_payable / approved_total / adjustments_total for the cycle."""
        return {"message": "Not implemented", "status": 501}, 501

    @requires_team_admin_or_above
    def fetch_contributor(self):
        """Drill-in detail for one user × cycle (sessions, adjustments, status history)."""
        return {"message": "Not implemented", "status": 501}, 501

    # ──────────────────────── adjustments ────────────────────────────

    @requires_admin
    def create_adjustment(self):
        """Create a new payment_adjustments row."""
        return {"message": "Not implemented", "status": 501}, 501

    @requires_admin
    def delete_adjustment(self):
        """Soft-delete an adjustment row (preserves audit trail)."""
        return {"message": "Not implemented", "status": 501}, 501

    # ──────────────────────── status setter ──────────────────────────

    @requires_admin
    def set_status(self):
        """Set the cycle status for a user. Creates the payment_cycle_status row lazily."""
        return {"message": "Not implemented", "status": 501}, 501

    # ───────────────────────── csv export ────────────────────────────

    @requires_admin
    def export_cycle(self):
        """Return a CSV of approved rows for the cycle (Aaron's disbursement worksheet)."""
        return {"message": "Not implemented", "status": 501}, 501
