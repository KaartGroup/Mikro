import logging
from datetime import datetime, timezone, timedelta

from api.utils.changeset_fetcher import ChangesetFetcher
from api.utils.adiff_analyzer import AdiffAnalyzer
from api.database import db, User, TeamUser, ChangesetAdiff

logger = logging.getLogger(__name__)

_MAX_WINDOW_DAYS = 2
_BATCH_SIZE = 50


def run_element_analysis_job(job):
    """
    Execute an element analysis job from the last processed changeset to now.

    Fetches changesets for all org mappers and stores the raw osmcha adiff XML
    per changeset in changeset_adiff_cache for later reprocessing.
    """

    try:
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
            f"Element analysis job {job.id}: fetching from {since} to {until}"
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

        # Sort oldest-first so partial failures (timeout mid-batch) only drop
        # the newest changesets, which the next job will re-fetch via max(created_at).
        changesets.sort(key=lambda cs: cs.get("created_at", ""))
        total = len(changesets)
        analyzer = AdiffAnalyzer()

        for i, cs in enumerate(changesets):
            cs_id = cs["id"]
            adiff_xml = analyzer.fetch_adiff_xml(cs_id)
            osm_user = cs.get("user")
            uid = osm_to_user_id.get(osm_user)

            try:
                cs_created_at = datetime.fromisoformat(cs["created_at"])
            except (KeyError, ValueError, AttributeError):
                cs_created_at = since

            existing = ChangesetAdiff.query.filter_by(
                org_id=org_id, changeset_id=cs_id
            ).first()

            if existing:
                existing.created_at = cs_created_at
                existing.user_id = uid
                existing.team_id = user_id_to_team_id.get(uid)
                existing.osm_user = osm_user
                existing.adiff_xml = adiff_xml
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

            if (i + 1) % _BATCH_SIZE == 0:
                db.session.commit()

        db.session.commit()

        job.status = "completed"
        job.completed_at = datetime.now(timezone.utc)
        job.progress = f"Done: {total} changesets stored (since {since})"
        db.session.commit()

        logger.info(
            f"Element analysis job {job.id} completed for org {org_id} "
            f"({total} changesets stored since {since})"
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
