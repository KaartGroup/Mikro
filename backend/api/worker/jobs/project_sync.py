import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


def run_project_sync_job(job):
    """
    Execute a project-scoped sync job.

    Syncs a single project for all assigned users (plus all org users
    if the project is visible). Runs in the background worker to avoid
    gunicorn timeout.
    """
    from ...database import db, User, Project, ProjectUser, ProjectTeam, TeamUser, Task
    from ...views.Tasks import TaskAPI
    from ...views.MapRoulette import MapRouletteSync

    task_api = TaskAPI()

    try:
        # Extract before overwriting progress with status text.
        # User.id is the Auth0 sub string (e.g. "auth0|abc123"), not an int.
        target_user_id = None
        if job.progress and job.progress.startswith("user:"):
            target_user_id = job.progress.split(":", 1)[1]

        job.status = "running"
        job.started_at = datetime.now(timezone.utc)
        job.progress = "Starting project sync..."
        db.session.commit()

        project = Project.query.filter_by(id=job.target_id).first()
        if not project:
            job.status = "failed"
            job.error = f"Project {job.target_id} not found"
            job.completed_at = datetime.now(timezone.utc)
            db.session.commit()
            return

        if target_user_id:
            target_user = User.query.get(target_user_id)
            users = [target_user] if target_user else []
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
            for row in db.session.query(Task.mapped_by).filter(
                Task.project_id == project.id, Task.mapped_by != None
            ).distinct().all():
                if row[0]:
                    contributor_osm_names.add(row[0])
            for row in db.session.query(Task.validated_by).filter(
                Task.project_id == project.id, Task.validated_by != None
            ).distinct().all():
                if row[0]:
                    contributor_osm_names.add(row[0])

            contributor_user_ids = set()
            if contributor_osm_names:
                contributor_user_ids = set(
                    u.id for u in User.query.filter(
                        User.osm_username.in_(contributor_osm_names),
                        User.org_id == job.org_id,
                    ).all()
                )

            all_user_ids = direct_ids | team_user_ids | contributor_user_ids
            users = User.query.filter(User.id.in_(all_user_ids)).all() if all_user_ids else []

        total_users = len(users)
        synced = 0

        for i, user in enumerate(users, 1):
            job.progress = f"Syncing {project.name}: user {i}/{total_users}"
            db.session.commit()
            try:
                if project.source == "mr":
                    MapRouletteSync().sync_challenge_tasks(project, user)
                else:
                    task_api.TM4_payment_call(project.id, user)
                synced += 1
            except Exception as e:
                logger.error(f"Project sync error - project {project.id}, user {user.id}: {e}")

        job.status = "completed"
        job.completed_at = datetime.now(timezone.utc)
        job.progress = f"Completed: {project.name} synced for {synced} users"
        db.session.commit()

        logger.info(f"Project sync job {job.id} completed: {project.name} ({synced} users)")

    except Exception as e:
        logger.error(f"Project sync job {job.id} failed: {e}")
        db.session.rollback()
        try:
            job.status = "failed"
            job.error = str(e)[:2000]
            job.completed_at = datetime.now(timezone.utc)
            db.session.commit()
        except Exception:
            logger.error(f"Failed to update job {job.id} error status")
            db.session.rollback()
