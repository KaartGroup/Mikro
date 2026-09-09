#!/usr/bin/env python3
"""
Task API endpoints for Mikro.

Handles task synchronization with TM4 (Tasking Manager 4).
TM3 support has been removed.
"""

import threading
from concurrent.futures import ThreadPoolExecutor

import requests

from sqlalchemy import func
from flask.views import MethodView
from flask import g, request, current_app

from ..utils import requires_admin, requires_team_admin_or_above
from ..auth import UserScope
from .. import users_repo
from ..database import (
    Project,
    Task,
    ProjectUser,
    ProjectTeam,
    TeamUser,
    UserTasks,
    SyncJob,
    db,
)
from ..worker.sync_queue import SyncJobQueue


from .split_task_helpers import (
    should_count_invalidation,
)


class TaskAPI(MethodView):
    """Task management API endpoints for TM4 integration."""

    # Bounded fan-out for the read-only per-task status fetches in
    # get_invalidated_TM4_tasks. TM4 is a shared service, so this stays
    # modest: the win is hiding request latency, not raw throughput. Threads
    # only issue HTTP and return parsed JSON -- every DB mutation is applied
    # serially on the calling thread, which has the Flask app context.
    _TM4_TASK_FETCH_WORKERS = 8

    def _should_count_invalidation(self, task):
        return should_count_invalidation(task)

    def post(self, path: str):
        """Route POST requests to appropriate handler."""
        if path == "admin_update_all_user_tasks":
            return self.admin_update_all_user_tasks()
        elif path == "check_sync_status":
            return self.check_sync_status()
        elif path == "sync_project":
            return self.sync_project()
        elif path == "sync_user_projects":
            return self.sync_user_projects()
        return {
            "message": "Invalid path",
            "status": 405,
        }, 405

    def _get_tm4_headers(self):
        """Get headers for TM4 API requests."""
        token = current_app.config.get("TM4_API_TOKEN")
        return {
            "Authorization": f"Bearer {token}" if token else "",
            "Accept-Language": "en-US",
        }

    def _get_tm4_base_url(self):
        """Get TM4 API base URL from config."""
        return current_app.config.get("TM4_API_URL", "https://tasks.kaart.com/api/v2")

    def get_validated_TM4_tasks(self, data, project_id):
        """
        Process validated tasks from TM4 contributions data.

        Updates task status and user payment totals for validated tasks.
        """
        contributions = data.get("userContributions", [])
        target_project = Project.query.filter_by(id=project_id).first()

        if not target_project:
            current_app.logger.error(f"Project {project_id} not found")
            return {"response": "project not found"}

        # (Removed a dead ``User.query.all()`` here — the result was never
        # used; this method matches contributors via per-username lookups
        # below, which are org-scoped.)

        # Build reverse lookup: task_id -> mapper username from contributions
        task_to_mapper = {}
        for contrib in contributions:
            for t in contrib.get("mappedTasks", []):
                task_to_mapper[t] = contrib["username"]

        for c in contributions:
            validator_exists = users_repo.by_osm_username(
                c["username"], target_project.org_id
            )

            if validator_exists is not None:
                validated_tasks = c.get("validatedTasks", [])
                current_app.logger.info(
                    f"Processing {len(validated_tasks)} validations by "
                    f"Mikro user {c['username']} on project {project_id}"
                )
                tasks_created = 0
                tasks_validated = 0
                tasks_skipped = 0

                for task in validated_tasks:
                    try:
                        task_exists = Task.query.filter_by(
                            task_id=task, project_id=project_id
                        ).first()

                        # Task doesn't exist yet — create it ONLY because a Mikro
                        # validator validated it. Mapper stats are NOT updated.
                        if task_exists is None:
                            original_mapper = task_to_mapper.get(task, "unknown")
                            task_exists = Task.create(
                                task_id=task,
                                org_id=target_project.org_id,
                                project_id=project_id,
                                mapping_rate=target_project.mapping_rate_per_task,
                                validation_rate=target_project.validation_rate_per_task,
                                paid_out=False,
                                mapped=True,
                                mapped_by=original_mapper,
                                validated_by="",
                                validated=False,
                                date_mapped=func.now(),
                            )
                            tasks_created += 1

                        if not task_exists.validated:
                            # Detect self-validation (mapper validated their own work)
                            is_self_validated = task_exists.mapped_by == c["username"]

                            # Update task status
                            task_exists.update(
                                validated_by=c["username"],
                                unknown_validator=False,
                                validated=True,
                                invalidated=False,
                                self_validated=is_self_validated,
                                date_validated=func.now(),
                            )

                            # Create UserTasks entry for validator (for validator dashboard)
                            validator_task_link = UserTasks.query.filter_by(
                                user_id=validator_exists.id, task_id=task_exists.id
                            ).first()
                            if not validator_task_link:
                                UserTasks.create(
                                    user_id=validator_exists.id, task_id=task_exists.id
                                )

                            # Skip self-validated tasks (just log it)
                            if is_self_validated:
                                current_app.logger.warning(
                                    f"Self-validation detected: {c['username']} validated their own task {task}"
                                )
                                continue

                            tasks_validated += 1
                        else:
                            tasks_skipped += 1
                    except Exception as e:
                        current_app.logger.error(
                            f"Error processing validation of task {task} by "
                            f"{c['username']} on project {project_id}: {e}"
                        )
                        db.session.rollback()

                current_app.logger.info(
                    f"Validator {c['username']} on project {project_id}: "
                    f"created={tasks_created}, validated={tasks_validated}, "
                    f"skipped={tasks_skipped}"
                )
            else:
                # Handle external validators (not in our system)
                for task in c.get("validatedTasks", []):
                    task_exists = Task.query.filter_by(
                        task_id=task, project_id=project_id
                    ).first()

                    if task_exists is not None:
                        if not task_exists.validated and not task_exists.validated_by:
                            task_exists.update(
                                validated_by=c["username"],
                                validated=False,
                                unknown_validator=True,
                            )

        return {"response": "complete"}

    def _apply_tm4_task_status(self, target_task, task_data):
        """
        Apply one TM4 task-status payload to a Task row. Returns True if the
        task was newly marked invalidated.

        Split out of the fetch loop so the HTTP calls can run concurrently
        while every mutation stays on the calling thread, which is the one
        holding the Flask app context and the DB session.
        """
        tm4_task_id = target_task.task_id
        task_status = task_data.get("taskStatus")
        task_history = task_data.get("taskHistory", [])

        # Track parent_task_id for split tasks
        parent_task_id = task_data.get("parentTaskId")
        if parent_task_id and target_task.parent_task_id != parent_task_id:
            # TM4 always splits into exactly 4 children
            target_task.update(parent_task_id=parent_task_id, sibling_count=4)

        # Only mark as invalidated if CURRENT status is INVALIDATED.
        # Do NOT use historical invalidations — a task that was
        # invalidated then re-mapped and re-validated is currently valid.
        if task_status != "INVALIDATED":
            return False

        # Find invalidation actions in history for validator info.
        # Sorted descending by actionDate so [0] is the most recent.
        invalidation_actions = sorted(
            [
                h
                for h in task_history
                if h.get("action") == "STATE_CHANGE"
                and h.get("actionText") == "INVALIDATED"
            ],
            key=lambda h: h.get("actionDate", ""),
            reverse=True,
        )

        validator_username = None
        if invalidation_actions:
            validator_username = invalidation_actions[0].get("actionBy")
        elif task_history:
            validator_username = task_history[0].get("actionBy")

        if validator_username:
            target_task.update(validated_by=validator_username)

        target_task.update(
            invalidated=True,
            validated=False,
            date_validated=func.now(),
        )

        if not self._should_count_invalidation(target_task):
            current_app.logger.info(
                f"Split task {tm4_task_id} invalidated but not all siblings "
                f"invalidated yet - deferring stats update"
            )
            return False

        current_app.logger.info(f"Marked task {tm4_task_id} as INVALIDATED")
        return True

    def get_invalidated_TM4_tasks(self, project_id, user_ids=None):
        """
        Check TM4 for tasks that have since been invalidated.

        One request per candidate task is unavoidable — TM4 exposes task
        status only per task — but two things keep that from consuming the
        whole nightly sync:

        * The candidate set is DISTINCT across users and resolved once per
          project. Previously this ran once per assigned user, so a task
          linked to both its mapper and its validator was fetched twice, and
          every project-wide pass was repeated N times over.
        * The fetches run through a bounded thread pool. They are read-only;
          results are applied serially afterwards.

        Pass ``user_ids`` to restrict the candidates to those users' tasks
        (single-user, on-demand syncs). ``None`` checks every linked task in
        the project, which is a superset of what the old per-user loop
        covered — a task whose only linked user fell outside the resolved set
        was previously never checked at all.
        """
        headers = self._get_tm4_headers()
        base_url = self._get_tm4_base_url()
        target_project = Project.query.filter_by(id=project_id).first()

        if not target_project:
            return {"response": "project not found"}

        tasks_query = Task.query.join(UserTasks, UserTasks.task_id == Task.id).filter(
            Task.project_id == project_id,
            Task.invalidated.isnot(True),
        )
        if user_ids:
            tasks_query = tasks_query.filter(UserTasks.user_id.in_(user_ids))
        tasks_to_check = tasks_query.distinct().all()

        tasks_checked = len(tasks_to_check)
        current_app.logger.info(
            f"get_invalidated_TM4_tasks: project={project_id}, "
            f"tasks_to_check={tasks_checked}, "
            f"user_scope={'all' if not user_ids else len(user_ids)}"
        )
        if not tasks_to_check:
            return {"response": "complete", "tasks_checked": 0, "invalidated": 0}

        # A Session per thread, not one shared across them: requests does not
        # document Session as thread-safe, and the connection pooling we want
        # is per-connection anyway. threading.local gives each worker its own.
        local = threading.local()

        def _session():
            session = getattr(local, "session", None)
            if session is None:
                session = requests.Session()
                local.session = session
            return session

        def _fetch(target_task):
            """HTTP only — no DB, no app context. Returns (task, json, error)."""
            url = f"{base_url}/projects/{project_id}/tasks/{target_task.task_id}/"
            try:
                resp = _session().get(url, headers=headers, timeout=30)
            except requests.RequestException as e:
                return target_task, None, f"request error: {e}"
            if not resp.ok:
                return target_task, None, f"HTTP {resp.status_code}"
            try:
                return target_task, resp.json(), None
            except ValueError as e:
                return target_task, None, f"bad JSON: {e}"

        with ThreadPoolExecutor(max_workers=self._TM4_TASK_FETCH_WORKERS) as pool:
            fetched = list(pool.map(_fetch, tasks_to_check))

        invalidated = 0
        errors = 0
        for target_task, task_data, error in fetched:
            if error:
                errors += 1
                current_app.logger.warning(
                    f"TM4 task status fetch failed for task "
                    f"{target_task.task_id}: {error}"
                )
                continue
            try:
                if self._apply_tm4_task_status(target_task, task_data):
                    invalidated += 1
            except Exception as e:
                errors += 1
                db.session.rollback()
                current_app.logger.error(
                    f"Error applying TM4 status for task " f"{target_task.task_id}: {e}"
                )

        current_app.logger.info(
            f"get_invalidated_TM4_tasks complete: project={project_id}, "
            f"tasks_checked={tasks_checked}, invalidated={invalidated}, "
            f"errors={errors}"
        )
        return {
            "response": "complete",
            "tasks_checked": tasks_checked,
            "invalidated": invalidated,
            "errors": errors,
        }

    def get_mapped_TM4_tasks(self, data, project_id):
        """
        Process mapped tasks from TM4 contributions data.

        Creates new task records for tasks not yet in the system.
        """
        target_project = Project.query.filter_by(id=project_id).first()

        if not target_project:
            current_app.logger.error(f"Project {project_id} not found")
            return {"message": "project not found"}

        # Scope contributor matching to the project's org (was User.query.all()
        # across every org — a cross-org leak).
        users = users_repo.by_org(target_project.org_id)
        usernames = [x.osm_username for x in users]

        contributions = data.get("userContributions", [])
        current_app.logger.info(
            f"get_mapped_TM4_tasks: project={project_id}, "
            f"contributors={len(contributions)}, mikro_users={len(usernames)}"
        )

        tasks_created = 0
        tasks_skipped = 0

        for contributor in contributions:
            contrib_username = contributor.get("username", "")
            mapped_tasks = contributor.get("mappedTasks", [])

            if contrib_username in usernames:
                mapper = users_repo.by_osm_username(
                    contrib_username, target_project.org_id
                )

                if not mapper:
                    current_app.logger.warning(
                        f"User {contrib_username} in usernames but not found in DB"
                    )
                    continue

                current_app.logger.info(
                    f"Processing {len(mapped_tasks)} mapped tasks for user {contrib_username} (id={mapper.id})"
                )

                for task in mapped_tasks:
                    task_exists = Task.query.filter_by(
                        task_id=task,
                        project_id=project_id,
                    ).first()

                    if task_exists is None:
                        new_task = Task.create(
                            task_id=task,
                            org_id=target_project.org_id,
                            project_id=project_id,
                            mapping_rate=target_project.mapping_rate_per_task,
                            validation_rate=target_project.validation_rate_per_task,
                            paid_out=False,
                            mapped=True,
                            mapped_by=contrib_username,
                            validated_by="",
                            validated=False,
                            date_mapped=func.now(),
                        )
                        UserTasks.create(user_id=mapper.id, task_id=new_task.id)
                        tasks_created += 1
                        current_app.logger.info(
                            f"Created task {task} for mapper {contrib_username}, "
                            f"internal_id={new_task.id}"
                        )
                        target_task = new_task

                        # Only fetch parent_task_id for newly created tasks — checking
                        # existing tasks on every sync causes N+1 API calls on large projects.
                        if not target_task.parent_task_id:
                            try:
                                tm4_base_url = self._get_tm4_base_url()
                                headers = self._get_tm4_headers()
                                task_detail_url = f"{tm4_base_url}/projects/{project_id}/tasks/{task}/"
                                task_detail_call = requests.get(
                                    task_detail_url, headers=headers, timeout=10
                                )
                                if task_detail_call.ok:
                                    task_data = task_detail_call.json()
                                    parent_task_id = task_data.get("parentTaskId")
                                    if parent_task_id:
                                        # TM4 always splits into exactly 4 children
                                        target_task.update(
                                            parent_task_id=parent_task_id,
                                            sibling_count=4,
                                        )
                                        current_app.logger.info(
                                            f"Task {task} is a split child of parent task {parent_task_id} (sibling_count=4)"
                                        )
                                else:
                                    current_app.logger.warning(
                                        f"TM4 task detail call failed for task {task}: "
                                        f"status={task_detail_call.status_code}"
                                    )
                            except requests.RequestException as e:
                                current_app.logger.warning(
                                    f"Could not fetch task details for {task}: {e}"
                                )
                    else:
                        tasks_skipped += 1
                        # Update mapped_by if task was reassigned in TM4
                        if task_exists.mapped_by != contrib_username:
                            current_app.logger.info(
                                f"Task {task} reassigned: {task_exists.mapped_by} -> {contrib_username}"
                            )
                            task_exists.update(mapped_by=contrib_username)
                        # Ensure UserTasks link exists (may have been missing)
                        user_task_link = UserTasks.query.filter_by(
                            user_id=mapper.id, task_id=task_exists.id
                        ).first()
                        if not user_task_link:
                            UserTasks.create(user_id=mapper.id, task_id=task_exists.id)
                            current_app.logger.info(
                                f"Created missing UserTasks link for existing task {task}"
                            )
                        # Backfill parent_task_id for existing split tasks created before
                        # this field was tracked. Guard prevents N+1 once populated.
                        if not task_exists.parent_task_id:
                            try:
                                tm4_base_url = self._get_tm4_base_url()
                                headers = self._get_tm4_headers()
                                task_detail_url = f"{tm4_base_url}/projects/{project_id}/tasks/{task}/"
                                task_detail_call = requests.get(
                                    task_detail_url, headers=headers, timeout=10
                                )
                                if task_detail_call.ok:
                                    task_data = task_detail_call.json()
                                    parent_task_id = task_data.get("parentTaskId")
                                    if parent_task_id:
                                        task_exists.update(
                                            parent_task_id=parent_task_id,
                                            sibling_count=4,
                                        )
                                        current_app.logger.info(
                                            f"Backfilled parent_task_id={parent_task_id} for existing task {task}"
                                        )
                                else:
                                    current_app.logger.warning(
                                        f"TM4 task detail call failed for task {task}: "
                                        f"status={task_detail_call.status_code}"
                                    )
                            except requests.RequestException as e:
                                current_app.logger.warning(
                                    f"Could not fetch task details for {task}: {e}"
                                )

        current_app.logger.info(
            f"get_mapped_TM4_tasks complete: project={project_id}, "
            f"created={tasks_created}, skipped={tasks_skipped}"
        )
        return {"message": "complete"}

    def get_invalidated_TM4_tasks_from_contributions(self, data, project_id):
        """
        Process invalidated tasks from TM4 contributions data.

        TM4 now includes invalidatedTasks in the contributions response.
        This creates task records for invalidated tasks and updates stats.
        """
        target_project = Project.query.filter_by(id=project_id).first()

        if not target_project:
            current_app.logger.error(f"Project {project_id} not found")
            return {"message": "project not found"}

        # Scope contributor matching to the project's org (was User.query.all()
        # across every org — a cross-org leak).
        users = users_repo.by_org(target_project.org_id)
        usernames = [x.osm_username for x in users]

        for contributor in data.get("userContributions", []):
            if contributor["username"] not in usernames:
                continue

            mapper = users_repo.by_osm_username(
                contributor["username"], target_project.org_id
            )

            if not mapper:
                continue

            invalidated_tasks = contributor.get("invalidatedTasks", [])
            if not invalidated_tasks:
                continue

            current_app.logger.info(
                f"Processing {len(invalidated_tasks)} invalidated tasks for user {mapper.osm_username}"
            )

            for task_id in invalidated_tasks:
                # Check if task already exists in our system
                task_exists = Task.query.filter_by(
                    task_id=task_id,
                    project_id=project_id,
                ).first()

                if task_exists:
                    # Task exists - check if we need to mark it as invalidated
                    if not task_exists.invalidated:
                        current_app.logger.info(
                            f"Marking existing task {task_id} as invalidated for user {mapper.osm_username}"
                        )
                        task_exists.update(
                            invalidated=True,
                            validated=False,
                            date_validated=func.now(),
                        )
                else:
                    # Task doesn't exist - create it as an invalidated task
                    current_app.logger.info(
                        f"Creating new invalidated task {task_id} for user {mapper.osm_username}"
                    )
                    new_task = Task.create(
                        task_id=task_id,
                        org_id=mapper.org_id,
                        project_id=project_id,
                        mapping_rate=target_project.mapping_rate_per_task,
                        validation_rate=target_project.validation_rate_per_task,
                        paid_out=False,
                        mapped=True,
                        mapped_by=mapper.osm_username,
                        validated_by="",
                        validated=False,
                        invalidated=True,
                        date_mapped=func.now(),
                        date_validated=func.now(),
                    )
                    UserTasks.create(user_id=mapper.id, task_id=new_task.id)

        return {"message": "complete"}

    def sync_tm4_project(self, project_id, user_ids=None):
        """
        Sync one TM4 project. Every project-scoped step runs exactly once.

        This replaces a per-user loop that called the whole of this function
        once for each assigned user. The two endpoints it hits --
        ``/projects/{id}/contributions/`` and ``/projects/{id}/`` -- are
        project-wide and their responses do not vary by user, and the three
        contribution parsers are project-scoped as well. So a project with 20
        assigned users re-fetched the same two payloads 20 times and re-parsed
        every contribution 20 times, writing the same rows over and over.
        That is what kept the nightly sync from ever reaching most projects:
        39 of 45 active TM4 projects had never been synced once.

        ``user_ids`` narrows only the per-task invalidation check, which is
        the one genuinely user-scoped step; None checks every linked task.
        """
        headers = self._get_tm4_headers()
        base_url = self._get_tm4_base_url()
        tm4_url = f"{base_url}/projects/{project_id}/contributions/"

        try:
            response = requests.get(tm4_url, headers=headers, timeout=60)
        except requests.RequestException as e:
            current_app.logger.error(f"TM4 API error: {e}")
            return {"message": f"TM4 API error: {str(e)}"}

        if not response.ok:
            current_app.logger.error(
                f"TM4 contributions call failed: {response.status_code} "
                f"project={project_id} url={tm4_url}"
            )
            return {
                "message": "TM4 API call failed",
                "status": response.status_code,
            }

        data = response.json()
        self.get_mapped_TM4_tasks(data, project_id)
        self.get_validated_TM4_tasks(data, project_id)
        # Invalidated tasks now come through the contributions endpoint.
        self.get_invalidated_TM4_tasks_from_contributions(data, project_id)
        # The per-task check still catches tasks created before that TM4
        # enhancement, and is where split parent/sibling data comes from.
        self.get_invalidated_TM4_tasks(project_id, user_ids=user_ids)

        # Refresh total_tasks and tasks_overlap from the TM4 project endpoint
        try:
            proj_url = f"{base_url}/projects/{project_id}/"
            proj_resp = requests.get(proj_url, headers=headers, timeout=30)
            if proj_resp.ok:
                proj_data = proj_resp.json()
                proj_info = proj_data.get("projectInfo", {})
                new_total = proj_info.get("totalTasks")
                new_overlap = proj_info.get("tasksOverlap", 0) or 0
                project = Project.query.get(project_id)
                if project and new_total:
                    project.total_tasks = new_total
                    project.tasks_overlap = new_overlap
                    db.session.commit()
        except Exception as e:
            current_app.logger.warning(
                f"Could not refresh total_tasks for TM4 project {project_id}: {e}"
            )

        return {"message": "updated!"}

    @requires_team_admin_or_above
    def admin_update_all_user_tasks(self):
        """
        Queue a background sync job for all users in the organization.

        Creates a SyncJob record that the background worker picks up.
        Returns immediately instead of blocking the request.
        """
        if not g.user:
            return {"message": "User not found", "status": 304}

        job, _ = SyncJobQueue.enqueue_task_sync(g.user.org_id)

        return {
            "message": "Task sync queued — running in background",
            "job_id": job.id,
            "status": 200,
        }

    @requires_team_admin_or_above
    def sync_project(self):
        """Queue a background sync for a single project.

        Open to all admin tiers — team_admin owners need to be able to
        kick a per-project sync (the "Sync" row action on /admin/projects)
        without bouncing off an Org Admin. Cross-org safety stays via the
        ``org_id=g.user.org_id`` filter on the project lookup below.
        """
        if not g.user:
            return {"message": "User not found", "status": 304}

        project_id = request.json.get("project_id")
        if not project_id:
            return {"message": "project_id required", "status": 400}

        project = Project.query.filter_by(id=project_id, org_id=g.user.org_id).first()
        if not project:
            return {"message": "Project not found", "status": 404}

        job, _ = SyncJobQueue.enqueue_project_sync(g.user.org_id, project_id)

        current_app.logger.info(
            f"Project sync queued: job {job.id}, project {project_id} ({project.name})"
        )

        return {
            "message": f"Sync queued for {project.name}",
            "job_id": job.id,
            "status": 200,
        }

    @requires_admin
    def sync_user_projects(self):
        """Sync all projects a user is assigned to (direct + team)."""
        user_id = (request.json or {}).get("user_id")
        if not user_id:
            return {"message": "user_id required", "status": 400}

        user = UserScope(g.user).get(user_id)
        if not user:
            return {"message": "User not found", "status": 404}

        # Direct project assignments
        direct_ids = {
            pu.project_id for pu in ProjectUser.query.filter_by(user_id=user_id).all()
        }

        # Team-based project assignments
        team_ids = {
            tu.team_id for tu in TeamUser.query.filter_by(user_id=user_id).all()
        }
        team_project_ids = set()
        if team_ids:
            team_project_ids = {
                pt.project_id
                for pt in ProjectTeam.query.filter(
                    ProjectTeam.team_id.in_(team_ids)
                ).all()
            }

        all_project_ids = direct_ids | team_project_ids
        if not all_project_ids:
            return {"message": "User has no project assignments", "status": 200}

        org_id = g.user.org_id

        # Queue ONE job per unique project
        queued = []
        for pid in all_project_ids:
            project = Project.query.get(pid)
            if not project or project.org_id != org_id:
                continue
            job, _ = SyncJobQueue.enqueue_project_sync(org_id, pid, user_id=user_id)
            queued.append(
                {"project_id": pid, "project_name": project.name, "job_id": job.id}
            )

        return {
            "message": f"Queued sync for {len(queued)} project(s)",
            "syncs": queued,
            "status": 200,
        }

    def check_sync_status(self):
        """Check the status of the latest sync job for the current org."""
        if not g.user:
            return {"message": "User not found", "status": 304}

        # Prefer active (queued/running) job, fall back to latest by ID
        job = (
            SyncJob.query.filter(
                SyncJob.org_id == g.user.org_id,
                SyncJob.status.in_(["queued", "running"]),
            )
            .order_by(SyncJob.id.desc())
            .first()
        )
        if not job:
            job = (
                SyncJob.query.filter_by(org_id=g.user.org_id)
                .order_by(SyncJob.id.desc())
                .first()
            )

        if not job:
            return {"message": "No sync jobs found", "status": 200}

        return {
            "job_id": job.id,
            "status": 200,
            "sync_status": job.status,
            "job_type": job.job_type,
            "progress": job.progress,
            "started_at": job.started_at.isoformat() if job.started_at else None,
            "completed_at": job.completed_at.isoformat() if job.completed_at else None,
            "error": job.error,
        }
