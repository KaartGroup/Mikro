from flask import g, request

from ...database import db, ElementAnalysisCache, SyncJob
from ...utils.tz import parse_filter_datetime


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

    # ElementAnalysisCache.week is a stored date (week start), so we
    # want pure .date() bounds here, not a TZ-aware instant.
    start_dt, _ = parse_filter_datetime(start_date_str)
    end_dt, _ = parse_filter_datetime(end_date_str)
    if start_dt is None or end_dt is None:
        return {"message": "Invalid startDate or endDate", "status": 400}

    return get_element_analysis(g.user.org_id, start_dt.date(), end_dt.date())


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


def get_element_analysis(org_id, start_date, end_date):
    """Queries ElementAnalysisCache and returns category data. No Flask context required."""
    rows = ElementAnalysisCache.query.filter(
        ElementAnalysisCache.org_id == org_id,
        ElementAnalysisCache.week >= start_date,
        ElementAnalysisCache.week <= end_date,
    ).all()

    cat_data = {}
    last_updated = None
    for row in rows:
        cat_data.setdefault(row.category, {})[row.week] = {
            "week": f"{row.week.month}/{row.week.day}",
            "added": row.added,
            "modified": row.modified,
            "deleted": row.deleted,
        }
        if last_updated is None or (row.updated_at and row.updated_at > last_updated):
            last_updated = row.updated_at

    categories = [
        {
            "title": cat_name,
            "data": [cat_data.get(cat_name, {})[k] for k in sorted(cat_data.get(cat_name, {}).keys())],
        }
        for cat_name in _ORDERED_CATEGORIES
    ]

    return {
        "status": 200,
        "categories": categories,
        "lastUpdated": last_updated.isoformat() + "Z" if last_updated else None,
    }


def _queue_analysis_job(org_id):
    """Creates a new element_analysis SyncJob, or returns the existing one if already running."""
    existing = SyncJob.query.filter(
        SyncJob.org_id == org_id,
        SyncJob.job_type == "element_analysis",
        SyncJob.status.in_(["queued", "running"]),
    ).first()
    if existing:
        return {"status": 200, "job_id": existing.id, "message": "Analysis job already in progress"}

    new_job = SyncJob(org_id=org_id, status="queued", job_type="element_analysis")
    db.session.add(new_job)
    db.session.commit()
    return {"status": 200, "job_id": new_job.id}


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
