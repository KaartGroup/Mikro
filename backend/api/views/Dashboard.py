#!/usr/bin/env python3
from datetime import datetime, timedelta

from flask.views import MethodView
from flask import g, request
from sqlalchemy import func, case, and_

from ..utils import requires_team_admin_or_above
from ..auth import is_org_admin_or_above
from ..services.payment_balance import PaymentBalanceService
from ..services.project_service import ProjectService
from ..database import (
    db,
    Project,
    Task,
    PayRequests,
    Payments,
    UserTasks,
    User,
)


class DashboardAPI(MethodView):

    def post(self, path: str):
        if path == "fetch_admin_dash_stats":
            return self.fetch_admin_dash_stats()
        elif path == "fetch_user_dash_stats":
            return self.fetch_user_dash_stats()
        return {"message": "Not found"}, 405

    @requires_team_admin_or_above
    def fetch_admin_dash_stats(self):
        if not g:
            return {"message": "User not found", "status": 304}
        org_id = g.user.org_id

        req_body = request.json if request.json else {}
        country_id = req_body.get("country_id")

        _country_id = None
        if country_id is not None:
            try:
                _country_id = int(country_id)
            except (TypeError, ValueError):
                pass

        # For org_admin with no filters, leave visible_project_ids as None (no restriction).
        # For any country filter or team_admin scope, use the service to get the
        # correctly scoped + filtered project IDs in one shot.
        visible_project_ids = None
        if _country_id is not None or not is_org_admin_or_above(g.user):
            svc_filters = {"country_id": _country_id} if _country_id is not None else {}
            visible_project_ids = [
                p.id for p in ProjectService().get(org_id=org_id, user=g.user, filters=svc_filters)
            ]

        end_date = datetime.now()
        start_date = end_date - timedelta(days=30)

        _contrib_base = (
            UserTasks.query.with_entities(
                func.extract("week", UserTasks.timestamp).label("week"),
                func.count().label("total_contributions"),
            )
            .join(Task, Task.id == UserTasks.task_id)
            .filter(Task.org_id == org_id)
        )
        if visible_project_ids is not None:
            _contrib_base = _contrib_base.filter(Task.project_id.in_(visible_project_ids))

        weekly_contributions_this_month = (
            _contrib_base
            .filter(UserTasks.timestamp >= start_date, UserTasks.timestamp <= end_date)
            .group_by(func.extract("week", UserTasks.timestamp))
            .all()
        )

        weekly_contributions_last_month = (
            _contrib_base
            .filter(
                UserTasks.timestamp >= start_date - timedelta(days=30),
                UserTasks.timestamp <= end_date - timedelta(days=30),
            )
            .group_by(func.extract("week", UserTasks.timestamp))
            .all()
        )

        weekly_contributions_array = []
        total_contributions_this_month = 0
        total_contributions_last_month = 0
        for week, total_contributions in weekly_contributions_this_month:
            weekly_contributions_array.append(total_contributions)
            total_contributions_this_month += total_contributions

        for week, total_contributions in weekly_contributions_last_month:
            weekly_contributions_array.append(total_contributions)
            total_contributions_last_month += total_contributions

        month_contribution_change = (
            total_contributions_this_month - total_contributions_last_month
        )

        proj_counts_q = db.session.query(
            func.count(case((Project.status == True, 1))).label("active"),
            func.count(case((Project.status == False, 1))).label("inactive"),
            func.count(case((Project.completed == True, 1))).label("completed"),
        ).filter(Project.org_id == org_id)
        if visible_project_ids is not None:
            proj_counts_q = proj_counts_q.filter(Project.id.in_(visible_project_ids))
        proj_counts = proj_counts_q.first()

        active_projects_count = proj_counts.active or 0
        inactive_projects_count = proj_counts.inactive or 0
        completed_projects_count = proj_counts.completed or 0

        task_counts_q = db.session.query(
            func.count(case((and_(Task.mapped == True, Task.validated == False, Task.invalidated == False), 1))).label("mapped"),
            func.count(case((and_(Task.mapped == True, Task.validated == True), 1))).label("validated"),
            func.count(case((Task.invalidated == True, 1))).label("invalidated"),
            func.count(case((and_(Task.validated == True, Task.self_validated == True), 1))).label("self_validated"),
        ).filter(Task.org_id == org_id)
        if visible_project_ids is not None:
            task_counts_q = task_counts_q.filter(Task.project_id.in_(visible_project_ids))
        task_counts = task_counts_q.first()

        mapped_tasks_count = task_counts.mapped or 0
        validated_tasks_count = task_counts.validated or 0
        invalidated_tasks_count = task_counts.invalidated or 0
        self_validated_count = task_counts.self_validated or 0

        payable_total = db.session.query(
            func.coalesce(func.sum(User.payable_total), 0)
        ).filter(User.org_id == org_id).scalar() or 0

        requests_total = db.session.query(
            func.coalesce(func.sum(PayRequests.amount_requested), 0)
        ).filter(PayRequests.org_id == org_id).scalar() or 0

        payouts_total = db.session.query(
            func.coalesce(func.sum(Payments.amount_paid), 0)
        ).filter(Payments.org_id == org_id).scalar() or 0

        return {
            "month_contribution_change": month_contribution_change,
            "total_contributions_for_month": total_contributions_this_month,
            "weekly_contributions_array": weekly_contributions_array,
            "active_projects": active_projects_count,
            "inactive_projects": inactive_projects_count,
            "completed_projects": completed_projects_count,
            "mapped_tasks": mapped_tasks_count,
            "validated_tasks": validated_tasks_count,
            "invalidated_tasks": invalidated_tasks_count,
            "self_validated_count": self_validated_count,
            "payable_total": payable_total,
            "requests_total": requests_total,
            "payouts_total": payouts_total,
            "message": "Stats Fetched",
            "status": 200,
        }

    def fetch_user_dash_stats(self):
        if not g.user:
            return {"message": "User not found", "status": 304}
        user_id = g.user.id
        org_id = g.user.org_id
        osm_username = g.user.osm_username

        user_task_counts = db.session.query(
            func.count(case((and_(Task.mapped == True, Task.validated == False, Task.invalidated == False), 1))).label("mapped"),
            func.count(case((and_(Task.mapped == True, Task.validated == True), 1))).label("validated"),
            func.count(case((Task.invalidated == True, 1))).label("invalidated"),
        ).join(UserTasks, UserTasks.task_id == Task.id).filter(
            UserTasks.user_id == user_id
        ).first()

        user_mapped_tasks_count = user_task_counts.mapped or 0
        user_validated_tasks_count = user_task_counts.validated or 0
        user_invalidated_tasks_count = user_task_counts.invalidated or 0

        validator_validated = 0
        validator_invalidated = 0
        if osm_username:
            validator_counts = db.session.query(
                func.count(case((and_(Task.validated == True, Task.self_validated == False), 1))).label("validated"),
                func.count(case((Task.invalidated == True, 1))).label("invalidated"),
            ).filter(
                Task.org_id == org_id,
                Task.validated_by == osm_username,
            ).first()
            validator_validated = validator_counts.validated or 0
            validator_invalidated = validator_counts.invalidated or 0

        _pay = PaymentBalanceService.user_balances(g.user)
        payable_total = _pay["mapping_payable_total"] or 0

        requests_total = db.session.query(
            func.coalesce(func.sum(PayRequests.amount_requested), 0)
        ).filter(PayRequests.org_id == org_id, PayRequests.user_id == user_id).scalar() or 0

        payouts_total = db.session.query(
            func.coalesce(func.sum(Payments.amount_paid), 0)
        ).filter(Payments.org_id == org_id, Payments.user_id == user_id).scalar() or 0

        end_date = datetime.now()
        start_date = end_date - timedelta(days=30)

        _contrib_base = (
            UserTasks.query.with_entities(
                func.extract("week", UserTasks.timestamp).label("week"),
                func.count().label("total_contributions"),
            )
            .join(Task, Task.id == UserTasks.task_id)
            .filter(UserTasks.user_id == user_id, Task.org_id == org_id)
        )

        weekly_contributions_this_month = (
            _contrib_base
            .filter(UserTasks.timestamp >= start_date, UserTasks.timestamp <= end_date)
            .group_by(func.extract("week", UserTasks.timestamp))
            .all()
        )

        weekly_contributions_last_month = (
            _contrib_base
            .filter(
                UserTasks.timestamp >= start_date - timedelta(days=30),
                UserTasks.timestamp <= end_date - timedelta(days=30),
            )
            .group_by(func.extract("week", UserTasks.timestamp))
            .all()
        )

        weekly_contributions_array = []
        total_contributions_this_month = 0
        total_contributions_last_month = 0
        for week, total_contributions in weekly_contributions_this_month:
            weekly_contributions_array.append(total_contributions)
            total_contributions_this_month += total_contributions

        for week, total_contributions in weekly_contributions_last_month:
            weekly_contributions_array.append(total_contributions)
            total_contributions_last_month += total_contributions

        month_contribution_change = (
            total_contributions_this_month - total_contributions_last_month
        )

        return {
            "month_contribution_change": month_contribution_change,
            "total_contributions_for_month": total_contributions_this_month,
            "weekly_contributions_array": weekly_contributions_array,
            "mapped_tasks": user_mapped_tasks_count,
            "validated_tasks": user_validated_tasks_count,
            "invalidated_tasks": user_invalidated_tasks_count,
            "validator_validated": validator_validated,
            "validator_invalidated": validator_invalidated,
            "mapping_payable_total": _pay["mapping_payable_total"],
            "validation_payable_total": _pay["validation_payable_total"],
            "payable_total": payable_total,
            "requests_total": float(requests_total),
            "payouts_total": float(payouts_total),
            "message": "Stats Fetched",
            "status": 200,
        }
