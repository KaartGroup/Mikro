import logging
from datetime import datetime, timezone, timedelta

from api.utils.changeset_fetcher import ChangesetFetcher
from api.utils.adiff_analyzer import AdiffAnalyzer
from api.database import db, User, TeamUser, ChangesetAdiff

logger = logging.getLogger(__name__)

_MAX_WINDOW_DAYS = 2
_BATCH_SIZE = 50


def _upsert_changesets(org_id, osm_to_user_id, user_id_to_team_id, changesets, fallback_dt):
    """Insert new changesets into ChangesetAdiff, skipping any that already exist.

    Changesets with no adiff on osmcha are skipped silently.
    Returns count of rows stored.
    """
    incoming_ids = [cs["id"] for cs in changesets]
    existing_rows = {
        row.changeset_id: row
        for row in ChangesetAdiff.query.filter(
            ChangesetAdiff.org_id == org_id,
            ChangesetAdiff.changeset_id.in_(incoming_ids),
        ).all()
    }
    # Rows with adiff_xml already populated are skipped; empty rows get retried.
    skip_ids = {cid for cid, row in existing_rows.items() if row.adiff_xml}
    empty_rows = {cid: row for cid, row in existing_rows.items() if not row.adiff_xml}

    candidates = sorted(
        (cs for cs in changesets if cs["id"] not in skip_ids),
        key=lambda cs: cs.get("created_at", ""),
    )
    logger.info(
        f"  [{org_id}] {len(candidates) - len(empty_rows)} new / "
        f"{len(empty_rows)} empty (retrying) / {len(skip_ids)} already complete"
    )

    analyzer = AdiffAnalyzer()
    stored = 0
    for cs in candidates:
        cs_id = cs["id"]
        adiff_xml = analyzer.fetch_adiff_xml(cs_id)
        if adiff_xml is None:
            logger.info(f"  [{org_id}] no adiff for changeset {cs_id} — skipping")
            continue

        osm_user = cs.get("user")
        uid = osm_to_user_id.get(osm_user)
        try:
            cs_created_at = datetime.fromisoformat(cs["created_at"])
        except (KeyError, ValueError, AttributeError):
            cs_created_at = fallback_dt

        if cs_id in empty_rows:
            empty_rows[cs_id].adiff_xml = adiff_xml
        else:
            db.session.add(ChangesetAdiff(
                org_id=org_id,
                changeset_id=cs_id,
                created_at=cs_created_at,
                user_id=uid,
                team_id=user_id_to_team_id.get(uid),
                osm_user=osm_user,
                adiff_xml=adiff_xml,
            ))
        stored += 1
        if stored % _BATCH_SIZE == 0:
            db.session.commit()
            logger.info(f"  [{org_id}] batch committed: {stored}/{len(candidates)} changesets")

    if stored % _BATCH_SIZE != 0:
        db.session.commit()
    return stored


def run_element_analysis_job(job):
    """
    Execute an element analysis job from the last processed changeset to now.

    Fetches changesets for all org mappers and stores the raw osmcha adiff XML
    per changeset in changeset_adiff_cache for later reprocessing.
    """

    try:
        job_id = job.id
        job.status = "running"
        job.started_at = datetime.now(timezone.utc)
        job.progress = "Starting element analysis..."
        db.session.commit()

        org_id = job.org_id
        until = datetime.now(timezone.utc)

        last_processed = (
            db.session.query(db.func.max(ChangesetAdiff.created_at))
            .filter(ChangesetAdiff.org_id == org_id)
            .scalar()
        )

        if last_processed:
            since = last_processed
        else:
            since = datetime(2026, 5, 1, tzinfo=timezone.utc)

        until = min(until, since + timedelta(days=_MAX_WINDOW_DAYS))

        logger.info(
            f"Element analysis job {job.id}: last_processed={last_processed} "
            f"fetching window [{since}, {until}] "
            f"(span={(until - since).total_seconds() / 3600:.1f}h)"
        )

        users = User.query.filter(
            User.org_id == org_id,
            User.osm_username != None,
        ).all()

        if not users:
            job.status = "completed"
            job.completed_at = datetime.now(timezone.utc)
            job.progress = "No users found for org"
            db.session.commit()
            logger.info(f"Element analysis job {job.id}: no users for org {org_id}")
            return

        osm_to_user_id = {u.osm_username: u.id for u in users}
        osm_usernames = list(osm_to_user_id.keys())

        user_ids = list(osm_to_user_id.values())
        user_id_to_team_id = {
            tu.user_id: tu.team_id
            for tu in TeamUser.query.filter(TeamUser.user_id.in_(user_ids)).all()
        }

        changesets = ChangesetFetcher().fetch(osm_usernames, since, until)

        if not changesets:
            job.status = "completed"
            job.completed_at = datetime.now(timezone.utc)
            job.progress = f"No changesets found since {since}"
            db.session.commit()
            logger.info(f"Element analysis job {job.id}: no changesets since {since}")
            return

        total = _upsert_changesets(
            org_id, osm_to_user_id, user_id_to_team_id, changesets, since
        )

        job.status = "completed"
        job.completed_at = datetime.now(timezone.utc)
        job.progress = f"Done: {total} changesets stored (since {since})"
        db.session.commit()

        logger.info(
            f"Element analysis job {job.id} completed for org {org_id} "
            f"({total} changesets stored since {since})"
        )

    except Exception as e:
        logger.error(f"Element analysis job {job_id} failed: {e}")
        db.session.rollback()
        try:
            job.status = "failed"
            job.error = str(e)[:2000]
            job.completed_at = datetime.now(timezone.utc)
            db.session.commit()
        except Exception:
            logger.error(f"Failed to update job {job_id} error status")
            db.session.rollback()


def run_element_analysis_backfill_job(job):
    """
    Backfill element analysis from _BACKFILL_START up to max(created_at) already in the DB.

    Iterates in _MAX_WINDOW_DAYS chunks so each window stays within the same
    time/memory budget as the normal incremental job.
    """
    try:
        job_id = job.id
        job.status = "running"
        job.started_at = datetime.now(timezone.utc)
        job.progress = "Starting backfill..."
        db.session.commit()

        org_id = job.org_id
        now = datetime.now(timezone.utc)
        backfill_start = now - timedelta(weeks=2)
        backfill_until = now

        users = User.query.filter(
            User.org_id == org_id,
            User.osm_username != None,
        ).all()
        if not users:
            job.status = "completed"
            job.completed_at = datetime.now(timezone.utc)
            job.progress = "No users found for org"
            db.session.commit()
            return

        osm_to_user_id = {u.osm_username: u.id for u in users}
        user_id_to_team_id = {
            tu.user_id: tu.team_id
            for tu in TeamUser.query.filter(
                TeamUser.user_id.in_(list(osm_to_user_id.values()))
            ).all()
        }

        total_stored = 0
        window_num = 0
        window_start = backfill_start

        while window_start < backfill_until:
            window_end = min(window_start + timedelta(days=_MAX_WINDOW_DAYS), backfill_until)
            window_num += 1
            job.progress = (
                f"Window {window_num}: {window_start.date()} → {window_end.date()} "
                f"({total_stored} stored so far)"
            )
            db.session.commit()
            logger.info(
                f"Backfill job {job.id}: window {window_num} "
                f"{window_start.date()} → {window_end.date()}"
            )

            osm_usernames = list(osm_to_user_id.keys())
            changesets = ChangesetFetcher().fetch(osm_usernames, window_start, window_end)
            total_stored += _upsert_changesets(
                org_id, osm_to_user_id, user_id_to_team_id, changesets, window_start
            )
            window_start = window_end

        job.status = "completed"
        job.completed_at = datetime.now(timezone.utc)
        job.progress = (
            f"Backfill done: {total_stored} changesets across {window_num} windows "
            f"({backfill_start.date()} → {backfill_until.date()})"
        )
        db.session.commit()
        logger.info(
            f"Backfill job {job.id} completed: {total_stored} changesets, "
            f"{window_num} windows"
        )

    except Exception as e:
        logger.error(f"Backfill job {job_id} failed: {e}")
        db.session.rollback()
        try:
            job.status = "failed"
            job.error = str(e)[:2000]
            job.completed_at = datetime.now(timezone.utc)
            db.session.commit()
        except Exception:
            logger.error(f"Failed to update backfill job {job_id} error status")
            db.session.rollback()


if __name__ == "__main__":
    import os
    import sys
    import types

    # Resolve to backend/ regardless of where the script is invoked from.
    backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
    sys.path.insert(0, backend_dir)
    os.chdir(backend_dir)

    from app import create_app

    app = create_app()

    org_id = "org_9alzx7S32reIQ86s"
    if not org_id:
        print("ERROR: AUTH0_ORG_ID environment variable not set")
        sys.exit(1)

    # Minimal mock that satisfies the fields run_element_analysis_job reads/writes.
    job = types.SimpleNamespace(
        id="test",
        org_id=org_id,
        status=None,
        started_at=None,
        completed_at=None,
        progress=None,
        error=None,
    )

    with app.app_context():
        run_element_analysis_job(job)
        print(f"\nFinal status : {job.status}")
        print(f"Progress     : {job.progress}")
