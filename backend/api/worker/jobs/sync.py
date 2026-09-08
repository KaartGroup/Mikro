import logging
from datetime import datetime, timezone, timedelta
from ...database import db, User, ProjectUser, ProjectTeam, TeamUser, Task
from ... import users_repo
from ...views.Tasks import TaskAPI
from ...views.MapRoulette import MapRouletteSync

logger = logging.getLogger(__name__)

# This job's own wall-clock budget. Must stay BELOW the worker poller's
# _STALE_JOB_TIMEOUT (derived from this value in worker/main.py) so that a
# long run aborts itself with an informative "completed k/N projects"
# error instead of being killed mid-flight by the stale-job check.
MAX_SYNC_JOB_DURATION = timedelta(hours=2)


def sync_project(project, org_id, target_user_id=None):
    """
    Sync a single project.

    MR: fetches all challenge tasks in one pass — the API fetch is the
    expensive part, so per-user filtering is not worth extra calls.

    TM4: resolves the project's users (direct assignments, team members,
    and historical contributors) then syncs per user. Pass target_user_id
    to restrict to a single user (on-demand / user-triggered syncs).
    """

    if project.source == "mr":
        MapRouletteSync().sync_challenge_tasks(project)
        return

    # TM4: resolve users for this project
    if target_user_id:
        user = users_repo.by_id(target_user_id)
        users = [user] if user else []
    else:
        direct_ids = set(
            pu.user_id
            for pu in ProjectUser.query.filter_by(project_id=project.id).all()
        )

        team_ids = [
            pt.team_id
            for pt in ProjectTeam.query.filter_by(project_id=project.id).all()
        ]
        team_user_ids = set()
        if team_ids:
            team_user_ids = set(
                tu.user_id
                for tu in TeamUser.query.filter(TeamUser.team_id.in_(team_ids)).all()
            )

        contributor_osm_names = set()
        for row in (
            db.session.query(Task.mapped_by)
            .filter(Task.project_id == project.id, Task.mapped_by != None)
            .distinct()
            .all()
        ):
            if row[0]:
                contributor_osm_names.add(row[0])
        for row in (
            db.session.query(Task.validated_by)
            .filter(Task.project_id == project.id, Task.validated_by != None)
            .distinct()
            .all()
        ):
            if row[0]:
                contributor_osm_names.add(row[0])

        contributor_user_ids = set()
        if contributor_osm_names:
            contributor_user_ids = set(
                u.id
                for u in User.query.filter(
                    User.osm_username.in_(contributor_osm_names),
                    User.org_id == org_id,
                ).all()
            )

        all_user_ids = direct_ids | team_user_ids | contributor_user_ids
        users = users_repo.by_ids(all_user_ids)

    task_api = TaskAPI()
    for user in users:
        try:
            task_api.TM4_payment_call(project.id, user)
        except Exception as e:
            logger.error(f"TM4 sync error — project {project.id}, user {user.id}: {e}")
            db.session.rollback()

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
            sync_project(project, job.org_id, target_user_id)

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
