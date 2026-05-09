#!/usr/bin/env python3
"""
Task API endpoints for Mikro.

Handles task synchronization with TM4 (Tasking Manager 4).
TM3 support has been removed.
"""

import requests

from sqlalchemy import func
from flask.views import MethodView
from flask import g, request, current_app

from ..utils import requires_admin, requires_team_admin_or_above
from ..auth import managed_team_ids_for
from .MapRoulette import MapRouletteSync
from ..database import (
    Project,
    Task,
    ProjectUser,
    ProjectTeam,
    TeamUser,
    UserTasks,
    User,
    ValidatorTaskAction,
    SyncJob,
    db,
)


from .split_task_helpers import (
    is_split_task,
    get_split_siblings,
    should_count_validation,
    should_count_invalidation,
)


class TaskAPI(MethodView):
    """Task management API endpoints for TM4 integration."""

    # Delegate split-task helpers to shared module (SSOT)
    def _is_split_task(self, task):
        return is_split_task(task)

    def _get_split_siblings(self, task):
        return get_split_siblings(task)

    def _should_count_validation(self, task):
        return should_count_validation(task)

    def _should_count_invalidation(self, task):
        return should_count_invalidation(task)

    def post(self, path: str):
        """Route POST requests to appropriate handler."""
        if path == "update_user_tasks":
            return self.update_user_tasks()
        elif path == "admin_update_all_user_tasks":
            return self.admin_update_all_user_tasks()
        elif path == "check_sync_status":
            return self.check_sync_status()
        elif path == "fetch_external_validations":
            return self.admin_fetch_external_validations()
        elif path == "update_task":
            return self.update_task()
        elif path == "purge_all_task_stats":
            return self.purge_all_task_stats()
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
        users = User.query.all()
        usernames = [x.osm_username for x in users]
        contributions = data.get("userContributions", [])
        target_project = Project.query.filter_by(id=project_id).first()

        if not target_project:
            current_app.logger.error(f"Project {project_id} not found")
            return {"response": "project not found"}

        # Build reverse lookup: task_id -> mapper username from contributions
        task_to_mapper = {}
        for contrib in contributions:
            for t in contrib.get("mappedTasks", []):
                task_to_mapper[t] = contrib["username"]

        for c in contributions:
            validator_exists = User.query.filter_by(
                osm_username=c["username"]
            ).first()

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
                        # Look up mapper — may be None if mapper is not in Mikro
                        mapper = User.query.filter_by(
                            osm_username=task_exists.mapped_by
                        ).first()

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
                            UserTasks.create(user_id=validator_exists.id, task_id=task_exists.id)

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
                        if (
                            not task_exists.validated
                            and not task_exists.validated_by
                        ):
                            task_exists.update(
                                validated_by=c["username"],
                                validated=False,
                                unknown_validator=True,
                            )

        return {"response": "complete"}

    def get_invalidated_TM4_tasks(self, project_id, user):
        """
        Check for invalidated tasks for a user's mapped tasks.

        Queries TM4 API for individual task status.
        """
        user_tasks = UserTasks.query.filter_by(user_id=user.id).all()
        # UserTasks.task_id is a FK to Task.id (internal DB ID)
        internal_task_ids = [relation.task_id for relation in user_tasks]
        headers = self._get_tm4_headers()
        base_url = self._get_tm4_base_url()
        target_project = Project.query.filter_by(id=project_id).first()

        current_app.logger.info(
            f"get_invalidated_TM4_tasks: user={user.id}, project={project_id}, "
            f"user_tasks_count={len(user_tasks)}, internal_task_ids={internal_task_ids}"
        )

        if not target_project:
            return {"response": "project not found"}

        tasks_checked = 0
        tasks_in_project = 0
        for internal_task_id in internal_task_ids:
            target_user = User.query.filter_by(id=user.id).first()
            # Query by internal Task.id, not Task.task_id (TM4 ID)
            target_task = Task.query.filter_by(id=internal_task_id).first()

            if not target_task:
                current_app.logger.warning(f"Task with internal id {internal_task_id} not found in DB")
                continue

            if target_task.project_id != project_id:
                continue  # Skip tasks from other projects

            tasks_in_project += 1
            current_app.logger.info(
                f"Checking task: internal_id={internal_task_id}, tm4_id={target_task.task_id}, "
                f"project={target_task.project_id}, validated={target_task.validated}, "
                f"invalidated={target_task.invalidated}"
            )

            if not target_task.invalidated:
                tasks_checked += 1
                # Use Task.task_id (TM4 ID) for API call
                tm4_task_id = target_task.task_id
                invalid_tasks_url = f"{base_url}/projects/{project_id}/tasks/{tm4_task_id}/"

                try:
                    tasks_invalidated_call = requests.get(
                        invalid_tasks_url, headers=headers, timeout=30
                    )

                    if tasks_invalidated_call.ok:
                        task_data = tasks_invalidated_call.json()
                        task_status = task_data.get("taskStatus")
                        task_history = task_data.get("taskHistory", [])

                        # Track parent_task_id for split tasks
                        parent_task_id = task_data.get("parentTaskId")
                        if parent_task_id and target_task.parent_task_id != parent_task_id:
                            # TM4 always splits into exactly 4 children
                            target_task.update(parent_task_id=parent_task_id, sibling_count=4)

                        # Find invalidation actions in history for validator info
                        invalidation_actions = [
                            h for h in task_history
                            if h.get("action") == "STATE_CHANGE" and h.get("actionText") == "INVALIDATED"
                        ]

                        # Log task status for debugging
                        current_app.logger.info(
                            f"TM4 task {tm4_task_id}: status={task_status}, "
                            f"history_count={len(task_history)}, "
                            f"invalidation_actions={len(invalidation_actions)}"
                        )

                        # Only mark as invalidated if CURRENT status is INVALIDATED
                        # Do NOT use historical invalidations — a task that was
                        # invalidated then re-mapped and re-validated is currently valid
                        if task_status == "INVALIDATED":
                            # Get validator info from the invalidation action
                            validator_username = None
                            if invalidation_actions:
                                # Use the most recent invalidation action
                                validator_username = invalidation_actions[0].get("actionBy")
                            elif task_history:
                                # Fallback to first history entry
                                validator_username = task_history[0].get("actionBy")

                            if validator_username:
                                target_task.update(validated_by=validator_username)

                            # Update task status (always mark as invalidated)
                            target_task.update(
                                invalidated=True,
                                validated=False,
                                date_validated=func.now(),
                            )

                            # For split tasks, only update stats when ALL siblings are invalidated
                            if not self._should_count_invalidation(target_task):
                                current_app.logger.info(
                                    f"Split task {tm4_task_id} invalidated but not all siblings invalidated yet - deferring stats update"
                                )
                                continue

                            current_app.logger.info(
                                f"Marked task {tm4_task_id} as INVALIDATED for user {target_user.id}"
                            )
                    else:
                        current_app.logger.warning(
                            f"TM4 task status call failed for task {tm4_task_id}: {tasks_invalidated_call.status_code}"
                        )
                except requests.RequestException as e:
                    current_app.logger.error(f"TM4 API error for task {tm4_task_id}: {e}")

        current_app.logger.info(
            f"get_invalidated_TM4_tasks complete: project={project_id}, "
            f"tasks_in_project={tasks_in_project}, tasks_checked={tasks_checked}"
        )
        return {"response": "complete"}

    def get_mapped_TM4_tasks(self, data, project_id):
        """
        Process mapped tasks from TM4 contributions data.

        Creates new task records for tasks not yet in the system.
        """
        users = User.query.all()
        usernames = [x.osm_username for x in users]
        target_project = Project.query.filter_by(id=project_id).first()

        if not target_project:
            current_app.logger.error(f"Project {project_id} not found")
            return {"message": "project not found"}

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
                mapper = User.query.filter_by(
                    osm_username=contrib_username
                ).first()

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
                        target_task = task_exists

                    # Fetch individual task details from TM4 to get parent_task_id (for split tasks)
                    if target_task and not target_task.parent_task_id:
                        try:
                            tm4_base_url = self._get_tm4_base_url()
                            headers = self._get_tm4_headers()
                            task_detail_url = f"{tm4_base_url}/projects/{project_id}/tasks/{task}/"
                            task_detail_call = requests.get(task_detail_url, headers=headers, timeout=10)
                            if task_detail_call.ok:
                                task_data = task_detail_call.json()
                                parent_task_id = task_data.get("parentTaskId")
                                if parent_task_id:
                                    # TM4 always splits into exactly 4 children
                                    target_task.update(
                                        parent_task_id=parent_task_id,
                                        sibling_count=4
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
                            current_app.logger.warning(f"Could not fetch task details for {task}: {e}")

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
        users = User.query.all()
        usernames = [x.osm_username for x in users]
        target_project = Project.query.filter_by(id=project_id).first()

        if not target_project:
            current_app.logger.error(f"Project {project_id} not found")
            return {"message": "project not found"}

        for contributor in data.get("userContributions", []):
            if contributor["username"] not in usernames:
                continue

            mapper = User.query.filter_by(
                osm_username=contributor["username"]
            ).first()

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

    def fetch_invalidated_tasks_from_tm4(self, project_id, user):
        """
        Fetch invalidated tasks from TM4's dedicated invalidation endpoint.

        When TM4 invalidates a task, it clears mapped_by, so the task
        disappears from the contributions endpoint. This method calls
        the dedicated invalidation endpoint to get tasks that were invalidated.

        Endpoint: /api/v2/projects/{project_id}/tasks/queries/own/invalidated/
        """
        headers = self._get_tm4_headers()
        base_url = self._get_tm4_base_url()
        target_project = Project.query.filter_by(id=project_id).first()

        if not target_project:
            current_app.logger.error(f"Project {project_id} not found")
            return {"response": "project not found"}

        # TM4 requires the user's OSM username for this endpoint
        # The endpoint returns tasks where user was the original mapper that got invalidated
        invalidated_url = f"{base_url}/projects/{project_id}/tasks/queries/own/invalidated/"

        current_app.logger.info(
            f"fetch_invalidated_tasks_from_tm4: user={user.osm_username}, project={project_id}, url={invalidated_url}"
        )

        try:
            response = requests.get(invalidated_url, headers=headers, timeout=30)

            if response.ok:
                data = response.json()
                invalidated_tasks = data.get("invalidatedTasks", [])

                current_app.logger.info(
                    f"TM4 invalidation endpoint returned {len(invalidated_tasks)} tasks for user {user.osm_username}"
                )

                for task_info in invalidated_tasks:
                    task_id = task_info.get("taskId")
                    if not task_id:
                        continue

                    # Check if task already exists
                    existing_task = Task.query.filter_by(
                        task_id=task_id,
                        project_id=project_id,
                    ).first()

                    if existing_task:
                        # Task exists - update invalidation status if needed
                        if not existing_task.invalidated:
                            current_app.logger.info(
                                f"Updating existing task {task_id} to invalidated"
                            )
                            existing_task.update(
                                invalidated=True,
                                validated=False,
                            )
                    else:
                        # Task doesn't exist - create it as invalidated
                        current_app.logger.info(
                            f"Creating new invalidated task {task_id} for user {user.osm_username}"
                        )
                        new_task = Task.create(
                            task_id=task_id,
                            org_id=user.org_id,
                            project_id=project_id,
                            mapping_rate=target_project.mapping_rate_per_task,
                            validation_rate=target_project.validation_rate_per_task,
                            paid_out=False,
                            mapped=True,
                            mapped_by=user.osm_username,
                            validated_by=task_info.get("invalidatedBy", ""),
                            validated=False,
                            invalidated=True,
                            date_mapped=func.now(),
                            date_validated=func.now(),
                        )
                        UserTasks.create(user_id=user.id, task_id=new_task.id)

                return {"response": "complete", "count": len(invalidated_tasks)}
            else:
                current_app.logger.warning(
                    f"TM4 invalidation endpoint failed: {response.status_code} - {response.text}"
                )
                return {"response": "failed", "status": response.status_code}
        except requests.RequestException as e:
            current_app.logger.error(f"TM4 invalidation API error: {e}")
            return {"response": "error", "error": str(e)}

    def TM4_payment_call(self, project_id, user):
        """
        Fetch contributions from TM4 and update local task records.

        Args:
            project_id: The TM4 project ID
            user: The user to update tasks for
        """
        headers = self._get_tm4_headers()
        base_url = self._get_tm4_base_url()
        tm4_url = f"{base_url}/projects/{project_id}/contributions/"

        try:
            response = requests.get(tm4_url, headers=headers, timeout=60)

            if response.ok:
                data = response.json()
                self.get_mapped_TM4_tasks(data, project_id)
                self.get_validated_TM4_tasks(data, project_id)
                # Process invalidated tasks from contributions response
                # TM4 now includes invalidatedTasks in the contributions endpoint
                self.get_invalidated_TM4_tasks_from_contributions(data, project_id)
                # Also check existing tasks for invalidation via status/history
                # This handles tasks created before the TM4 enhancement
                self.get_invalidated_TM4_tasks(project_id, user)

                # Refresh total_tasks and tasks_overlap from TM4 project endpoint
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
            else:
                current_app.logger.error(
                    f"TM4 contributions call failed: {response.status_code}"
                )
                return {"message": "TM4 API call failed", "status": response.status_code}
        except requests.RequestException as e:
            current_app.logger.error(f"TM4 API error: {e}")
            return {"message": f"TM4 API error: {str(e)}"}

    def update_user_tasks(self):
        """
        Update tasks for the current user from TM4.

        Syncs mapped, validated, and invalidated tasks.
        Includes both assigned projects AND public (visible) projects.
        """
        if not g.user:
            return {"message": "User not found", "status": 304}

        # Get user's explicitly assigned projects
        assigned_project_ids = [
            relation.project_id
            for relation in ProjectUser.query.filter_by(user_id=g.user.id).all()
        ]

        # Get all active projects in org (assigned + public/visible)
        user_projects = Project.query.filter(
            Project.org_id == g.user.org_id,
            Project.status == True,
        ).filter(
            # Include if assigned OR if visible to users
            (Project.id.in_(assigned_project_ids)) | (Project.visibility == True)
        ).all()

        # Queue background sync jobs instead of running inline
        # (MR syncs can take minutes and kill the gunicorn worker)
        org_id = g.user.org_id
        user_id = g.user.id

        # Clear stale jobs first
        stale = SyncJob.query.filter(
            SyncJob.org_id == org_id,
            SyncJob.status.in_(["running", "queued"]),
        ).all()
        for sj in stale:
            sj.status = "failed"
            sj.error = "Cleared by update_user_tasks"
        if stale:
            db.session.commit()

        queued = 0
        for project in user_projects:
            SyncJob.create(
                org_id=org_id,
                status="queued",
                job_type="project_sync",
                target_id=project.id,
                progress=f"user:{user_id}",
            )
            queued += 1

        return {"message": f"Sync queued for {queued} project(s)", "status": 200}

    @requires_admin
    def admin_update_all_user_tasks(self):
        """
        Queue a background sync job for all users in the organization.

        Creates a SyncJob record that the background worker picks up.
        Returns immediately instead of blocking the request.
        """
        if not g.user:
            return {"message": "User not found", "status": 304}

        # Check if a sync is already running
        running_job = SyncJob.query.filter_by(
            org_id=g.user.org_id, status="running"
        ).first()
        if running_job:
            return {
                "message": "Sync already in progress",
                "job_id": running_job.id,
                "progress": running_job.progress,
                "status": 200,
            }

        # Create a new sync job (worker picks it up)
        job = SyncJob.create(
            org_id=g.user.org_id,
            status="queued",
        )

        return {
            "message": "Task sync queued — running in background",
            "job_id": job.id,
            "status": 200,
        }

    @requires_admin
    def sync_project(self):
        """Queue a background sync for a single project."""
        if not g.user:
            return {"message": "User not found", "status": 304}

        project_id = request.json.get("project_id")
        if not project_id:
            return {"message": "project_id required", "status": 400}

        project = Project.query.filter_by(
            id=project_id, org_id=g.user.org_id
        ).first()
        if not project:
            return {"message": "Project not found", "status": 404}

        # Check if a sync is already running for this org
        running_job = SyncJob.query.filter_by(
            org_id=g.user.org_id, status="running"
        ).first()
        if running_job:
            # If job has been running for >15 min, it's stale — mark it failed
            from datetime import datetime, timezone, timedelta

            if running_job.started_at:
                age = datetime.now(timezone.utc) - running_job.started_at.replace(
                    tzinfo=timezone.utc
                )
                if age > timedelta(minutes=15):
                    current_app.logger.warning(
                        f"Marking stale running job {running_job.id} as failed "
                        f"(running for {age})"
                    )
                    running_job.status = "failed"
                    running_job.error = "Timed out (stale after 15 minutes)"
                    running_job.completed_at = datetime.now(timezone.utc)
                    db.session.commit()
                else:
                    return {
                        "message": "A sync is already in progress",
                        "job_id": running_job.id,
                        "progress": running_job.progress,
                        "status": 200,
                    }
            else:
                return {
                    "message": "A sync is already in progress",
                    "job_id": running_job.id,
                    "progress": running_job.progress,
                    "status": 200,
                }

        # Also check for queued jobs that haven't been picked up
        queued_job = SyncJob.query.filter_by(
            org_id=g.user.org_id, status="queued"
        ).first()
        if queued_job:
            current_app.logger.info(
                f"Sync already queued (job {queued_job.id}, type={queued_job.job_type})"
            )
            return {
                "message": "A sync is already queued",
                "job_id": queued_job.id,
                "status": 200,
            }

        # Queue a project-scoped sync job
        job = SyncJob.create(
            org_id=g.user.org_id,
            status="queued",
            job_type="project_sync",
            target_id=project_id,
        )

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

        user = User.query.get(user_id)
        if not user or user.org_id != g.user.org_id:
            return {"message": "User not found", "status": 404}

        # Direct project assignments
        direct_ids = {
            pu.project_id
            for pu in ProjectUser.query.filter_by(user_id=user_id).all()
        }

        # Team-based project assignments
        team_ids = {
            tu.team_id
            for tu in TeamUser.query.filter_by(user_id=user_id).all()
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

        # Clear any stale running/queued jobs first
        stale_jobs = SyncJob.query.filter(
            SyncJob.org_id == org_id,
            SyncJob.status.in_(["running", "queued"]),
        ).all()
        for sj in stale_jobs:
            sj.status = "failed"
            sj.error = "Cleared by sync_user_projects"
        if stale_jobs:
            db.session.commit()

        # Queue ONE job per unique project
        queued = []
        for pid in all_project_ids:
            project = Project.query.get(pid)
            if not project or project.org_id != org_id:
                continue
            job = SyncJob.create(
                org_id=org_id,
                status="queued",
                job_type="project_sync",
                target_id=pid,
                progress=f"user:{user_id}",
            )
            queued.append({"project_id": pid, "project_name": project.name, "job_id": job.id})

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

    @requires_team_admin_or_above
    def admin_fetch_external_validations(self):
        """
        Fetch tasks validated by users outside the organization.

        Returns tasks with unknown_validator=True. For team_admin,
        narrows to tasks in projects assigned to their managed teams.
        """
        if not g.user:
            return {"message": "User not found", "status": 304}

        unknown_validator_query = Task.query.filter_by(
            org_id=g.user.org_id, unknown_validator=True
        )

        if g.user.role == "team_admin":
            managed = managed_team_ids_for(g.user)
            if not managed:
                return {"external_validations": [], "status": 200}
            ta_project_ids = {
                pt.project_id
                for pt in ProjectTeam.query.filter(
                    ProjectTeam.team_id.in_(managed)
                ).all()
            }
            if not ta_project_ids:
                return {"external_validations": [], "status": 200}
            unknown_validator_query = unknown_validator_query.filter(
                Task.project_id.in_(ta_project_ids)
            )

        unknown_validator_tasks = unknown_validator_query.all()

        external_validations = []
        for task in unknown_validator_tasks:
            task_project = Project.query.filter_by(id=task.project_id).first()
            task_obj = {
                "id": task.id,
                "task_id": task.task_id,
                "project_id": task.project_id,
                "project_name": task_project.name if task_project else None,
                "project_short_name": (task_project.short_name or "") if task_project else "",
                "project_url": task_project.url if task_project else None,
                "validation_rate": task.validation_rate,
                "mapping_rate": task.mapping_rate,
                "paid_out": task.paid_out,
                "mapped": task.mapped,
                "validated": task.validated,
                "invalidated": task.invalidated,
                "mapped_by": task.mapped_by,
                "validated_by": task.validated_by,
                "unknown_validator": task.unknown_validator,
            }
            external_validations.append(task_obj)

        return {
            "external_validations": external_validations,
            "status": 200,
        }

    @requires_admin
    def update_task(self):
        """
        Manually update a task's validation status.

        Admin-only endpoint for handling external validations.
        """
        if not g.user:
            return {"message": "User not found", "status": 304}

        task_id = request.json.get("task_id")
        task_action = request.json.get("task_action")

        if not task_id:
            return {"message": "task_id required", "status": 400}
        if not task_action:
            return {"message": "task_action required", "status": 400}

        target_task = Task.query.filter_by(task_id=task_id).first()
        if not target_task:
            return {"message": "Task not found", "status": 404}

        target_project = Project.query.filter_by(id=target_task.project_id).first()
        target_mapper = User.query.filter_by(osm_username=target_task.mapped_by).first()

        if not target_mapper:
            return {"message": "Mapper not found", "status": 404}

        if task_action == "Validate":
            # Update task status first (always happens)
            target_task.update(
                validated=True,
                invalidated=False,
                validated_by=g.user.osm_username,
                unknown_validator=False,
            )

        elif task_action == "Invalidate":
            # Update task status first (always happens)
            target_task.update(
                validated=False,
                invalidated=True,
                validated_by=g.user.osm_username,
                unknown_validator=False,
            )

        else:
            return {"message": f"Invalid task_action: {task_action}", "status": 400}

        return {"message": "Task updated", "status": 200}

    @requires_admin
    def purge_all_task_stats(self):
        """
        DEV ONLY: Purge all task-related data from the database.

        This removes:
        - All task records
        - All user_tasks records
        - All validator_task_actions records
        - Resets all user task stats to 0
        - Resets all project task stats to 0

        Admin-only endpoint for development/testing.
        """
        if not g.user:
            return {"message": "User not found", "status": 401}, 401

        try:
            org_id = g.user.org_id

            # Delete all validator task actions for org
            ValidatorTaskAction.query.filter(
                ValidatorTaskAction.project_id.in_(
                    db.session.query(Project.id).filter(Project.org_id == org_id)
                )
            ).delete(synchronize_session=False)

            # Delete all user_tasks for org users
            org_user_ids = [u.id for u in User.query.filter_by(org_id=org_id).all()]
            UserTasks.query.filter(UserTasks.user_id.in_(org_user_ids)).delete(
                synchronize_session=False
            )

            # Delete all tasks for org
            Task.query.filter_by(org_id=org_id).delete(synchronize_session=False)

            db.session.commit()

            current_app.logger.warning(
                f"PURGE: All task data purged by admin {g.user.email} for org {org_id}"
            )

            return {
                "message": "All task data purged successfully",
                "status": 200,
            }

        except Exception as e:
            db.session.rollback()
            current_app.logger.error(f"Purge task stats failed: {e}")
            return {"message": f"Purge failed: {str(e)}", "status": 500}, 500
