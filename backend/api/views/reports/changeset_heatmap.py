import logging
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import timedelta

import requests as http_requests
from flask import g, request

from ...database import db, Task
from ...filters import resolve_filtered_osm_usernames
from ...utils.tz import parse_filter_datetime
from .helpers import _team_admin_osm_usernames

logger = logging.getLogger(__name__)

_EMPTY_RESPONSE = {
    "status": 200,
    "heatmapPoints": [],
    "summary": {"totalChangesets": 0, "totalChanges": 0, "usersWithData": 0},
}


# ---------------------------------------------------------------------------
# Controller
# ---------------------------------------------------------------------------

def fetch_changeset_heatmap():
    """Reads Flask context and delegates to get_changeset_heatmap."""
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

    return get_changeset_heatmap(
        org_id=g.user.org_id,
        viewer=g.user,
        start_date=start_date,
        end_date=end_date,
        start_date_str=start_date_str,
        end_date_str=end_date_str,
        filters=request.json.get("filters"),
    )


# ---------------------------------------------------------------------------
# Testable orchestrator
# ---------------------------------------------------------------------------

def get_changeset_heatmap(org_id, viewer, start_date, end_date, start_date_str, end_date_str, filters=None):
    """Fetches and aggregates OSM changeset heatmap data. No Flask context required."""
    osm_usernames = _get_active_mapper_usernames(org_id, viewer, start_date, end_date, filters)
    if not osm_usernames:
        return _EMPTY_RESPONSE

    results = _fetch_all_user_changesets(osm_usernames, start_date_str, end_date_str)

    all_points = []
    total_changesets = 0
    total_changes = 0
    users_with_data = 0
    for _username, points, cs_count, changes in results:
        if points:
            all_points.extend(points)
            users_with_data += 1
        total_changesets += cs_count
        total_changes += changes

    return {
        "status": 200,
        "heatmapPoints": all_points,
        "summary": {
            "totalChangesets": total_changesets,
            "totalChanges": total_changes,
            "usersWithData": users_with_data,
        },
    }


# ---------------------------------------------------------------------------
# Single-purpose helpers
# ---------------------------------------------------------------------------

def _get_active_mapper_usernames(org_id, viewer, start_date, end_date, filters=None):
    """Returns list of OSM usernames active in the period, scoped to viewer permissions."""
    q = (
        db.session.query(Task.mapped_by)
        .filter(
            Task.org_id == org_id,
            Task.mapped == True,
            Task.date_mapped >= start_date,
            Task.date_mapped < end_date,
            Task.mapped_by != None,
        )
        .distinct()
    )

    if filters:
        filtered_usernames = resolve_filtered_osm_usernames(filters, org_id)
        if filtered_usernames is not None:
            q = q.filter(Task.mapped_by.in_(filtered_usernames))

    ta_osm = _team_admin_osm_usernames(viewer)
    if ta_osm is not None:
        if not ta_osm:
            return []
        q = q.filter(Task.mapped_by.in_(ta_osm))

    return [row[0] for row in q.all()]


def _fetch_user_changeset_points(username, start_date_str, end_date_str):
    """Fetch OSM changesets for one user and extract centroid points.

    NOTE: runs in a thread pool — no Flask app context available, use module logger.
    Returns (username, points, changeset_count, total_changes).
    """
    params = {
        "display_name": username,
        "time": f"{start_date_str},{end_date_str}",
        "closed": "true",
    }
    try:
        resp = http_requests.get(
            "https://api.openstreetmap.org/api/0.6/changesets",
            params=params,
            timeout=30,
        )
        if not resp.ok:
            logger.warning(f"OSM API error for {username}: {resp.status_code}")
            return username, [], 0, 0
    except http_requests.RequestException as e:
        logger.warning(f"OSM API request failed for {username}: {e}")
        return username, [], 0, 0

    try:
        root = ET.fromstring(resp.text)
    except ET.ParseError:
        logger.warning(f"Failed to parse OSM XML for {username}")
        return username, [], 0, 0

    points = []
    cs_count = 0
    changes_total = 0
    for cs in root.findall("changeset"):
        cs_count += 1
        changes = int(cs.get("changes_count", 0))
        changes_total += changes
        min_lat, max_lat = cs.get("min_lat"), cs.get("max_lat")
        min_lon, max_lon = cs.get("min_lon"), cs.get("max_lon")
        if min_lat and max_lat and min_lon and max_lon:
            lat = (float(min_lat) + float(max_lat)) / 2
            lon = (float(min_lon) + float(max_lon)) / 2
            points.append([lat, lon, max(changes, 1)])

    return username, points, cs_count, changes_total


def _fetch_all_user_changesets(osm_usernames, start_date_str, end_date_str):
    """Fetch changesets for all users concurrently."""
    results = []
    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {
            executor.submit(_fetch_user_changeset_points, un, start_date_str, end_date_str): un
            for un in osm_usernames
        }
        for future in as_completed(futures):
            results.append(future.result())
    return results
