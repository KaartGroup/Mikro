#!/usr/bin/env python3
"""
PaymentTxnService — pay request and payment lifecycle.

Handles creation, processing, archiving, and querying of PayRequests and
Payments records. The Flask view delegates to this class; the view retains
HTTP request parsing, auth decorators, and permission checks.

Usage::

    svc = PaymentTxnService(g.user.org_id)
    summary = svc.user_payment_summary(user)
"""

from datetime import date, datetime, timedelta, timezone

from ..database import (
    PayRequests,
    Payments,
    Project,
    Task,
    UserTasks,
)
from .payment_balance import PaymentBalanceService
from .hourly_rate_history import HourlyRateHistoryService


class PaymentTxnService:
    """Pay request → payment lifecycle, org-scoped by construction."""

    def __init__(self, org_id: str):
        self.org_id = org_id

    # ─── Reads ────────────────────────────────────────────────────────

    def user_payment_summary(self, user) -> dict:
        """Data for the admin user-profile Payment tab.

        Returns lifetime_paid, pending_balance, open_request_total,
        last_payment, hourly_rate, recent_payments (last 25), open_requests,
        and anomaly metrics for validated tasks > 30 days old not yet paid.
        """
        all_payments = (
            Payments.query.filter_by(org_id=self.org_id, user_id=user.id)
            .order_by(Payments.date_paid.desc())
            .all()
        )
        lifetime_paid = round(sum((p.amount_paid or 0) for p in all_payments), 2)
        recent_raw = all_payments[:25]

        open_requests_raw = (
            PayRequests.query.filter_by(org_id=self.org_id, user_id=user.id)
            .order_by(PayRequests.date_requested.desc())
            .all()
        )
        open_request_total = round(
            sum((r.amount_requested or 0) for r in open_requests_raw), 2
        )

        # Resolve project names for recent payments in one batched query
        all_recent_task_ids = set()
        for p in recent_raw:
            if p.task_ids:
                all_recent_task_ids.update(p.task_ids)
        task_to_project = {}
        project_id_to_name = {}
        if all_recent_task_ids:
            for t in (
                Task.query.filter(Task.id.in_(all_recent_task_ids))
                .with_entities(Task.id, Task.project_id)
                .all()
            ):
                task_to_project[t.id] = t.project_id
            project_ids = {pid for pid in task_to_project.values() if pid}
            if project_ids:
                for proj in (
                    Project.query.filter(Project.id.in_(project_ids))
                    .with_entities(Project.id, Project.name)
                    .all()
                ):
                    project_id_to_name[proj.id] = proj.name

        def _project_names_for(task_ids):
            if not task_ids:
                return []
            seen = []
            for tid in task_ids:
                pid = task_to_project.get(tid)
                if pid:
                    name = project_id_to_name.get(pid)
                    if name and name not in seen:
                        seen.append(name)
            return seen

        recent_payments = [
            {
                "id": p.id,
                "date": p.date_paid.isoformat() if p.date_paid else None,
                "amount": p.amount_paid,
                "projects": _project_names_for(p.task_ids),
                "task_count": len(p.task_ids) if p.task_ids else 0,
                "notes": p.notes or "",
            }
            for p in recent_raw
        ]

        last_payment_obj = recent_raw[0] if recent_raw else None
        last_payment = None
        if last_payment_obj:
            last_payment = {
                "date": (
                    last_payment_obj.date_paid.isoformat()
                    if last_payment_obj.date_paid
                    else None
                ),
                "amount": last_payment_obj.amount_paid,
                "payment_email": last_payment_obj.payment_email or "",
                "notes": last_payment_obj.notes or "",
            }

        open_requests = [
            {
                "id": r.id,
                "date_requested": (
                    r.date_requested.isoformat() if r.date_requested else None
                ),
                "amount_requested": r.amount_requested,
                "task_count": len(r.task_ids) if r.task_ids else 0,
                "notes": r.notes or "",
            }
            for r in open_requests_raw
        ]

        balances = PaymentBalanceService.user_balances(user)
        pending_balance = round(
            (balances.get("mapping_payable_total") or 0)
            + (balances.get("validation_payable_total") or 0),
            2,
        )

        cutoff = datetime.now(timezone.utc) - timedelta(days=30)
        claimed = PaymentBalanceService.get_claimed_task_ids(user.id)
        osm_un = user.osm_username
        user_task_ids = set(
            ut.task_id for ut in UserTasks.query.filter_by(user_id=user.id).all()
        )

        anomaly_tasks = []
        anomaly_amount = 0.0
        if osm_un and (user_task_ids or True):
            for t in Task.query.filter(
                Task.org_id == self.org_id,
                Task.validated == True,  # noqa: E712
                Task.date_validated <= cutoff,
            ).all():
                if t.id in claimed or getattr(t, "self_validated", False):
                    continue
                if t.id in user_task_ids and t.mapping_rate:
                    anomaly_tasks.append(
                        {
                            "task_id": t.id,
                            "project_id": t.project_id,
                            "date_validated": (
                                t.date_validated.isoformat()
                                if t.date_validated
                                else None
                            ),
                            "rate": t.mapping_rate,
                            "type": "mapping",
                        }
                    )
                    anomaly_amount += t.mapping_rate
                if t.validated_by == osm_un and t.validation_rate:
                    anomaly_tasks.append(
                        {
                            "task_id": t.id,
                            "project_id": t.project_id,
                            "date_validated": (
                                t.date_validated.isoformat()
                                if t.date_validated
                                else None
                            ),
                            "rate": t.validation_rate,
                            "type": "validation",
                        }
                    )
                    anomaly_amount += t.validation_rate

        anom_project_ids = {a["project_id"] for a in anomaly_tasks if a["project_id"]}
        anom_project_names = {}
        if anom_project_ids:
            for proj in (
                Project.query.filter(Project.id.in_(anom_project_ids))
                .with_entities(Project.id, Project.name)
                .all()
            ):
                anom_project_names[proj.id] = proj.name
        anomaly_list = [
            {**a, "project": anom_project_names.get(a["project_id"]) or "—"}
            for a in anomaly_tasks[:50]
        ]

        _rate_entry = HourlyRateHistoryService().get_active_rate(user.id, date.today())
        return {
            "lifetime_paid": lifetime_paid,
            "pending_balance": pending_balance,
            "open_request_total": open_request_total,
            "last_payment": last_payment,
            "hourly_rate": float(_rate_entry.rate) if _rate_entry else None,
            "recent_payments": recent_payments,
            "open_requests": open_requests,
            "anomalies": {
                "unpaid_over_30d_count": len(anomaly_tasks),
                "unpaid_over_30d_amount": round(anomaly_amount, 2),
                "tasks": anomaly_list,
            },
        }
