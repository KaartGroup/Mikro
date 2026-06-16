import logging
import time
from datetime import datetime, timezone

from api.database import db, Friend, Punk, FriendChangeset, PunkChangeset
from api.utils.watchlist_osm import refresh_entry_stats

logger = logging.getLogger(__name__)


def run_watchlist_refresh_job(job):
    """Refresh cached OSM stats (last active, counts) for every friend and punk
    in the job's org. Discussions are NOT fetched here — they are lazy/on-demand.

    Each entry is refreshed in its own try/except so one bad entry can't abort
    the whole run, with a 1s pause between entries for OSM politeness.
    """
    try:
        job_id = job.id
        job.status = "running"
        job.started_at = datetime.now(timezone.utc)
        job.progress = "Starting watchlist refresh..."
        db.session.commit()

        org_id = job.org_id

        friends = Friend.query.filter_by(org_id=org_id).all()
        punks = Punk.query.filter_by(org_id=org_id).all()
        entries = [(f, FriendChangeset) for f in friends] + [
            (p, PunkChangeset) for p in punks
        ]

        refreshed = 0
        failed = 0
        for entry, changeset_model in entries:
            try:
                refresh_entry_stats(entry, changeset_model)
                refreshed += 1
            except Exception as e:
                failed += 1
                db.session.rollback()
                logger.warning(
                    f"Watchlist refresh job {job.id}: failed to refresh "
                    f"'{getattr(entry, 'osm_username', entry.id)}': {e}"
                )
            time.sleep(1)

        job.status = "completed"
        job.completed_at = datetime.now(timezone.utc)
        job.progress = f"refreshed {refreshed}, failed {failed}"
        db.session.commit()

        logger.info(
            f"Watchlist refresh job {job.id} completed for org {org_id} "
            f"(refreshed {refreshed}, failed {failed})"
        )

    except Exception as e:
        logger.error(f"Watchlist refresh job {job_id} failed: {e}")
        db.session.rollback()
        try:
            job.status = "failed"
            job.error = str(e)[:2000]
            job.completed_at = datetime.now(timezone.utc)
            db.session.commit()
        except Exception:
            logger.error(
                f"Failed to update watchlist refresh job {job_id} error status"
            )
            db.session.rollback()
