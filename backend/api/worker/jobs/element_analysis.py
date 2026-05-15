import logging
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta, date

import requests

logger = logging.getLogger(__name__)


def _classify_element(element):
    """Classify an OSM element into categories based on its tags.

    Returns a set of category names the element belongs to.
    """
    tags = {}
    for tag_el in element.findall("tag"):
        tags[tag_el.get("k", "")] = tag_el.get("v", "")

    categories = set()

    if "oneway" in tags:
        categories.add("Oneways")

    if "access" in tags or "barrier" in tags:
        categories.add("Access & Barriers")

    highway_val = tags.get("highway", "")
    if highway_val:
        categories.add("Highways")

    if "ref" in tags:
        categories.add("Refs")

    if element.tag == "relation" and tags.get("type", "").startswith("restriction"):
        categories.add("Turn Restrictions")

    if "name" in tags:
        categories.add("Names")

    if "construction" in tags or highway_val == "construction":
        categories.add("Construction")

    road_hierarchy = {
        "primary", "secondary", "tertiary", "residential",
        "trunk", "motorway", "unclassified",
        "primary_link", "secondary_link", "tertiary_link",
        "trunk_link", "motorway_link",
    }
    if highway_val in road_hierarchy:
        categories.add("Classifications")

    return categories


def _get_week_start(dt):
    """Get the Sunday of the week for a given date."""
    if isinstance(dt, datetime):
        dt = dt.date()
    days_since_sunday = (dt.weekday() + 1) % 7
    return dt - timedelta(days=days_since_sunday)


def run_element_analysis_job(app, job):
    """
    Execute an element analysis job.

    Fetches OsmChange XML for all org mappers' changesets, classifies elements
    by OSM tags, and caches weekly aggregates by category.
    """
    from sqlalchemy import func
    from ...database import db, Task, ElementAnalysisCache

    try:
        job.status = "running"
        job.started_at = datetime.now(timezone.utc)
        job.progress = "Starting element analysis..."
        db.session.commit()

        org_id = job.org_id
        today = date.today()

        # Use the newest cached date as the cursor so we only fetch new days.
        # On first run (no cache) fall back to the default 4-week window.
        last_cached = (
            db.session.query(func.max(ElementAnalysisCache.day))
            .filter(ElementAnalysisCache.org_id == org_id)
            .scalar()
        )

        if last_cached:
            analysis_start = last_cached + timedelta(days=1)
        else:
            week_start = _get_week_start(today)
            analysis_start = week_start - timedelta(weeks=1)

        if analysis_start >= today:
            job.status = "completed"
            job.completed_at = datetime.now(timezone.utc)
            job.progress = f"Cache already current through {last_cached}"
            db.session.commit()
            logger.info(f"Element analysis job {job.id}: cache already current, nothing to fetch")
            return

        start_str = analysis_start.isoformat()
        end_str = today.isoformat()

        active_mappers = (
            db.session.query(Task.mapped_by)
            .filter(
                Task.org_id == org_id,
                Task.mapped == True,
                Task.mapped_by != None,
            )
            .distinct()
            .all()
        )
        osm_usernames = [row[0] for row in active_mappers if row[0]]

        if not osm_usernames:
            job.status = "completed"
            job.completed_at = datetime.now(timezone.utc)
            job.progress = "No active mappers found"
            db.session.commit()
            logger.info(f"Element analysis job {job.id}: no active mappers")
            return

        total_users = len(osm_usernames)
        job.progress = f"Fetching changesets for {total_users} mappers..."
        db.session.commit()

        all_changeset_ids = {}  # {changeset_id: (username, created_at)}

        def _fetch_user_changesets(username):
            # OSM caps at 100 per request with no offset parameter.
            # Paginate cursor-style: use the oldest changeset's created_at
            # as the new end time until a page returns fewer than 100.
            osm_url = "https://api.openstreetmap.org/api/0.6/changesets"
            changesets = []
            page_end = end_str

            while True:
                params = {
                    "display_name": username,
                    "time": f"{start_str},{page_end}",
                    "closed": "true",
                }
                try:
                    resp = requests.get(osm_url, params=params, timeout=30)
                    if not resp.ok:
                        break
                except requests.RequestException:
                    break

                try:
                    root = ET.fromstring(resp.text)
                except ET.ParseError:
                    break

                page = []
                for cs in root.findall("changeset"):
                    cs_id = cs.get("id")
                    created = cs.get("created_at", "")
                    if cs_id:
                        page.append((cs_id, created))

                changesets.extend(page)

                if len(page) < 100:
                    break

                oldest_created = min(created for _, created in page if created)
                page_end = oldest_created

            return username, changesets

        with ThreadPoolExecutor(max_workers=5) as executor:
            futures = {
                executor.submit(_fetch_user_changesets, un): un
                for un in osm_usernames
            }
            for i, future in enumerate(as_completed(futures), 1):
                username, changesets = future.result()
                for cs_id, created in changesets:
                    all_changeset_ids[cs_id] = (username, created)
                job.progress = f"Fetched changeset lists: {i}/{total_users} users"
                db.session.commit()

        total_changesets = len(all_changeset_ids)
        if total_changesets == 0:
            job.status = "completed"
            job.completed_at = datetime.now(timezone.utc)
            job.progress = "No changesets found in period"
            db.session.commit()
            logger.info(f"Element analysis job {job.id}: no changesets found")
            return

        job.progress = f"Analyzing {total_changesets} changesets..."
        db.session.commit()

        category_counts = {}

        def _analyze_changeset(cs_id, created_at_str):
            url = f"https://api.openstreetmap.org/api/0.6/changeset/{cs_id}/download"
            try:
                resp = requests.get(url, timeout=30)
                if not resp.ok:
                    return cs_id, created_at_str, {}
            except requests.RequestException:
                return cs_id, created_at_str, {}

            try:
                root = ET.fromstring(resp.text)
            except ET.ParseError:
                return cs_id, created_at_str, {}

            local_counts = {}
            action_map = {"create": "added", "modify": "modified", "delete": "deleted"}

            for action_tag, action_key in action_map.items():
                action_el = root.find(action_tag)
                if action_el is None:
                    continue
                for element in action_el:
                    if element.tag not in ("node", "way", "relation"):
                        continue
                    cats = _classify_element(element)
                    for cat in cats:
                        if cat not in local_counts:
                            local_counts[cat] = {"added": 0, "modified": 0, "deleted": 0}
                        local_counts[cat][action_key] += 1

            return cs_id, created_at_str, local_counts

        cs_items = list(all_changeset_ids.items())
        processed = 0

        batch_size = 20
        for batch_start in range(0, len(cs_items), batch_size):
            batch = cs_items[batch_start:batch_start + batch_size]

            with ThreadPoolExecutor(max_workers=5) as executor:
                futures = {
                    executor.submit(_analyze_changeset, cs_id, info[1]): cs_id
                    for cs_id, info in batch
                }
                for future in as_completed(futures):
                    cs_id, created_at_str, local_counts = future.result()
                    processed += 1

                    try:
                        cs_date = datetime.fromisoformat(
                            created_at_str.replace("Z", "+00:00")
                        ).date()
                    except (ValueError, AttributeError):
                        cs_date = today

                    for cat, counts in local_counts.items():
                        key = (cs_date, cat)
                        if key not in category_counts:
                            category_counts[key] = {"added": 0, "modified": 0, "deleted": 0}
                        category_counts[key]["added"] += counts["added"]
                        category_counts[key]["modified"] += counts["modified"]
                        category_counts[key]["deleted"] += counts["deleted"]

                    if processed % 10 == 0 or processed == total_changesets:
                        job.progress = f"Analyzed {processed}/{total_changesets} changesets"
                        db.session.commit()

            time.sleep(0.5)

        job.progress = "Writing cache..."
        db.session.commit()

        # Delete only the specific dates we're about to write so a retry
        # is idempotent without touching historical rows.
        dates_to_write = {day for day, _ in category_counts}
        if dates_to_write:
            ElementAnalysisCache.query.filter(
                ElementAnalysisCache.org_id == org_id,
                ElementAnalysisCache.day.in_(dates_to_write),
            ).delete(synchronize_session=False)

        now = datetime.now(timezone.utc)
        for (day, category), counts in category_counts.items():
            cache_row = ElementAnalysisCache(
                org_id=org_id,
                day=day,
                category=category,
                added=counts["added"],
                modified=counts["modified"],
                deleted=counts["deleted"],
                updated_at=now,
            )
            db.session.add(cache_row)

        db.session.commit()

        job.status = "completed"
        job.completed_at = datetime.now(timezone.utc)
        job.progress = (
            f"Done: {total_changesets} changesets, "
            f"{len(category_counts)} category/day combos cached"
        )
        db.session.commit()

        logger.info(
            f"Element analysis job {job.id} completed for org {org_id} "
            f"({total_changesets} changesets analyzed)"
        )

    except Exception as e:
        logger.error(f"Element analysis job {job.id} failed: {e}")
        db.session.rollback()
        try:
            job.status = "failed"
            job.error = str(e)[:2000]
            job.completed_at = datetime.now(timezone.utc)
            db.session.commit()
        except Exception:
            logger.error(f"Failed to update job {job.id} error status")
            db.session.rollback()
