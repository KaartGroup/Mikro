import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta

import requests as http_requests
from flask import g, request, current_app

from ...auth import managed_team_ids_for, team_member_ids_for
from ...database import User, TeamUser
from ...utils.tz import parse_filter_datetime

logger = logging.getLogger(__name__)

_NO_USERS_RESPONSE = {
    "status": 200,
    "summary": {
        "total_images": 0,
        "total_trips": 0,
        "total_sequences": 0,
        "active_contributors": 0,
        "images_by_user": [],
    },
    "trips": [],
    "weekly_uploads": [],
    "message": "No users have Mapillary usernames linked",
}


# ---------------------------------------------------------------------------
# Controller
# ---------------------------------------------------------------------------

def fetch_mapillary_stats():
    """Reads Flask context and delegates to get_mapillary_stats."""
    if not g.user:
        return {"message": "Missing user info", "status": 304}

    token = current_app.config.get("MAPILLARY_ACCESS_TOKEN")
    if not token:
        return {**_NO_USERS_RESPONSE, "message": "Mapillary API token not configured"}

    start_date_str = request.json.get("startDate")
    end_date_str = request.json.get("endDate")
    if start_date_str and end_date_str:
        start_dt, _ = parse_filter_datetime(start_date_str)
        end_dt, _ = parse_filter_datetime(end_date_str)
        if start_dt is None or end_dt is None:
            return {"message": "Invalid startDate or endDate", "status": 400}
    else:
        end_dt = datetime.utcnow()
        start_dt = end_dt - timedelta(days=30)

    users = _get_mapillary_users(
        org_id=g.user.org_id,
        viewer=g.user,
        user_id=request.json.get("userId"),
        team_id=request.json.get("teamId"),
    )
    if not users:
        return _NO_USERS_RESPONSE

    return get_mapillary_stats(users, token, start_dt, end_dt)


# ---------------------------------------------------------------------------
# Testable orchestrator
# ---------------------------------------------------------------------------

def get_mapillary_stats(users, token, start_dt, end_dt):
    """Fetches and processes Mapillary data for a list of users. No Flask context required."""
    start_iso = start_dt.strftime("%Y-%m-%dT00:00:00Z")
    end_iso = end_dt.strftime("%Y-%m-%dT23:59:59Z")
    user_results = _fetch_all_user_images(users, token, start_iso, end_iso)
    return _process_mapillary_results(user_results)


# ---------------------------------------------------------------------------
# Single-purpose helpers
# ---------------------------------------------------------------------------

def _get_mapillary_users(org_id, viewer, user_id=None, team_id=None):
    """Returns users with Mapillary usernames, scoped to viewer permissions."""
    q = User.query.filter(
        User.org_id == org_id,
        User.mapillary_username.isnot(None),
        User.mapillary_username != "",
    )

    if user_id:
        q = q.filter(User.id == user_id)
    elif team_id:
        team_user_ids = [tu.user_id for tu in TeamUser.query.filter_by(team_id=team_id).all()]
        q = q.filter(User.id.in_(team_user_ids) if team_user_ids else False)

    if getattr(viewer, "role", None) == "team_admin":
        managed = managed_team_ids_for(viewer)
        if not managed:
            return []
        ta_member_ids = list(team_member_ids_for(managed))
        if not ta_member_ids:
            return []
        q = q.filter(User.id.in_(ta_member_ids))

    return q.all()


def _fetch_user_images(user, token, start_iso, end_iso):
    """Fetch all Mapillary images for one user via cursor-based pagination.

    NOTE: runs in a thread pool — no Flask app context available, use module logger.
    """
    first_name = (user.first_name or "").title()
    last_name = (user.last_name or "").title()
    full_name = f"{first_name} {last_name}".strip() or user.mapillary_username

    all_images = []
    url = (
        f"https://graph.mapillary.com/images"
        f"?access_token={token}"
        f"&creator_username={user.mapillary_username}"
        f"&start_captured_at={start_iso}"
        f"&end_captured_at={end_iso}"
        f"&fields=id,captured_at,sequence"
        f"&limit=2000"
    )
    try:
        while url:
            resp = http_requests.get(url, timeout=30)
            if resp.status_code != 200:
                logger.warning(f"Mapillary API error for {user.mapillary_username}: {resp.status_code}")
                break
            data = resp.json()
            all_images.extend(data.get("data", []))
            url = data.get("paging", {}).get("next")
    except Exception as e:
        logger.error(f"Mapillary fetch error for {user.mapillary_username}: {e}")

    return {
        "user_id": user.id,
        "user_name": full_name,
        "mapillary_username": user.mapillary_username,
        "images": all_images,
    }


def _fetch_all_user_images(users, token, start_iso, end_iso):
    """Fetch images for all users concurrently."""
    results = []
    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {executor.submit(_fetch_user_images, u, token, start_iso, end_iso): u for u in users}
        for future in as_completed(futures):
            try:
                results.append(future.result())
            except Exception as e:
                logger.error(f"Mapillary fetch thread error: {e}")
    return results


def _process_mapillary_results(user_results):
    """Aggregate per-user image data into summary, trips, and weekly uploads."""
    total_images = 0
    total_sequences = set()
    images_by_user = []
    all_trips = []
    weekly_buckets = {}

    for user_result in user_results:
        images = user_result["images"]
        user_name = user_result["user_name"]
        mapillary_un = user_result["mapillary_username"]
        user_image_count = len(images)
        total_images += user_image_count

        if user_image_count > 0:
            images_by_user.append({"username": mapillary_un, "name": user_name, "count": user_image_count})

        sequences = {}
        for img in images:
            seq_id = img.get("sequence", "unknown")
            total_sequences.add(seq_id)
            sequences.setdefault(seq_id, []).append(img)

        date_groups = {}
        for seq_id, seq_images in sequences.items():
            if seq_images:
                cap_at = seq_images[0].get("captured_at")
                if cap_at and isinstance(cap_at, (int, float)):
                    trip_date = datetime.utcfromtimestamp(cap_at / 1000).strftime("%Y-%m-%d")
                else:
                    trip_date = "unknown"
                date_groups.setdefault(trip_date, {"images": 0, "sequences": set()})
                date_groups[trip_date]["images"] += len(seq_images)
                date_groups[trip_date]["sequences"].add(seq_id)

        for trip_date, trip_data in date_groups.items():
            all_trips.append({
                "user_name": user_name,
                "mapillary_username": mapillary_un,
                "date": trip_date,
                "image_count": trip_data["images"],
                "sequence_count": len(trip_data["sequences"]),
            })

        for img in images:
            cap_at = img.get("captured_at")
            if cap_at and isinstance(cap_at, (int, float)):
                img_date = datetime.utcfromtimestamp(cap_at / 1000)
                week_key = (img_date - timedelta(days=(img_date.weekday() + 1) % 7)).date()
                weekly_buckets[week_key] = weekly_buckets.get(week_key, 0) + 1

    all_trips.sort(key=lambda t: t["date"], reverse=True)
    images_by_user.sort(key=lambda u: u["count"], reverse=True)

    return {
        "status": 200,
        "summary": {
            "total_images": total_images,
            "total_trips": len(all_trips),
            "total_sequences": len(total_sequences),
            "active_contributors": sum(1 for u in images_by_user if u["count"] > 0),
            "images_by_user": images_by_user,
        },
        "trips": all_trips,
        "weekly_uploads": [
            {"week": f"{k.month}/{k.day}", "images": weekly_buckets[k]}
            for k in sorted(weekly_buckets.keys())
        ],
    }
