import logging
import time
from datetime import datetime, timezone

import requests

logger = logging.getLogger(__name__)


def run_mr_metadata_backfill(app, job):
    """
    Backfill MapRoulette challenge metadata (name + task count) for a project
    that was created while the MR API was unavailable.

    Retries up to 3 times with increasing delays (10s, 30s, 60s).
    """
    from ...database import db, Project
    from ...views.MapRoulette import MapRouletteSync
    from ...views.Projects import _strip_trailing_hashtags

    challenge_id = job.target_id
    max_retries = 3
    delays = [10, 30, 60]

    try:
        job.status = "running"
        job.started_at = datetime.now(timezone.utc)
        job.progress = f"Fetching metadata for MR challenge {challenge_id}..."
        db.session.commit()

        project = Project.query.filter_by(id=challenge_id).first()
        if not project:
            job.status = "failed"
            job.error = f"Project {challenge_id} not found"
            job.completed_at = datetime.now(timezone.utc)
            db.session.commit()
            return

        mr_data = None
        for attempt in range(max_retries):
            try:
                job.progress = f"Attempt {attempt + 1}/{max_retries} for challenge {challenge_id}"
                db.session.commit()
                mr_data = MapRouletteSync().fetch_challenge_metadata(challenge_id)
                if mr_data:
                    break
            except Exception as e:
                logger.warning(
                    f"MR metadata backfill attempt {attempt + 1} failed for "
                    f"{challenge_id}: {e}"
                )

            if attempt < max_retries - 1:
                time.sleep(delays[attempt])

        if not mr_data:
            job.status = "failed"
            job.error = (
                f"Could not fetch MR metadata for challenge {challenge_id} "
                f"after {max_retries} attempts"
            )
            job.completed_at = datetime.now(timezone.utc)
            db.session.commit()
            logger.error(f"MR metadata backfill failed for {challenge_id}")
            return

        old_name = project.name
        # MR challenge titles routinely include trailing hashtags (e.g.
        # `#Kaart`, `#Colombia`, `#MR57669`) that whoever set the
        # challenge up picked ad-hoc and don't always match Mikro's
        # bookkeeping. Strip them at the single write sink so the long
        # name in Mikro is the human-readable portion only. Helper is
        # idempotent — safe on titles that have no hashtags.
        raw_name = mr_data.get("name", project.name)
        project.name = _strip_trailing_hashtags(raw_name)

        try:
            mr_sync = MapRouletteSync()
            mr_base = mr_sync._get_mr_base_url()
            mr_headers = mr_sync._get_mr_headers()
            total_count = 0
            count_page = 0
            while True:
                count_url = f"{mr_base}/challenge/{challenge_id}/tasks?limit=200&page={count_page}"
                count_resp = requests.get(count_url, headers=mr_headers, timeout=30)
                if not count_resp.ok:
                    break
                page_tasks = count_resp.json()
                if not isinstance(page_tasks, list) or len(page_tasks) == 0:
                    break
                total_count += len(page_tasks)
                if len(page_tasks) < 200:
                    break
                count_page += 1
            if total_count > 0:
                project.total_tasks = total_count
        except Exception as e:
            logger.warning(f"Could not count MR tasks for {challenge_id}: {e}")

        if project.total_tasks > 0:
            project.max_payment = (
                project.mapping_rate_per_task + project.validation_rate_per_task
            ) * project.total_tasks

        db.session.commit()

        job.status = "completed"
        job.completed_at = datetime.now(timezone.utc)
        job.progress = (
            f"Updated: '{old_name}' → '{project.name}' "
            f"({project.total_tasks} tasks)"
        )
        db.session.commit()

        logger.info(
            f"MR metadata backfill completed for {challenge_id}: "
            f"{project.name} ({project.total_tasks} tasks)"
        )

    except Exception as e:
        logger.error(f"MR metadata backfill job {job.id} failed: {e}")
        db.session.rollback()
        try:
            job.status = "failed"
            job.error = str(e)[:2000]
            job.completed_at = datetime.now(timezone.utc)
            db.session.commit()
        except Exception:
            logger.error(f"Failed to update job {job.id} error status")
            db.session.rollback()
