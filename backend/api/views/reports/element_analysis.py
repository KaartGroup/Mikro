from collections import defaultdict

from flask import g, request

from ...database import db, ChangesetAdiff, SyncJob, TeamUser
from ...worker.sync_queue import SyncJobQueue
from ...utils.tz import parse_date_range
from ...utils.adiff_analyzer import TRACKED_KEYS, KEY_FILTERS, parse_adiff_transitions, merge_transitions


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

    start_date, end_date = parse_date_range(start_date_str, end_date_str)
    if start_date is None or end_date is None:
        return {"message": "Invalid startDate or endDate", "status": 400}

    team_ids = request.json.get("teamIds")
    if not team_ids:
        team_ids = [
            tu.team_id
            for tu in TeamUser.query.filter_by(user_id=g.user.id).all()
        ] or None  # None signals org-wide query when user has no team

    return get_element_analysis(g.user.org_id, team_ids, start_date, end_date)


def queue_element_analysis():
    """Reads Flask context and queues a background element analysis job."""
    if not g.user:
        return {"message": "Missing user info", "status": 304}
    return _queue_analysis_job(g.user.org_id)


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
    "Turn Restrictions", "Names", "Construction", "Classifications",
]

_CATEGORY_KEYS = {
    "Oneways": ["oneway"],
    "Highways": ["highway"],
    "Access & Barriers": ["access", "barrier"],
    "Refs": ["ref"],
    "Turn Restrictions": ["type", "restriction"],
    "Names": ["name"],
    "Construction": ["construction"],
    "Classifications": ["type"],
}

# Per-key value filters within a category: {cat_name: {key: callable(old, new) -> bool}}.
# A key with no entry here passes all transitions through.
_CATEGORY_KEY_FILTERS = {
    # "type" needs guarding because it's used for routes, boundaries, etc. too.
    # "restriction" needs no guard — that key only appears on restriction relations.
    "Turn Restrictions": {
        "type": lambda old, new: (
            (old or "").startswith("restriction") or (new or "").startswith("restriction")
        ),
    },
}


def get_element_analysis(org_id, team_ids, start_date, end_date):
    """Queries ChangesetAdiff for the given teams and date range, processes each stored adiff XML,
    and returns per-day added/modified/deleted counts grouped into categories. No Flask context required."""
    
    query = ChangesetAdiff.query.filter(
        ChangesetAdiff.org_id == org_id,
        ChangesetAdiff.created_at >= start_date,
        ChangesetAdiff.created_at <= end_date,
        ChangesetAdiff.adiff_xml.isnot(None),
    )
    if team_ids:
        query = query.filter(ChangesetAdiff.team_id.in_(team_ids))
    rows = query.order_by(ChangesetAdiff.created_at).all()

    # day -> key -> {(old_val, new_val): count}
    day_key_stats = defaultdict(lambda: {key: {} for key in TRACKED_KEYS})
    last_updated = None

    for row in rows:
        day = row.created_at.date()
        cs_stats = parse_adiff_transitions(row.adiff_xml, TRACKED_KEYS, KEY_FILTERS)
        merge_transitions(day_key_stats[day], cs_stats)
        if last_updated is None or row.created_at > last_updated:
            last_updated = row.created_at

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
        categories.append({"title": cat_name, "data": data})

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


def get_element_analysis_status(org_id):
    """Returns the status of the latest element_analysis SyncJob. No Flask context required."""
    job = (
        SyncJob.query.filter_by(org_id=org_id, job_type="element_analysis")
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
