#!/usr/bin/env python3
from flask.views import MethodView
from flask import g, request
from sqlalchemy import func, case, and_

from ..utils import requires_team_admin_or_above
from ..utils.tz import org_month_compare_bounds_utc
from ..auth import is_org_admin_or_above
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
                p.id
                for p in ProjectService().get(
                    org_id=org_id, user=g.user, filters=svc_filters
                )
            ]

        # Calendar-month windows anchored to Grand Junction. The headline counts
        # this month so far (incl. today); the change compares this month's
        # completed days against the same number of completed days last month,
        # so a partial month isn't measured against a complete one.
        (
            month_start,
            today_start,
            prev_month_start,
            prev_month_compare_end,
        ) = org_month_compare_bounds_utc()

        _contrib_base = UserTasks.query.join(Task, Task.id == UserTasks.task_id).filter(
            Task.org_id == org_id
        )
        if visible_project_ids is not None:
            _contrib_base = _contrib_base.filter(
                Task.project_id.in_(visible_project_ids)
            )

        def _count_contribs(start_dt, end_dt=None):
            q = _contrib_base.filter(UserTasks.timestamp >= start_dt)
            if end_dt is not None:
                q = q.filter(UserTasks.timestamp < end_dt)
            return q.count()

        total_contributions_this_month = _count_contribs(month_start)
        month_contribution_change = _count_contribs(
            month_start, today_start
        ) - _count_contribs(prev_month_start, prev_month_compare_end)

        proj_counts_q = db.session.query(
            func.count(case((Project.status == True, 1))).label("active"),
            func.count(case((Project.status == False, 1))).label("inactive"),
        ).filter(Project.org_id == org_id)
        if visible_project_ids is not None:
            proj_counts_q = proj_counts_q.filter(Project.id.in_(visible_project_ids))
        proj_counts = proj_counts_q.first()

        active_projects_count = proj_counts.active or 0
        inactive_projects_count = proj_counts.inactive or 0
        completed_projects_count = 0

        task_counts_q = db.session.query(
            func.count(
                case(
                    (
                        and_(
                            Task.mapped == True,
                            Task.validated == False,
                            Task.invalidated == False,
                        ),
                        1,
                    )
                )
            ).label("mapped"),
            func.count(
                case((and_(Task.mapped == True, Task.validated == True), 1))
            ).label("validated"),
            func.count(case((Task.invalidated == True, 1))).label("invalidated"),
            func.count(
                case((and_(Task.validated == True, Task.self_validated == True), 1))
            ).label("self_validated"),
        ).filter(Task.org_id == org_id)
        if visible_project_ids is not None:
            task_counts_q = task_counts_q.filter(
                Task.project_id.in_(visible_project_ids)
            )
        task_counts = task_counts_q.first()

        mapped_tasks_count = task_counts.mapped or 0
        validated_tasks_count = task_counts.validated or 0
        invalidated_tasks_count = task_counts.invalidated or 0
        self_validated_count = task_counts.self_validated or 0

        payable_total = (
            db.session.query(func.coalesce(func.sum(User.payable_total), 0))
            .filter(User.org_id == org_id)
            .scalar()
            or 0
        )

        requests_total = (
            db.session.query(func.coalesce(func.sum(PayRequests.amount_requested), 0))
            .filter(PayRequests.org_id == org_id)
            .scalar()
            or 0
        )

        payouts_total = (
            db.session.query(func.coalesce(func.sum(Payments.amount_paid), 0))
            .filter(Payments.org_id == org_id)
            .scalar()
            or 0
        )

        return {
            "month_contribution_change": month_contribution_change,
            "total_contributions_for_month": total_contributions_this_month,
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
