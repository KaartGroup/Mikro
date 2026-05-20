from datetime import datetime, timedelta, timezone

from flask import g, request
from sqlalchemy import func

from ...database import db, TimeEntry, User
from ...utils.tz import parse_filter_datetime
from .helpers import resolve_member_id_filter


# ---------------------------------------------------------------------------
# Controller
# ---------------------------------------------------------------------------

def fetch_timekeeping_stats():
    """Reads Flask context and delegates to get_timekeeping_stats."""
    if not g.user:
        return {"message": "Missing user info", "status": 304}

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

    member_ids = resolve_member_id_filter(
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

    return get_timekeeping_stats(
        org_id=g.user.org_id,
        start_date=start_date,
        end_date=end_date,
        member_ids=member_ids,
        cmp_start=cmp_start,
        cmp_end=cmp_end,
    )


# ---------------------------------------------------------------------------
# Testable orchestrator
# ---------------------------------------------------------------------------

def get_timekeeping_stats(org_id, start_date, end_date, member_ids=None, cmp_start=None, cmp_end=None):
    """Assembles the full timekeeping stats response. No Flask context required."""
    weekly_category_hours, all_cats = _get_weekly_category_hours(org_id, start_date, end_date, member_ids)
    daily_category_hours, _ = _get_daily_category_hours(org_id, start_date, end_date, member_ids)
    return {
        "status": 200,
        "snapshot_timestamp": datetime.now(timezone.utc).isoformat(),
        "summary": _get_summary(org_id, start_date, end_date, member_ids),
        "hours_by_category": _get_hours_by_category(org_id, start_date, end_date, member_ids),
        "weekly_activity": _get_weekly_activity(org_id, start_date, end_date, member_ids),
        "daily_activity": _get_daily_activity(org_id, start_date, end_date, member_ids),
        "weekly_category_hours": weekly_category_hours,
        "weekly_category_names": sorted(all_cats),
        "daily_category_hours": daily_category_hours,
        "user_breakdown": _get_user_breakdown(org_id, start_date, end_date, member_ids),
        "comparison": (
            _get_comparison(org_id, cmp_start, cmp_end, member_ids)
            if cmp_start and cmp_end else None
        ),
    }


# ---------------------------------------------------------------------------
# Filter builder
# ---------------------------------------------------------------------------

def _build_filter(org_id, start_date, end_date, member_ids):
    """Build the base SQLAlchemy filter list for TimeEntry queries."""
    f = [
        TimeEntry.org_id == org_id,
        TimeEntry.status == "completed",
        TimeEntry.clock_in >= start_date,
        TimeEntry.clock_in < end_date,
    ]
    if member_ids is None:
        pass  # no user filter — all org members
    elif member_ids:
        f.append(TimeEntry.user_id.in_(member_ids))
    else:
        f.append(TimeEntry.user_id == "__no_match__")  # empty list → zero rows
    return f


# ---------------------------------------------------------------------------
# Single-purpose query helpers
# ---------------------------------------------------------------------------

def _get_summary(org_id, start_date, end_date, member_ids):
    f = _build_filter(org_id, start_date, end_date, member_ids)
    row = (
        db.session.query(
            func.sum(TimeEntry.duration_seconds).label("total_seconds"),
            func.count().label("total_entries"),
            func.sum(TimeEntry.changeset_count).label("total_changesets"),
            func.sum(TimeEntry.changes_count).label("total_changes"),
            func.count(func.distinct(TimeEntry.user_id)).label("active_users"),
        )
        .filter(*f)
        .first()
    )

    total_hours = round((row.total_seconds or 0) / 3600, 1)
    active_users = row.active_users or 0

    period_length = (end_date - start_date).days
    prior_f = _build_filter(org_id, start_date - timedelta(days=period_length), start_date, member_ids)
    prior_seconds = (
        db.session.query(func.sum(TimeEntry.duration_seconds)).filter(*prior_f).scalar() or 0
    )
    prior_hours = prior_seconds / 3600
    weekly_change = (
        round((total_hours - prior_hours) / prior_hours * 100, 1) if prior_hours > 0 else 0
    )

    return {
        "total_hours": total_hours,
        "total_entries": row.total_entries or 0,
        "total_changesets": row.total_changesets or 0,
        "total_changes": row.total_changes or 0,
        "active_users": active_users,
        "avg_hours_per_user": round(total_hours / active_users, 1) if active_users else 0,
        "weekly_rate_change_percent": weekly_change,
    }


def _get_hours_by_category(org_id, start_date, end_date, member_ids):
    f = _build_filter(org_id, start_date, end_date, member_ids)
    rows = (
        db.session.query(TimeEntry.activity, func.sum(TimeEntry.duration_seconds).label("seconds"))
        .filter(*f)
        .group_by(TimeEntry.activity)
        .all()
    )
    return [
        # JSON key "category" preserved for frontend compat (reads from
        # the renamed `activity` column underneath).
        {"category": row.activity or "other", "hours": round((row.seconds or 0) / 3600, 1)}
        for row in rows
    ]


def _get_weekly_activity(org_id, start_date, end_date, member_ids):
    f = _build_filter(org_id, start_date, end_date, member_ids)
    rows = (
        db.session.query(
            (func.date_trunc("week", TimeEntry.clock_in + timedelta(days=1)) - timedelta(days=1)).label("week"),
            func.sum(TimeEntry.duration_seconds).label("seconds"),
            func.sum(TimeEntry.changeset_count).label("changesets"),
            func.sum(TimeEntry.changes_count).label("changes"),
        )
        .filter(*f)
        .group_by("week")
        .order_by("week")
        .all()
    )
    end_date_str = end_date.strftime("%Y-%m-%d")
    result = []
    for row in rows:
        week_str = row.week.strftime("%Y-%m-%d")
        if week_str >= end_date_str:
            continue
        hours = round((row.seconds or 0) / 3600, 1)
        changesets = row.changesets or 0
        changes = row.changes or 0
        result.append({
            "week": week_str,
            "hours": hours,
            "changesets": changesets,
            "changes": changes,
            "changes_per_changeset": round(changes / changesets, 1) if changesets else 0,
            "changes_per_hour": round(changes / hours, 1) if hours else 0,
        })
    return result


def _get_daily_activity(org_id, start_date, end_date, member_ids):
    f = _build_filter(org_id, start_date, end_date, member_ids)
    rows = (
        db.session.query(
            func.date_trunc("day", TimeEntry.clock_in).label("day"),
            func.sum(TimeEntry.duration_seconds).label("seconds"),
            func.sum(TimeEntry.changeset_count).label("changesets"),
            func.sum(TimeEntry.changes_count).label("changes"),
        )
        .filter(*f)
        .group_by("day")
        .order_by("day")
        .all()
    )
    result = []
    for row in rows:
        hours = round((row.seconds or 0) / 3600, 1)
        changesets = row.changesets or 0
        changes = row.changes or 0
        result.append({
            "day": row.day.strftime("%Y-%m-%d"),
            "hours": hours,
            "changesets": changesets,
            "changes": changes,
            "changes_per_changeset": round(changes / changesets, 1) if changesets else 0,
            "changes_per_hour": round(changes / hours, 1) if hours else 0,
        })
    return result


def _get_daily_category_hours(org_id, start_date, end_date, member_ids):
    """Returns (daily_category_hours list, all_category_names set)."""
    f = _build_filter(org_id, start_date, end_date, member_ids)
    rows = (
        db.session.query(
            func.date_trunc("day", TimeEntry.clock_in).label("day"),
            TimeEntry.activity,
            func.sum(TimeEntry.duration_seconds).label("seconds"),
        )
        .filter(*f)
        .group_by("day", TimeEntry.activity)
        .order_by("day")
        .all()
    )

    daily_cat_map = {}
    all_cats = set()
    for row in rows:
        day_key = row.day.strftime("%Y-%m-%d")
        cat = row.activity or "other"
        all_cats.add(cat)
        daily_cat_map.setdefault(day_key, {"day": day_key})
        daily_cat_map[day_key][cat] = round((row.seconds or 0) / 3600, 1)

    return sorted(daily_cat_map.values(), key=lambda x: x["day"]), all_cats


def _get_user_breakdown(org_id, start_date, end_date, member_ids):
    f = _build_filter(org_id, start_date, end_date, member_ids)
    rows = (
        db.session.query(
            TimeEntry.user_id,
            func.sum(TimeEntry.duration_seconds).label("seconds"),
            func.count().label("entries"),
            func.sum(TimeEntry.changeset_count).label("changesets"),
            func.sum(TimeEntry.changes_count).label("changes"),
        )
        .filter(*f)
        .group_by(TimeEntry.user_id)
        .order_by(func.sum(TimeEntry.duration_seconds).desc())
        .all()
    )

    result = []
    for row in rows:
        user = User.query.get(row.user_id)
        if not user:
            continue
        cat_rows = (
            db.session.query(TimeEntry.activity, func.sum(TimeEntry.duration_seconds).label("seconds"))
            .filter(*f, TimeEntry.user_id == row.user_id)
            .group_by(TimeEntry.activity)
            .all()
        )
        result.append({
            "user_id": row.user_id,
            "user_name": f"{user.first_name} {user.last_name}".strip() or user.email,
            "osm_username": user.osm_username or "",
            "total_hours": round((row.seconds or 0) / 3600, 1),
            "entries_count": row.entries or 0,
            "changeset_count": row.changesets or 0,
            "changes_count": row.changes or 0,
            "category_hours": {
                cd.activity or "other": round((cd.seconds or 0) / 3600, 1)
                for cd in cat_rows
            },
        })
    return result


def _get_weekly_category_hours(org_id, start_date, end_date, member_ids):
    """Returns (weekly_category_hours list, all_category_names set)."""
    f = _build_filter(org_id, start_date, end_date, member_ids)
    rows = (
        db.session.query(
            (func.date_trunc("week", TimeEntry.clock_in + timedelta(days=1)) - timedelta(days=1)).label("week"),
            TimeEntry.activity,
            func.sum(TimeEntry.duration_seconds).label("seconds"),
        )
        .filter(*f)
        .group_by("week", TimeEntry.activity)
        .order_by("week")
        .all()
    )

    end_date_str = end_date.strftime("%Y-%m-%d")
    weekly_cat_map = {}
    all_cats = set()
    for row in rows:
        week_key = row.week.strftime("%Y-%m-%d")
        if week_key >= end_date_str:
            continue
        cat = row.activity or "other"
        all_cats.add(cat)
        weekly_cat_map.setdefault(week_key, {"week": week_key})
        weekly_cat_map[week_key][cat] = round((row.seconds or 0) / 3600, 1)

    return sorted(weekly_cat_map.values(), key=lambda x: x["week"]), all_cats


def _get_comparison(org_id, cmp_start, cmp_end, member_ids):
    f = _build_filter(org_id, cmp_start, cmp_end, member_ids)
    row = (
        db.session.query(
            func.sum(TimeEntry.duration_seconds).label("total_seconds"),
            func.count().label("total_entries"),
            func.sum(TimeEntry.changeset_count).label("total_changesets"),
            func.sum(TimeEntry.changes_count).label("total_changes"),
            func.count(func.distinct(TimeEntry.user_id)).label("active_users"),
        )
        .filter(*f)
        .first()
    )
    cmp_hours = round((row.total_seconds or 0) / 3600, 1)
    cmp_active = row.active_users or 0
    return {
        "summary": {
            "total_hours": cmp_hours,
            "total_entries": row.total_entries or 0,
            "total_changesets": row.total_changesets or 0,
            "total_changes": row.total_changes or 0,
            "active_users": cmp_active,
            "avg_hours_per_user": round(cmp_hours / cmp_active, 1) if cmp_active else 0,
        },
        "daily_activity": _get_daily_activity(org_id, cmp_start, cmp_end, member_ids),
        "weekly_activity": _get_weekly_activity(org_id, cmp_start, cmp_end, member_ids),
    }
