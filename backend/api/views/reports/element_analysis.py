import logging
from collections import defaultdict

from datetime import timezone

from flask import g, request

from ...database import db, ChangesetAdiff, SyncJob, TeamUser
from ...worker.sync_queue import SyncJobQueue
from ...utils.tz import parse_filter_datetime, ORG_TIMEZONE
from ...utils.adiff_analyzer import TRACKED_KEYS, KEY_FILTERS, parse_adiff_transitions, merge_transitions

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Controllers
# ---------------------------------------------------------------------------

def fetch_element_analysis():
    """Reads Flask context and delegates to get_element_analysis."""
    if not g.user:
        return {"message": "Missing user info", "status": 304}

    start_date_str = request.json.get("startDate")
    end_date_str = request.json.get("endDate")
    if not start_date_str or not end_date_str:
        return {"message": "startDate and endDate required", "status": 400}

    start_dt, _ = parse_filter_datetime(start_date_str)
    end_dt, _ = parse_filter_datetime(end_date_str)
    if start_dt is None or end_dt is None:
        return {"message": "Invalid startDate or endDate", "status": 400}

    logger.debug(
        "element_analysis request: raw startDate=%s endDate=%s | parsed start_dt=%s end_dt=%s",
        start_date_str, end_date_str, start_dt, end_dt,
    )

    team_ids = request.json.get("teamIds")
    if not team_ids:
        team_ids = [
            tu.team_id
            for tu in TeamUser.query.filter_by(user_id=g.user.id).all()
        ] or None  # None signals org-wide query when user has no team

    logger.debug(
        "element_analysis request: org_id=%s team_ids=%s",
        g.user.org_id, team_ids,
    )

    return get_element_analysis(g.user.org_id, team_ids, start_dt, end_dt)


def queue_element_analysis():
    """Reads Flask context and queues a background element analysis job."""
    if not g.user:
        return {"message": "Missing user info", "status": 304}
    return _queue_analysis_job(g.user.org_id)


def queue_element_analysis_backfill():
    """Reads Flask context and queues a backfill element analysis job."""
    if not g.user:
        return {"message": "Missing user info", "status": 304}
    job, created = SyncJobQueue.enqueue_element_analysis_backfill(g.user.org_id)
    msg = "Backfill job queued" if created else "Backfill job already in progress"
    return {"status": 200, "job_id": job.id, "message": msg}


def check_element_analysis_backfill_status():
    """Reads Flask context and returns status of the latest backfill job."""
    if not g.user:
        return {"message": "Missing user info", "status": 304}
    return get_element_analysis_status(g.user.org_id, job_type="element_analysis_backfill")


def check_element_analysis_status():
    """Reads Flask context and delegates to get_element_analysis_status."""
    if not g.user:
        return {"message": "Missing user info", "status": 304}
    return get_element_analysis_status(g.user.org_id)


# ---------------------------------------------------------------------------
# Testable functions
# ---------------------------------------------------------------------------

_ORDERED_CATEGORIES = [
    "Oneways", "Access & Barriers", "Highways", "Refs",
    "Turn Restrictions", "Names", "Construction",
]

_CATEGORY_KEYS = {
    "Oneways": ["oneway"],
    "Highways": ["highway"],
    "Access & Barriers": ["access", "barrier"],
    "Refs": ["ref"],
    "Turn Restrictions": ["restriction"],
    "Names": ["name"],
    "Construction": ["construction"],
}

# Per-key value filters within a category: {cat_name: {key: callable(old, new) -> bool}}.
# A key with no entry here passes all transitions through.
_CATEGORY_KEY_FILTERS = {}

_HPR_CORE = {"motorway", "trunk", "primary", "secondary", "tertiary"}
_HPR_LINKS = {"motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link"}
_HPR_RANK = {"motorway": 1, "trunk": 2, "primary": 3, "secondary": 4, "tertiary": 5}


def _classify_hpr_transition(old_val, new_val):
    """Returns 'upgrade', 'downgrade', 'links', 'construction', or None."""
    if old_val in _HPR_LINKS or new_val in _HPR_LINKS:
        return "links"
    if (old_val in _HPR_CORE and new_val == "construction") or \
       (old_val == "construction" and new_val in _HPR_CORE):
        return "construction"
    if old_val is None or new_val is None:
        return None
    old_rank = _HPR_RANK.get(old_val, 999)
    new_rank = _HPR_RANK.get(new_val, 999)
    if old_rank == 999 and new_rank == 999:
        return None
    if new_rank < old_rank:
        return "upgraded"
    if new_rank > old_rank:
        return "downgraded"
    return None


def build_hpr_category_data(day_key_stats):
    """Builds the High Priority Roads category with upgrade/downgrade/links/construction counts."""
    all_days = sorted(day_key_stats.keys())
    data = []
    for day in all_days:
        counts = {"upgraded": 0, "downgraded": 0, "links": 0, "construction": 0}
        for (old_val, new_val), count in day_key_stats[day]["highway"].items():
            bucket = _classify_hpr_transition(old_val, new_val)
            if bucket:
                counts[bucket] += count
        data.append({"day": day.strftime("%Y-%m-%d"), **counts})
    return {"title": "High Priority Roads", "type": "hpr", "data": data}


def build_category_data(day_key_stats):
    """Pure function: day_key_stats -> list of category dicts with per-day add/modify/delete counts.

    day_key_stats: {date: {key: {(old_val, new_val): count}}}
    Returns the same structure used in the 'categories' field of get_element_analysis.
    """
    all_days = sorted(day_key_stats.keys())
    categories = []
    for cat_name in _ORDERED_CATEGORIES:
        keys = _CATEGORY_KEYS.get(cat_name, [])
        cat_key_filters = _CATEGORY_KEY_FILTERS.get(cat_name, {})
        data = []
        for day in all_days:
            added = modified = deleted = 0
            for key in keys:
                key_filter = cat_key_filters.get(key)
                for (old_val, new_val), count in day_key_stats[day][key].items():
                    if key_filter and not key_filter(old_val, new_val):
                        continue
                    if old_val is None:
                        added += count
                    elif new_val is None:
                        deleted += count
                    else:
                        modified += count
            data.append({
                "day": day.strftime("%Y-%m-%d"),
                "added": added,
                "modified": modified,
                "deleted": deleted,
            })
        categories.append({"title": cat_name, "type": "standard", "data": data})
    return categories


def get_element_analysis(org_id, team_ids, start_date, end_date):
    """Queries ChangesetAdiff for the given teams and date range, processes each stored adiff XML,
    and returns per-day added/modified/deleted counts grouped into categories. No Flask context required."""

    logger.debug(
        "get_element_analysis: org_id=%s team_ids=%s start_date=%s end_date=%s",
        org_id, team_ids, start_date, end_date,
    )

    query = ChangesetAdiff.query.filter(
        ChangesetAdiff.org_id == org_id,
        ChangesetAdiff.created_at >= start_date,
        ChangesetAdiff.created_at < end_date,
        ChangesetAdiff.adiff_xml.isnot(None),
    )
    if team_ids:
        query = query.filter(ChangesetAdiff.team_id.in_(team_ids))
    rows = query.order_by(ChangesetAdiff.created_at).all()

    logger.debug(
        "get_element_analysis: found %d changeset rows in window [%s, %s)",
        len(rows), start_date, end_date,
    )
    if rows:
        logger.debug(
            "get_element_analysis: earliest created_at=%s  latest created_at=%s",
            rows[0].created_at, rows[-1].created_at,
        )

    # day -> key -> {(old_val, new_val): count}
    day_key_stats = defaultdict(lambda: {key: {} for key in TRACKED_KEYS})
    last_updated = None

    for row in rows:
        day = row.created_at.replace(tzinfo=timezone.utc).astimezone(ORG_TIMEZONE).date()
        logger.debug(
            "get_element_analysis: processing changeset_id=%s created_at=%s -> local day=%s",
            row.changeset_id, row.created_at, day,
        )
        cs_stats = parse_adiff_transitions(row.adiff_xml, TRACKED_KEYS, KEY_FILTERS)
        merge_transitions(day_key_stats[day], cs_stats)
        if last_updated is None or row.created_at > last_updated:
            last_updated = row.created_at

    standard = build_category_data(day_key_stats)
    hpr = build_hpr_category_data(day_key_stats)
    categories = []
    for cat in standard:
        categories.append(cat)
        if cat["title"] == "Highways":
            categories.append(hpr)

    return {
        "status": 200,
        "categories": categories,
        "lastUpdated": last_updated.isoformat() + "Z" if last_updated else None,
    }


def _queue_analysis_job(org_id):
    """Creates a new element_analysis SyncJob, or returns the existing one if already queued."""
    job, created = SyncJobQueue.enqueue_element_analysis(org_id)
    msg = "Analysis job queued" if created else "Analysis job already in progress"
    return {"status": 200, "job_id": job.id, "message": msg}


def get_element_analysis_status(org_id, job_type="element_analysis"):
    """Returns the status of the latest SyncJob of the given type. No Flask context required."""
    job = (
        SyncJob.query.filter_by(org_id=org_id, job_type=job_type)
        .order_by(SyncJob.id.desc())
        .first()
    )
    if not job:
        return {"status": 200, "message": "No analysis jobs found"}

    return {
        "status": 200,
        "job_id": job.id,
        "sync_status": job.status,
        "progress": job.progress,
        "started_at": job.started_at.isoformat() + "Z" if job.started_at else None,
        "completed_at": job.completed_at.isoformat() + "Z" if job.completed_at else None,
        "error": job.error,
    }
