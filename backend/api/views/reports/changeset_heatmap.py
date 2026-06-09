import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import timedelta

from flask import g, request

from ...database import User
from ...filters import resolve_filtered_osm_usernames
from ...utils.changeset_fetcher import ChangesetFetcher, changesets_to_heatmap_points
from ...utils.tz import parse_filter_datetime
from .helpers import _team_admin_osm_usernames

logger = logging.getLogger(__name__)

_EMPTY_RESPONSE = {
    "status": 200,
    "heatmapPoints": [],
}


# ---------------------------------------------------------------------------
# Controllers
# ---------------------------------------------------------------------------

def fetch_my_changeset_heatmap():
    """Self-scoped heatmap — returns only the current user's changeset centroids."""
    if not g.user:
        return {"message": "Unauthorized", "status": 401}

    osm_username = getattr(g.user, "osm_username", None)
    if not osm_username:
        return _EMPTY_RESPONSE

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

    try:
        changesets = ChangesetFetcher().fetch([osm_username], since=start_date, until=end_date)
    except Exception as e:
        logger.warning(f"ChangesetFetcher failed for {osm_username}: {e}")
        return _EMPTY_RESPONSE

    return {"status": 200, "heatmapPoints": changesets_to_heatmap_points(changesets)}


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
        filters=request.json.get("filters"),
        max_per_user=int(request.json.get("maxPerUser", 100)),
    )


# ---------------------------------------------------------------------------
# Testable orchestrator
# ---------------------------------------------------------------------------

def get_changeset_heatmap(org_id, viewer, start_date, end_date, filters=None, max_per_user=100):
    """Fetches and aggregates OSM changeset heatmap data. No Flask context required."""
    osm_usernames = _get_active_mapper_usernames(org_id, viewer, filters)
    if not osm_usernames:
        logger.info(
            f"No active mappers found for org_id={org_id}, viewer={viewer.id}, "
            f"start={start_date}, end={end_date}, filters={filters}"
        )
        return _EMPTY_RESPONSE

    all_changesets = _fetch_all_user_changesets(osm_usernames, start_date, end_date, max_per_user)
    logger.info(f"Fetched {len(all_changesets)} changesets for {len(osm_usernames)} users")
    return {
        "status": 200,
        "heatmapPoints": changesets_to_heatmap_points(all_changesets),
    }


# ---------------------------------------------------------------------------
# Single-purpose helpers
# ---------------------------------------------------------------------------

def _get_active_mapper_usernames(org_id, viewer, filters=None):
    """Returns OSM usernames to fetch changesets for, scoped to viewer's teams."""
    ta_osm = _team_admin_osm_usernames(viewer)
    if ta_osm is not None:
        osm_usernames = ta_osm
    else:
        rows = (
            User.query
            .with_entities(User.osm_username)
            .filter(User.org_id == org_id, User.osm_username != None, User.is_active == True)
            .all()
        )
        osm_usernames = [r.osm_username for r in rows]

    if filters:
        filtered_usernames = resolve_filtered_osm_usernames(filters, org_id)
        if filtered_usernames is not None:
            allowed = set(filtered_usernames)
            osm_usernames = [u for u in osm_usernames if u in allowed]

    return osm_usernames


def _fetch_all_user_changesets(osm_usernames, start_date, end_date, max_per_user=100):
    """Fetch changesets for all users concurrently, capped at max_per_user each."""
    all_changesets = []
    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {
            executor.submit(ChangesetFetcher().fetch, [un], start_date, end_date, max_per_user): un
            for un in osm_usernames
        }
        for future in as_completed(futures):
            try:
                all_changesets.extend(future.result())
            except Exception as e:
                logger.warning(f"ChangesetFetcher failed: {e}")
    return all_changesets
