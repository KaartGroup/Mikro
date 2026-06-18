#!/usr/bin/env python3
"""
PaymentBalanceService — single source of truth for computing what a user is owed.

Extracted from ``api/stats.py``. No mutations; all methods are pure reads.

Usage::

    svc = PaymentBalanceService(org_id)
    balances = svc.batch_balances_fast(users)
    # or for a single user:
    bal = PaymentBalanceService.user_balances(user)
"""

from sqlalchemy import func

from ..database import Task, UserTasks, PayRequests, Payments, db


class PaymentBalanceService:
    """Read-only payment balance computation, org-scoped by construction."""

    def __init__(self, org_id: str):
        self.org_id = org_id

    # ─── Static helpers (no DB context needed beyond what's passed in) ──

    @staticmethod
    def get_claimed_task_ids(user_id) -> set:
        """Task IDs already included in a PayRequest or Payment for this user."""
        claimed = set()
        for req in PayRequests.query.filter_by(user_id=user_id).all():
            if req.task_ids:
                claimed.update(req.task_ids)
        for pay in Payments.query.filter_by(user_id=user_id).all():
            if pay.task_ids:
                claimed.update(pay.task_ids)
        return claimed

    @staticmethod
    def user_balances(user, all_org_tasks=None) -> dict:
        """Live-compute payment balances for a single user.

        Pass ``all_org_tasks`` to reuse a pre-loaded task list (batch optimisation).
        Returns ``{mapping_payable_total, validation_payable_total}``.
        """
        user_task_ids = set(
            ut.task_id for ut in UserTasks.query.filter_by(user_id=user.id).all()
        )

        if all_org_tasks is None:
            all_org_tasks = Task.query.filter_by(org_id=user.org_id).all()

        user_tasks = [t for t in all_org_tasks if t.id in user_task_ids]
        claimed = PaymentBalanceService.get_claimed_task_ids(user.id)
        osm_un = user.osm_username

        mapping_payable = sum(
            t.mapping_rate or 0
            for t in user_tasks
            if t.validated
            and not getattr(t, "self_validated", False)
            and t.id not in claimed
        )
        validation_payable = sum(
            t.validation_rate or 0
            for t in all_org_tasks
            if t.validated_by == osm_un
            and not getattr(t, "self_validated", False)
            and t.id not in claimed
            and (t.validated or t.invalidated)
        )

        return {
            "mapping_payable_total": round(mapping_payable, 2),
            "validation_payable_total": round(validation_payable, 2),
        }

    # ─── Instance methods (org-scoped batch reads) ───────────────────────

    def batch_balances(self, users) -> dict:
        """Live-compute payment balances for multiple users in one batch.

        Loads all org tasks once; avoids N+1 queries.
        Returns ``{user_id: {mapping_payable_total, validation_payable_total}}``.
        """
        all_org_tasks = Task.query.filter_by(org_id=self.org_id).all()
        user_ids = [u.id for u in users]

        all_uts = (
            UserTasks.query.filter(UserTasks.user_id.in_(user_ids)).all()
            if user_ids
            else []
        )
        ut_map = {}
        for ut in all_uts:
            ut_map.setdefault(ut.user_id, set()).add(ut.task_id)

        all_pay_requests = (
            PayRequests.query.filter(PayRequests.user_id.in_(user_ids)).all()
            if user_ids
            else []
        )
        all_payments = (
            Payments.query.filter(Payments.user_id.in_(user_ids)).all()
            if user_ids
            else []
        )

        claimed_map = {}
        for req in all_pay_requests:
            claimed_map.setdefault(req.user_id, set()).update(req.task_ids or [])
        for pay in all_payments:
            claimed_map.setdefault(pay.user_id, set()).update(pay.task_ids or [])

        result = {}
        for user in users:
            task_ids = ut_map.get(user.id, set())
            user_tasks = [t for t in all_org_tasks if t.id in task_ids]
            claimed = claimed_map.get(user.id, set())
            osm_un = user.osm_username

            mapping_payable = sum(
                t.mapping_rate or 0
                for t in user_tasks
                if t.validated
                and not getattr(t, "self_validated", False)
                and t.id not in claimed
            )
            validation_payable = sum(
                t.validation_rate or 0
                for t in all_org_tasks
                if t.validated_by == osm_un
                and not getattr(t, "self_validated", False)
                and t.id not in claimed
                and (t.validated or t.invalidated)
            )

            result[user.id] = {
                "mapping_payable_total": round(mapping_payable, 2),
                "validation_payable_total": round(validation_payable, 2),
            }

        return result

    def batch_balances_fast(self, users) -> dict:
        """SQL-aggregated payment balances for multiple users.

        Uses GROUP BY / SUM instead of loading all tasks into Python.
        Slightly less precise than ``batch_balances`` for per-user claimed
        filtering (uses a global exclusion set), but correct for list views.
        Returns ``{user_id: {mapping_payable_total, validation_payable_total}}``.
        """
        user_ids = [u.id for u in users]
        if not user_ids:
            return {}

        all_pay_requests = PayRequests.query.filter(
            PayRequests.user_id.in_(user_ids)
        ).all()
        all_payments = Payments.query.filter(Payments.user_id.in_(user_ids)).all()

        claimed_map = {}
        for req in all_pay_requests:
            claimed_map.setdefault(req.user_id, set()).update(req.task_ids or [])
        for pay in all_payments:
            claimed_map.setdefault(pay.user_id, set()).update(pay.task_ids or [])

        all_claimed = set()
        for s in claimed_map.values():
            all_claimed.update(s)

        claimed_filter = ~Task.id.in_(all_claimed) if all_claimed else True

        mapping_rows = (
            db.session.query(
                UserTasks.user_id,
                func.coalesce(func.sum(Task.mapping_rate), 0).label("payable"),
            )
            .join(Task, Task.id == UserTasks.task_id)
            .filter(
                UserTasks.user_id.in_(user_ids),
                Task.validated == True,  # noqa: E712
                Task.self_validated == False,  # noqa: E712
                claimed_filter,
            )
            .group_by(UserTasks.user_id)
            .all()
        )
        mapping_map = {row.user_id: float(row.payable) for row in mapping_rows}

        osm_usernames = [u.osm_username for u in users if u.osm_username]
        validation_map = {}
        if osm_usernames:
            validation_rows = (
                db.session.query(
                    Task.validated_by,
                    func.coalesce(func.sum(Task.validation_rate), 0).label("payable"),
                )
                .filter(
                    Task.org_id == self.org_id,
                    Task.validated_by.in_(osm_usernames),
                    Task.self_validated == False,  # noqa: E712
                    db.or_(
                        Task.validated == True, Task.invalidated == True
                    ),  # noqa: E712
                    claimed_filter,
                )
                .group_by(Task.validated_by)
                .all()
            )
            for row in validation_rows:
                validation_map[row.validated_by] = float(row.payable)

        return {
            user.id: {
                "mapping_payable_total": round(mapping_map.get(user.id, 0), 2),
                "validation_payable_total": round(
                    validation_map.get(user.osm_username, 0), 2
                ),
            }
            for user in users
        }
