#!/usr/bin/env python3
"""
PaymentCycleService — payroll cycles, adjustments, statuses, and config.

Handles all computation and database operations for the Payments v1 page:
cycle row building, hourly/per-task payable calculation, adjustment
management, per-user cycle status, and payroll config.

The Flask view delegates to this class; the view retains HTTP request parsing,
auth decorators, permission checks, and response building. Static methods are
safe to call without a Flask application context.

Usage::

    svc = PaymentCycleService(g.user.org_id)
    hours = svc.hours_by_user(user_ids, cycle_start, cycle_end)
    row   = PaymentCycleService.build_row(user, hours, status)
"""

from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import cast, func, Date as SqlDate

from ..database import (
    PaymentCycleStatus,
    PayrollConfig,
    TimeEntry,
    db,
)


# ─── Constants ────────────────────────────────────────────────────────

VALID_COMP_MODELS = {
    "per_task",
    "hourly",
    "project_based",
}

STATUS_PENDING = "pending"
STATUS_APPROVED = "approved"
STATUS_HELD = "held"
STATUS_PAID = "paid"
VALID_STATUSES = {STATUS_PENDING, STATUS_APPROVED, STATUS_HELD, STATUS_PAID}

VALID_CADENCE = {"monthly", "semi_monthly", "bi_weekly"}


class PaymentCycleService:
    """Computation and database operations for the Payments v1 page.

    Construct with the current viewer's ``org_id``; all instance methods
    are org-scoped by construction so the isolation check never leaks
    out of the view into individual query sites.
    """

    def __init__(self, org_id: str):
        self.org_id = org_id

    # ─── Pure computation (static — no DB, no Flask context) ──────────

    @staticmethod
    def display_name(user) -> str:
        return (
            f"{user.first_name or ''} {user.last_name or ''}".strip()
            or user.email
            or user.id
        )

    @staticmethod
    def _resolve_hourly_rate(user):
        """Resolve the active hourly rate for a user.

        View callers set ``user._active_hourly_rate`` (a transient Python
        attribute) from the rate-history table before invoking any static
        computation helpers.  The fallback ``getattr`` supports _FakeUser
        objects in unit tests that set ``hourly_rate`` directly.
        """
        if hasattr(user, "_active_hourly_rate"):
            return user._active_hourly_rate
        return getattr(user, "hourly_rate", None)

    @staticmethod
    def effective_comp_model(user) -> str:
        """Resolve a user's effective compensation model (SSOT).

        NULL/unknown ``compensation_model`` is treated as legacy: hourly
        when an hourly rate is active, otherwise per_task (the core
        micropayment flow). Explicit valid values pass through unchanged.
        """
        m = getattr(user, "compensation_model", None)
        if m in VALID_COMP_MODELS:
            return m
        rate = PaymentCycleService._resolve_hourly_rate(user)
        return "hourly" if rate is not None else "per_task"

    @staticmethod
    def compute_payable(user, seconds, adj_total) -> tuple:
        """Per-model base + total. Single source of truth used by the
        table, KPIs, contributor detail, and CSV export.

        Returns ``(model, base, total)`` where ``total = base + adj_total``.

        - hourly:        hours × hourly_rate
        - per_task:      current unpaid micropayment balance (payable_total)
        - project_based: adjustments only (base 0)
        """
        hours = seconds / 3600.0 if seconds else 0.0
        _r = PaymentCycleService._resolve_hourly_rate(user)
        rate = float(_r) if _r is not None else None
        model = PaymentCycleService.effective_comp_model(user)

        if model == "per_task":
            base = float(getattr(user, "payable_total", 0) or 0)
        elif model == "project_based":
            base = 0.0
        else:  # hourly (and legacy resolved to hourly)
            base = round(hours * rate, 2) if rate is not None else 0.0

        total = round(base + (adj_total or 0.0), 2)
        return model, round(base, 2), total

    @staticmethod
    def passes_comp_filter(model: str, comp_filter) -> bool:
        """Cohort rule for the payments page.

        Explicit ``compensation`` filter → include iff model is in it.
        No filter → default-exclude per_task; include everything else.
        """
        if comp_filter is not None:
            return model in comp_filter
        return model != "per_task"

    @staticmethod
    def cycle_label(start: date, end: date, cadence: str) -> str:
        """Human label for a forecast cycle bar."""
        if cadence == "monthly":
            return start.strftime("%b %Y")
        if cadence == "semi_monthly":
            return f"{start.strftime('%b')} {start.day}–{end.day}"
        return f"{start.strftime('%b %d')}–{end.strftime('%d')}"

    @staticmethod
    def build_row(user, seconds, status_row) -> dict:
        """Compose a single PaymentCycleRow dict for the table."""
        hours = round(seconds / 3600.0, 2) if seconds else 0.0
        _r = PaymentCycleService._resolve_hourly_rate(user)
        rate = float(_r) if _r is not None else None
        model, base, total = PaymentCycleService.compute_payable(user, seconds, 0.0)
        wage = base
        return {
            "user_id": user.id,
            "name": PaymentCycleService.display_name(user),
            "first_name": user.first_name or "",
            "last_name": user.last_name or "",
            "email": user.email,
            "payment_email": user.payment_email,
            "osm_username": user.osm_username,
            "hours": hours,
            "seconds": seconds,
            "hourly_rate": rate,
            "compensation_model": model,
            "calculated_wage": wage,
            "reimbursements_total": 0.0,
            "reimbursements_count": 0,
            "total_payable": round(total, 2),
            "status": status_row.status if status_row else STATUS_PENDING,
            "status_note": status_row.note if status_row else None,
            "status_actor_id": status_row.actor_id if status_row else None,
            "status_updated_at": (
                status_row.updated_at.isoformat()
                if status_row and status_row.updated_at
                else None
            ),
        }

    # ─── DB reads (org-scoped instance methods) ───────────────────────

    def rates_by_user(self, user_ids, for_date) -> dict:
        """Return ``{user_id: float}`` of active hourly rates on ``for_date``.

        Callers should pre-populate ``user._active_hourly_rate`` from this
        map before invoking any static computation helpers (``compute_payable``,
        ``effective_comp_model``, etc.).
        """
        from .hourly_rate_history import HourlyRateHistoryService
        return HourlyRateHistoryService().rate_map_for_users(list(user_ids), for_date)

    def hours_by_user(
        self, user_ids, cycle_start: date, cycle_end: date
    ) -> dict:
        """Aggregate completed-session seconds per user inside the cycle window.

        ``user_ids`` is either an iterable of ids or ``None`` (no per-user filter).
        """
        q = (
            db.session.query(
                TimeEntry.user_id,
                func.coalesce(func.sum(TimeEntry.duration_seconds), 0).label("seconds"),
            )
            .filter(TimeEntry.status == "completed")
            .filter(TimeEntry.clock_out.isnot(None))
            .filter(cast(TimeEntry.clock_out, SqlDate) >= cycle_start)
            .filter(cast(TimeEntry.clock_out, SqlDate) <= cycle_end)
        )
        if user_ids is not None:
            ids = list(user_ids)
            if not ids:
                return {}
            q = q.filter(TimeEntry.user_id.in_(ids))
        return {
            row.user_id: int(row.seconds or 0)
            for row in q.group_by(TimeEntry.user_id).all()
        }

    def status_by_user(
        self, user_ids, cycle_start: date, cycle_end: date
    ) -> dict:
        """Return ``{user_id: PaymentCycleStatus}`` for a cycle.

        Missing rows are treated as ``STATUS_PENDING`` by the caller.
        """
        q = PaymentCycleStatus.query.filter(
            PaymentCycleStatus.cycle_start == cycle_start,
            PaymentCycleStatus.cycle_end == cycle_end,
        )
        if user_ids is not None:
            ids = list(user_ids)
            if not ids:
                return {}
            q = q.filter(PaymentCycleStatus.user_id.in_(ids))
        return {row.user_id: row for row in q.all()}

    def get_payroll_config(self):
        """Return the org's PayrollConfig row, or None if not yet saved."""
        return PayrollConfig.query.filter_by(org_id=self.org_id).first()

    # ─── DB mutations ─────────────────────────────────────────────────

    def upsert_cycle_status(
        self,
        user_id: str,
        cycle_start: date,
        cycle_end: date,
        status: str,
        note: str,
        actor_id: str,
    ) -> PaymentCycleStatus:
        """Create or update the PaymentCycleStatus row for a user × cycle."""
        row = PaymentCycleStatus.query.filter_by(
            user_id=user_id,
            cycle_start=cycle_start,
            cycle_end=cycle_end,
        ).first()
        if row:
            row.update(status=status, note=note, actor_id=actor_id)
        else:
            row = PaymentCycleStatus.create(
                user_id=user_id,
                cycle_start=cycle_start,
                cycle_end=cycle_end,
                status=status,
                note=note,
                actor_id=actor_id,
            )
        return row

    def save_payroll_config(
        self,
        cadence: str,
        anchor_day=None,
        anchor_date=None,
        timezone=None,
        updated_by: str = None,
    ) -> PayrollConfig:
        """Upsert the org's payroll cadence config and return the saved row."""
        cfg = PayrollConfig.query.filter_by(org_id=self.org_id).first()
        if not cfg:
            cfg = PayrollConfig(org_id=self.org_id)
            db.session.add(cfg)
        cfg.cadence = cadence
        cfg.anchor_day = anchor_day
        cfg.anchor_date = anchor_date
        cfg.timezone = timezone
        cfg.updated_by = updated_by
        db.session.commit()
        return cfg
