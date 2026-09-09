import logging
from datetime import datetime, timezone, timedelta
from ...database import db
from ... import users_repo
from ...views.Tasks import TaskAPI
from ...views.MapRoulette import MapRouletteSync

logger = logging.getLogger(__name__)

# This job's own wall-clock budget. Must stay BELOW the worker poller's
# _STALE_JOB_TIMEOUT (derived from this value in worker/main.py) so that a
# long run aborts itself with an informative "completed k/N projects"
# error instead of being killed mid-flight by the stale-job check.
MAX_SYNC_JOB_DURATION = timedelta(hours=2)


def sync_project(project, target_user_id=None):
    """
    Sync a single project.

    Both sources now cost one pass per project. MR fetches a single extract
    CSV; TM4 fetches its project-wide contributions once and only narrows the
    per-task invalidation check by user.

    Pass ``target_user_id`` to scope a TM4 sync to one user's tasks
    (on-demand / user-triggered syncs). Without it, every linked task in the
    project is checked -- a superset of what the old per-user loop covered.
    """

    if project.source == "mr":
        MapRouletteSync().sync_challenge_tasks(project)
        return

    # TM4. The user set exists only to scope the invalidation check; the
    # project-wide fetch and parse happen once either way. Resolving every
    # assigned user, team member and historical contributor -- as this used
    # to, purely to drive a per-user loop over the same payload -- bought
    # nothing but a multiplier on the work.
    user_ids = None
    if target_user_id:
        user = users_repo.by_id(target_user_id)
        user_ids = [user.id] if user else []
        if not user_ids:
            logger.warning(
                f"TM4 sync: target user {target_user_id} not found — "
                f"skipping project {project.id}"
            )
            return

    try:
        TaskAPI().sync_tm4_project(project.id, user_ids=user_ids)
    except Exception as e:
        logger.error(f"TM4 sync error — project {project.id}: {e}")
        db.session.rollback()
        return

    project.last_sync_cursor = datetime.now(timezone.utc)
    db.session.commit()


def run_sync_job(job):
    """
    Execute a queued sync job.

    Handles full-org syncs (job_type="task_sync"), MapRoulette-only syncs
    (job_type="mr_sync") and single-project syncs (job_type="project_sync").
    MR challenges are fetched once each; TM4 projects are synced per resolved
    user.

    "mr_sync" exists because the two sources have wildly different costs: an
    MR challenge is one extract request (~340ms), while a TM4 project fans out
    to one request per assigned user. Sharing a single job meant the cheap MR
    work sat behind hours of TM4 calls and never ran.

    For project_sync jobs, encode an optional user scope as
    job.progress="user:<user_id>" before queuing.
    """
    from ...database import db, Project

    try:
        # Must read job.progress before overwriting it below.
        # User.id is the Auth0 sub string (e.g. "auth0|abc123"), not an int.
        target_user_id = None
        if (
            job.job_type == "project_sync"
            and job.progress
            and job.progress.startswith("user:")
        ):
            target_user_id = job.progress.split(":", 1)[1]

        job.status = "running"
        if not job.started_at:
            job.started_at = datetime.now(timezone.utc)
        job.progress = "Starting sync..."
        db.session.commit()
        job_start = datetime.now(timezone.utc)

        if job.job_type == "project_sync":
            project = Project.query.filter_by(id=job.target_id).first()
            if not project:
                job.status = "failed"
                job.error = f"Project {job.target_id} not found"
                job.completed_at = datetime.now(timezone.utc)
                db.session.commit()
                return
            projects = [project]
        else:
            q = Project.query.filter(
                Project.org_id == job.org_id,
                Project.status == True,
            )
            if job.job_type == "mr_sync":
                q = q.filter(Project.source == "mr")
            # Least-recently-synced first, never-synced ahead of everything
            # else. Without an ORDER BY the row order is arbitrary, so a run
            # that hits the wall clock re-syncs the same head of the list
            # every night and the tail is never reached at all -- which is how
            # 166 of 291 active MR projects ended up never synced.
            projects = q.order_by(
                Project.last_sync_cursor.asc().nulls_first(),
                Project.id.asc(),
            ).all()

        total = len(projects)
        for k, project in enumerate(projects, 1):
            elapsed = datetime.now(timezone.utc) - job_start
            if elapsed > MAX_SYNC_JOB_DURATION:
                logger.warning(
                    f"Sync job {job.id} exceeded {MAX_SYNC_JOB_DURATION} wall time "
                    f"after {k - 1}/{total} projects — aborting"
                )
                db.session.refresh(job)
                if job.status == "running":
                    job.status = "failed"
                    job.error = f"Timed out after {elapsed} — completed {k - 1}/{total} projects"
                    job.completed_at = datetime.now(timezone.utc)
                    db.session.commit()
                return

            job.progress = f"Project {k}/{total}: {project.name}"
            db.session.commit()
            sync_project(project, target_user_id)

        # Re-fetch to guard against the stale-timeout having already marked this failed
        # while it was running in a background thread.
        db.session.refresh(job)
        if job.status != "running":
            logger.warning(
                f"Job {job.id} was externally set to {job.status!r} — skipping completion update"
            )
            return

        job.status = "completed"
        job.completed_at = datetime.now(timezone.utc)
        job.progress = f"Completed: {total} project(s)"
        db.session.commit()

        logger.info(
            f"Sync job {job.id} ({job.job_type}) completed for org {job.org_id} "
            f"({total} project(s))"
        )

    except Exception as e:
        logger.error(f"Sync job {job.id} failed: {e}")
        db.session.rollback()
        try:
            job.status = "failed"
            job.error = str(e)[:2000]
            job.completed_at = datetime.now(timezone.utc)
            db.session.commit()
        except Exception:
            logger.error(f"Failed to update job {job.id} error status")
            db.session.rollback()
