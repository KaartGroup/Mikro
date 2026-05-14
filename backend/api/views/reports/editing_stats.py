import logging
from datetime import datetime, timedelta, timezone

from flask import g, request
from sqlalchemy import func

from ...database import db, Task, Project, User, TimeEntry
from ...stats import get_batch_project_stats
from ...utils.tz import parse_filter_datetime
from .helpers import resolve_osm_username_filter

logger = logging.getLogger(__name__)

_MR_STATUS_KEYS = {1: "fixed", 2: "false_positive", 3: "skipped", 5: "already_fixed", 6: "cant_complete"}


# ---------------------------------------------------------------------------
# Controller
# ---------------------------------------------------------------------------

def fetch_editing_stats(source=None):
    """Reads Flask context and delegates to get_editing_stats."""
    if not g.user:
        return {"message": "Missing user info", "status": 304}

    if source is None:
        source = request.json.get("source", "tm4")

    start_date_str = request.json.get("startDate")
    end_date_str = request.json.get("endDate")
    if not start_date_str or not end_date_str:
        return {"message": "startDate and endDate required", "status": 400}

    start_date, _ = parse_filter_datetime(start_date_str)
    end_date, end_was_date_only = parse_filter_datetime(end_date_str)
    if start_date is None or end_date is None:
        return {"message": "Invalid startDate or endDate", "status": 400}
    if end_was_date_only:
        end_date = end_date + timedelta(days=1)

    osm_usernames = resolve_osm_username_filter(
        org_id=g.user.org_id,
        viewer=g.user,
        filters=request.json.get("filters"),
        user_id=request.json.get("userId"),
        team_id=request.json.get("teamId"),
    )

    cmp_start = cmp_end = None
    compare_start_str = request.json.get("compareStartDate")
    compare_end_str = request.json.get("compareEndDate")
    if compare_start_str and compare_end_str:
        cmp_start, _ = parse_filter_datetime(compare_start_str)
        cmp_end, cmp_end_was_date_only = parse_filter_datetime(compare_end_str)
        if cmp_start is None or cmp_end is None:
            return {"message": "Invalid compareStartDate or compareEndDate", "status": 400}
        if cmp_end_was_date_only:
            cmp_end = cmp_end + timedelta(days=1)

    return get_editing_stats(
        org_id=g.user.org_id,
        source=source,
        start_date=start_date,
        end_date=end_date,
        osm_usernames=osm_usernames,
        cmp_start=cmp_start,
        cmp_end=cmp_end,
    )


# ---------------------------------------------------------------------------
# Testable orchestrator
# ---------------------------------------------------------------------------

def get_editing_stats(org_id, source, start_date, end_date, osm_usernames, cmp_start=None, cmp_end=None):
    """Assembles the full editing stats response. No Flask context required."""
    return {
        "status": 200,
        "snapshot_timestamp": datetime.now(timezone.utc).isoformat(),
        "summary": _get_summary(org_id, source, start_date, end_date, osm_usernames),
        "tasks_over_time": _get_tasks_over_time(org_id, source, start_date, end_date, osm_usernames),
        "tasks_over_time_daily": _get_tasks_over_time_daily(org_id, source, start_date, end_date, osm_usernames),
        "mr_status_over_time": (
            _get_mr_status_over_time(org_id, start_date, end_date, osm_usernames)
            if source == "mr" else None
        ),
        "mr_status_over_time_daily": (
            _get_mr_status_over_time_daily(org_id, start_date, end_date, osm_usernames)
            if source == "mr" else None
        ),
        "projects": _get_projects_list(org_id, source),
        "top_contributors": _get_top_contributors(org_id, source, start_date, end_date, osm_usernames),
        "comparison": (
            _get_comparison(org_id, source, cmp_start, cmp_end, osm_usernames)
            if cmp_start and cmp_end else None
        ),
    }


# ---------------------------------------------------------------------------
# Single-purpose query helpers
# ---------------------------------------------------------------------------

def _get_summary(org_id, source, start_date, end_date, osm_usernames):
    def _count(flag_col, date_col, user_col):
        q = Task.query.filter(
            Task.org_id == org_id, Task.source == source,
            flag_col == True, date_col >= start_date, date_col < end_date,
        )
        if osm_usernames:
            q = q.filter(user_col.in_(osm_usernames))
        return q.count()

    return {
        "total_mapped": _count(Task.mapped, Task.date_mapped, Task.mapped_by),
        "total_validated": _count(Task.validated, Task.date_validated, Task.validated_by),
        "total_invalidated": _count(Task.invalidated, Task.date_validated, Task.validated_by),
        "active_projects": Project.query.filter_by(
            org_id=org_id, source=source, status=True, completed=False
        ).count(),
        "completed_projects": Project.query.filter_by(
            org_id=org_id, source=source, completed=True
        ).count(),
        "mr_status_summary": (
            _get_mr_status_summary(org_id, start_date, end_date, osm_usernames)
            if source == "mr" else None
        ),
    }


def _get_mr_status_summary(org_id, start_date, end_date, osm_usernames):
    q = (
        db.session.query(Task.mr_status, func.count())
        .filter(
            Task.org_id == org_id, Task.source == "mr",
            Task.mapped == True,
            Task.date_mapped >= start_date, Task.date_mapped < end_date,
        )
    )
    if osm_usernames:
        q = q.filter(Task.mapped_by.in_(osm_usernames))
    return {row[0]: row[1] for row in q.group_by(Task.mr_status).all() if row[0] is not None}


def _get_tasks_over_time(org_id, source, start_date, end_date, osm_usernames):
    def _weekly(date_col, user_col, flag_col):
        q = (
            db.session.query(
                func.date_trunc("week", date_col).label("week"),
                func.count().label("count"),
            )
            .filter(
                Task.org_id == org_id, Task.source == source,
                flag_col == True, date_col >= start_date, date_col < end_date,
            )
        )
        if osm_usernames:
            q = q.filter(user_col.in_(osm_usernames))
        return q.group_by("week").all()

    weeks = {}
    for row in _weekly(Task.date_mapped, Task.mapped_by, Task.mapped):
        key = row.week.strftime("%Y-%m-%d")
        weeks.setdefault(key, {"week": key, "mapped": 0, "validated": 0, "invalidated": 0})
        weeks[key]["mapped"] = row.count
    for row in _weekly(Task.date_validated, Task.validated_by, Task.validated):
        key = row.week.strftime("%Y-%m-%d")
        weeks.setdefault(key, {"week": key, "mapped": 0, "validated": 0, "invalidated": 0})
        weeks[key]["validated"] = row.count
    for row in _weekly(Task.date_validated, Task.validated_by, Task.invalidated):
        key = row.week.strftime("%Y-%m-%d")
        weeks.setdefault(key, {"week": key, "mapped": 0, "validated": 0, "invalidated": 0})
        weeks[key]["invalidated"] = row.count

    return sorted(weeks.values(), key=lambda x: x["week"])


def _get_mr_status_over_time(org_id, start_date, end_date, osm_usernames):
    q = (
        db.session.query(
            func.date_trunc("week", Task.date_mapped).label("week"),
            Task.mr_status,
            func.count().label("count"),
        )
        .filter(
            Task.org_id == org_id, Task.source == "mr",
            Task.mapped == True, Task.mr_status != None,
            Task.date_mapped >= start_date, Task.date_mapped < end_date,
        )
    )
    if osm_usernames:
        q = q.filter(Task.mapped_by.in_(osm_usernames))

    weeks_mr = {}
    for row in q.group_by("week", Task.mr_status).all():
        key = row.week.strftime("%Y-%m-%d")
        weeks_mr.setdefault(
            key,
            {"week": key, "fixed": 0, "already_fixed": 0, "false_positive": 0, "skipped": 0, "cant_complete": 0},
        )
        status_key = _MR_STATUS_KEYS.get(row.mr_status)
        if status_key:
            weeks_mr[key][status_key] = row.count

    return sorted(weeks_mr.values(), key=lambda x: x["week"])


def _get_tasks_over_time_daily(org_id, source, start_date, end_date, osm_usernames):
    def _daily(date_col, user_col, flag_col):
        q = (
            db.session.query(
                func.date_trunc("day", date_col).label("day"),
                func.count().label("count"),
            )
            .filter(
                Task.org_id == org_id, Task.source == source,
                flag_col == True, date_col >= start_date, date_col < end_date,
            )
        )
        if osm_usernames:
            q = q.filter(user_col.in_(osm_usernames))
        return q.group_by("day").all()

    days = {}
    for row in _daily(Task.date_mapped, Task.mapped_by, Task.mapped):
        key = row.day.strftime("%Y-%m-%d")
        days.setdefault(key, {"day": key, "mapped": 0, "validated": 0, "invalidated": 0})
        days[key]["mapped"] = row.count
    for row in _daily(Task.date_validated, Task.validated_by, Task.validated):
        key = row.day.strftime("%Y-%m-%d")
        days.setdefault(key, {"day": key, "mapped": 0, "validated": 0, "invalidated": 0})
        days[key]["validated"] = row.count
    for row in _daily(Task.date_validated, Task.validated_by, Task.invalidated):
        key = row.day.strftime("%Y-%m-%d")
        days.setdefault(key, {"day": key, "mapped": 0, "validated": 0, "invalidated": 0})
        days[key]["invalidated"] = row.count

    return sorted(days.values(), key=lambda x: x["day"])


def _get_mr_status_over_time_daily(org_id, start_date, end_date, osm_usernames):
    q = (
        db.session.query(
            func.date_trunc("day", Task.date_mapped).label("day"),
            Task.mr_status,
            func.count().label("count"),
        )
        .filter(
            Task.org_id == org_id, Task.source == "mr",
            Task.mapped == True, Task.mr_status != None,
            Task.date_mapped >= start_date, Task.date_mapped < end_date,
        )
    )
    if osm_usernames:
        q = q.filter(Task.mapped_by.in_(osm_usernames))

    days_mr = {}
    for row in q.group_by("day", Task.mr_status).all():
        key = row.day.strftime("%Y-%m-%d")
        days_mr.setdefault(
            key,
            {"day": key, "fixed": 0, "already_fixed": 0, "false_positive": 0, "skipped": 0, "cant_complete": 0},
        )
        status_key = _MR_STATUS_KEYS.get(row.mr_status)
        if status_key:
            days_mr[key][status_key] = row.count

    return sorted(days_mr.values(), key=lambda x: x["day"])


def _get_time_per_project(org_id):
    rows = (
        db.session.query(TimeEntry.project_id, func.sum(TimeEntry.duration_seconds))
        .filter(
            TimeEntry.org_id == org_id,
            TimeEntry.status == "completed",
            TimeEntry.project_id != None,
            TimeEntry.duration_seconds != None,
        )
        .group_by(TimeEntry.project_id)
        .all()
    )
    return {proj_id: secs for proj_id, secs in rows if proj_id and secs}


def _get_projects_list(org_id, source):
    time_per_project = _get_time_per_project(org_id)
    org_projects = Project.query.filter_by(org_id=org_id, source=source).all()
    proj_stats = get_batch_project_stats([p.id for p in org_projects])

    result = []
    for proj in org_projects:
        ps = proj_stats.get(proj.id, {})
        total = proj.total_tasks or 0
        mapped = ps.get("tasks_mapped", 0)
        validated = ps.get("tasks_validated", 0)
        invalidated = ps.get("tasks_invalidated", 0)

        if source == "mr":
            mr_completed = Task.query.filter_by(project_id=proj.id, mapped=True).count()
            raw_pct_mapped = round(mr_completed / total * 100, 1) if total else 0
            raw_pct_validated = 0
        else:
            effective_total = total - (proj.tasks_overlap or 0)
            raw_pct_mapped = round(mapped / effective_total * 100, 1) if effective_total > 0 else 0
            raw_pct_validated = round(validated / effective_total * 100, 1) if effective_total > 0 else 0

        if raw_pct_mapped > 100:
            logger.warning(
                f"Project {proj.id} ({proj.name}) percent_mapped={raw_pct_mapped}% "
                f"exceeds 100% — capping. total_tasks={total}, mapped={mapped}"
            )
        if raw_pct_validated > 100:
            logger.warning(
                f"Project {proj.id} ({proj.name}) percent_validated={raw_pct_validated}% "
                f"exceeds 100% — capping. total_tasks={total}, validated={validated}"
            )

        completed_tasks = mapped + validated
        total_secs = time_per_project.get(proj.id, 0)
        proj_dict = {
            "id": proj.id,
            "name": proj.name,
            "url": proj.url or "",
            "source": proj.source,
            "total_tasks": total,
            "tasks_mapped": mapped,
            "tasks_validated": validated,
            "tasks_invalidated": invalidated,
            "percent_mapped": min(raw_pct_mapped, 100),
            "percent_validated": min(raw_pct_validated, 100),
            "mapping_rate": proj.mapping_rate_per_task or 0,
            "validation_rate": proj.validation_rate_per_task or 0,
            "status": proj.status,
            "difficulty": proj.difficulty or "Unknown",
            "avg_time_per_task": (
                round(total_secs / completed_tasks) if completed_tasks > 0 and total_secs > 0 else None
            ),
        }

        if source == "mr":
            rows = (
                db.session.query(Task.mr_status, func.count())
                .filter(Task.project_id == proj.id, Task.mr_status != None)
                .group_by(Task.mr_status)
                .all()
            )
            proj_dict["mr_status_breakdown"] = {s: c for s, c in rows if s is not None}

        result.append(proj_dict)

    return result


def _get_top_contributors(org_id, source, start_date, end_date, osm_usernames):
    contrib_q = (
        db.session.query(Task.mapped_by, func.count().label("mapped_count"))
        .filter(
            Task.org_id == org_id, Task.source == source,
            Task.mapped == True,
            Task.date_mapped >= start_date, Task.date_mapped < end_date,
            Task.mapped_by != None,
        )
    )
    if osm_usernames:
        contrib_q = contrib_q.filter(Task.mapped_by.in_(osm_usernames))
    rows = contrib_q.group_by(Task.mapped_by).order_by(func.count().desc()).limit(20).all()

    contributors = []
    for row in rows:
        osm_un = row.mapped_by
        user = User.query.filter_by(osm_username=osm_un, org_id=org_id).first()

        val_count = Task.query.filter(
            Task.org_id == org_id, Task.source == source,
            Task.validated_by == osm_un, Task.validated == True,
            Task.date_validated >= start_date, Task.date_validated < end_date,
        ).count()

        inv_count = Task.query.filter(
            Task.org_id == org_id, Task.source == source,
            Task.validated_by == osm_un, Task.invalidated == True,
            Task.date_validated >= start_date, Task.date_validated < end_date,
        ).count()

        hours = 0.0
        if user:
            result = (
                db.session.query(func.sum(TimeEntry.duration_seconds))
                .filter(
                    TimeEntry.user_id == user.id,
                    TimeEntry.status == "completed",
                    TimeEntry.clock_in >= start_date,
                    TimeEntry.clock_in < end_date,
                )
                .scalar()
            )
            hours = round((result or 0) / 3600, 1)

        entry = {
            "user_id": user.id if user else None,
            "user_name": f"{user.first_name} {user.last_name}".strip() if user else osm_un,
            "osm_username": osm_un,
            "tasks_mapped": row.mapped_count,
            "tasks_validated": val_count,
            "tasks_invalidated": inv_count,
            "total_hours": hours,
        }

        if source == "mr":
            mr_rows = (
                db.session.query(Task.mr_status, func.count())
                .filter(
                    Task.org_id == org_id, Task.source == "mr",
                    Task.mapped_by == osm_un, Task.mr_status != None,
                    Task.date_mapped >= start_date, Task.date_mapped < end_date,
                )
                .group_by(Task.mr_status)
                .all()
            )
            entry["mr_status_breakdown"] = {s: c for s, c in mr_rows if s is not None}

        contributors.append(entry)

    return contributors


def _get_comparison(org_id, source, cmp_start, cmp_end, osm_usernames):
    def _count(flag_col, date_col, user_col):
        q = Task.query.filter(
            Task.org_id == org_id, Task.source == source,
            flag_col == True, date_col >= cmp_start, date_col < cmp_end,
        )
        if osm_usernames:
            q = q.filter(user_col.in_(osm_usernames))
        return q.count()

    return {
        "summary": {
            "total_mapped": _count(Task.mapped, Task.date_mapped, Task.mapped_by),
            "total_validated": _count(Task.validated, Task.date_validated, Task.validated_by),
            "total_invalidated": _count(Task.invalidated, Task.date_validated, Task.validated_by),
        },
        "tasks_over_time": _get_tasks_over_time(org_id, source, cmp_start, cmp_end, osm_usernames),
        "tasks_over_time_daily": _get_tasks_over_time_daily(org_id, source, cmp_start, cmp_end, osm_usernames),
    }
