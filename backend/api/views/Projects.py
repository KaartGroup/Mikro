#!/usr/bin/env python3
"""
Project API endpoints for Mikro.

Handles project management operations.
TM3 support has been removed - all projects are now TM4.
"""

import re
from datetime import datetime, timedelta

import requests
from flask.views import MethodView
from flask import g, request, current_app
from sqlalchemy import func, case, and_

from ..utils import requires_admin, requires_team_admin_or_above
from ..auth import (
    is_org_admin_or_above,
    managed_team_ids_for,
)
from ..filters import resolve_filtered_user_ids, get_user_country_ids, is_visible_by_location
from ..stats import count_tasks_split_aware, get_project_stats, get_project_stats_from_tasks, get_batch_project_stats, get_user_task_stats, get_user_payment_balances, get_batch_project_stats_fast
from .MapRoulette import MapRouletteSync
from ..database import (
    db,
    Country,
    Project,
    Task,
    PayRequests,
    Payments,
    ProjectUser,
    ProjectCountry,
    ProjectTraining,
    Training,
    UserTasks,
    User,
    TimeEntry,
    Team,
    ProjectTeam,
    TeamUser,
)


def _auto_parse_project_name(name):
    """Parse a project name to extract a short display name and country candidate.

    Returns (short_name or None, country_name or None).
    Country name is a *candidate* — caller must verify against the countries table.
    """
    if not name:
        return None, None

    short_name = None
    country_name = None

    # Pattern 1: MR naming convention
    # "1_Philippines_2026-01-26_23-56-21_ConstructionCheck #Kaart 2026 #MR57669"
    mr_match = re.match(
        r"^\d+_([A-Za-z ]+)_\d{4}-\d{2}-\d{2}_[\d-]+_(\w+)\s*#",
        name,
    )
    if mr_match:
        country_name = mr_match.group(1).strip()
        check_type = mr_match.group(2).strip()
        readable_check = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", check_type)
        short_name = f"{country_name} — {readable_check}"
        return short_name, country_name

    # Pattern 2: "PP - Location, Country. Date"
    pp_match = re.match(
        r"^PP\s*-\s*(.+?)\.?\s*"
        r"(?:January|February|March|April|May|June|July|August|September|October|November|December)",
        name,
    )
    if pp_match:
        location = pp_match.group(1).strip().rstrip(".")
        short_name = location
        parts = location.split(",")
        if len(parts) >= 2:
            country_name = parts[-1].strip()
        return short_name, country_name

    # If the name is already short enough, don't generate a short_name
    if len(name) <= 40:
        return None, None

    return short_name, country_name


def _auto_assign_country(project_id, country_candidate):
    """Look up country_candidate in the countries table (exact, case-insensitive).

    If found, create a ProjectCountry link. Does nothing if no exact match or
    if the link already exists.
    """
    if not country_candidate:
        return
    country_obj = Country.query.filter(
        db.func.lower(Country.name) == country_candidate.lower()
    ).first()
    if not country_obj:
        return
    existing = ProjectCountry.query.filter_by(
        project_id=project_id, country_id=country_obj.id
    ).first()
    if not existing:
        ProjectCountry.create(project_id=project_id, country_id=country_obj.id)


class ProjectAPI(MethodView):
    """Project management API endpoints."""

    def _get_tm4_base_url(self):
        """Get TM4 API base URL from config."""
        return current_app.config.get("TM4_API_URL", "https://tasks.kaart.com/api/v2")

    def _detect_source(self, url):
        """Determine project source from URL pattern."""
        if "maproulette" in url.lower():
            return "mr"
        return "tm4"

    def _extract_mr_challenge_id(self, url):
        """Extract challenge ID from MapRoulette URL."""
        import re
        m = re.match(r".*(?:challenges?|challenge)/(\d+)", url)
        if m:
            return int(m.group(1))
        m = re.match(r"^.*\/(\d+)$", url)
        return int(m.group(1)) if m else None

    def _calculate_task_payment(self, task, is_mapping=True):
        """
        Calculate payment for a task, handling split tasks.

        For split tasks (those with parent_task_id), payment is divided among siblings
        and only paid out when all siblings are validated.

        Args:
            task: Task object
            is_mapping: True for mapping rate, False for validation rate

        Returns:
            float: Payment amount for this task
        """
        project = Project.query.filter_by(id=task.project_id).first()
        if not project:
            return 0

        if not project.payments_enabled:
            return 0

        rate = project.mapping_rate_per_task if is_mapping else project.validation_rate_per_task

        # Check for split task
        if task.parent_task_id:
            # Count siblings with same parent
            siblings = Task.query.filter_by(
                project_id=task.project_id,
                parent_task_id=task.parent_task_id
            ).all()
            sibling_count = len(siblings)

            if sibling_count > 1:
                # Check if all siblings are validated
                if not all(s.validated for s in siblings):
                    return 0  # Not payable until all siblings done
                return rate / sibling_count

        return rate

    def post(self, path: str):
        if path == "create_project":
            return self.create_project()
        elif path == "delete_project":
            return self.delete_project()
        elif path == "calculate_budget":
            return self.calculate_budget()
        elif path == "fetch_org_projects":
            return self.fetch_org_projects()
        elif path == "fetch_user_projects":
            return self.fetch_user_projects()
        elif path == "fetch_validator_projects":
            return self.fetch_validator_projects()
        elif path == "update_project":
            return self.update_project()
        elif path == "fetch_admin_dash_stats":
            return self.fetch_admin_dash_stats()
        elif path == "fetch_user_dash_stats":
            return self.fetch_user_dash_stats()
        elif path == "fetch_validator_dash_stats":
            return self.fetch_validator_dash_stats()
        elif path == "assign_user_project":
            return self.assign_user_project()
        elif path == "unassign_user_project":
            return self.unassign_user_project()
        elif path == "purge_all_projects":
            return self.purge_all_projects()
        elif path == "fetch_project_trainings":
            return self.fetch_project_trainings()
        elif path == "assign_project_training":
            return self.assign_project_training()
        elif path == "unassign_project_training":
            return self.unassign_project_training()
        elif path == "fetch_project_profile":
            return self.fetch_project_profile()

        return {
            "message": "Only /project/{fetch_users,fetch_user_projects} is permitted with GET",  # noqa: E501
        }, 405

    @requires_team_admin_or_above
    def create_project(self):
        """Create a new TM4 or MapRoulette project.

        Open to all admin tiers (super_admin / admin / team_admin) — a
        team_admin needs to be able to spin up projects for their teams
        without bouncing off an Org Admin every time.
        """
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        # Check if required data is provided
        required_args = [
            "url",
            "rate_type",
            "mapping_rate",
            "validation_rate",
            "max_editors",
            "visibility",
            "max_validators",
        ]

        for arg in required_args:
            if not request.json.get(arg):
                return {"message": f"{arg} required", "status": 400}

        # Assign the data to variables
        url = request.json.get("url")

        # Dispatch based on source
        source = self._detect_source(url)
        if source == "mr":
            return self._create_mr_project()

        # --- TM4 path (unchanged) ---
        rate_type = request.json.get("rate_type")
        mapping_rate = float(request.json.get("mapping_rate"))
        validation_rate = float(request.json.get("validation_rate"))
        max_editors = request.json.get("max_editors")
        max_validators = request.json.get("max_validators")
        visibility = request.json.get("visibility")

        # Extract project ID from URL
        m = re.match(r"^.*\/([0-9]+)$", url)
        if not m:
            return {
                "message": "Cannot get project ID from URL",
                "status": 400,
            }
        project_id = m.group(1)

        # Check if project already exists
        project_exists = Project.query.filter_by(id=project_id).first()
        if project_exists:
            return {"message": "Project already exists", "status": 400}

        # Fetch project data from TM4 API
        base_url = self._get_tm4_base_url()
        stats_api = f"{base_url}/projects/{project_id}/"

        try:
            current_app.logger.info(f"Fetching TM4 project data from: {stats_api}")
            tm_fetch = requests.get(stats_api, timeout=30)
            if not tm_fetch.ok:
                current_app.logger.error(f"TM4 API returned {tm_fetch.status_code}: {tm_fetch.text[:500]}")
                return {"message": f"TM4 API returned status {tm_fetch.status_code}", "status": 400}
        except requests.RequestException as e:
            current_app.logger.error(f"TM4 API request error: {e}")
            return {"message": "TM4 API error", "status": 500}

        try:
            project_data = tm_fetch.json()
        except requests.exceptions.JSONDecodeError:
            current_app.logger.error(f"TM4 API returned non-JSON response: {tm_fetch.text[:500]}")
            return {"message": "TM4 API returned invalid response - check project URL", "status": 400}

        project_info = project_data.get("projectInfo", {})
        project_name = project_info.get("name", f"Project {project_id}")
        # Use totalTasks from projectInfo if available (more accurate than counting features)
        total_tasks = project_info.get("totalTasks") or len(project_data.get("tasks", {}).get("features", []))
        tasks_overlap = project_info.get("tasksOverlap", 0) or 0

        # Calculate budget
        if rate_type is True:
            calculation = (mapping_rate + validation_rate) * total_tasks
        else:
            calculation = 0

        # Create new project
        payments_enabled = request.json.get("payments_enabled", True)
        if payments_enabled:
            if mapping_rate < 0.01 or validation_rate < 0.01:
                return {"message": "Rate per task insufficient when payments enabled", "status": 400}
        short_name_input = request.json.get("short_name", "").strip()
        parsed_short, parsed_country = _auto_parse_project_name(project_name)
        final_short_name = short_name_input or parsed_short or ""

        Project.create(
            id=project_id,
            org_id=g.user.org_id,
            created_by=g.user.id,
            name=project_name,
            short_name=final_short_name,
            total_tasks=total_tasks,
            tasks_overlap=tasks_overlap,
            max_payment=float(calculation),
            url=url,
            validation_rate_per_task=validation_rate,
            mapping_rate_per_task=mapping_rate,
            max_editors=max_editors,
            max_validators=max_validators,
            visibility=visibility,
            status=True,  # New projects are active by default
            payments_enabled=payments_enabled,
        )

        _auto_assign_country(project_id, parsed_country)

        return {"message": "Project created", "project_id": project_id, "status": 200}

    def _create_mr_project(self):
        """Create a new MapRoulette project from a challenge URL.

        Creates the project immediately with whatever metadata is available.
        If the MR API is slow or times out, the project is still created with
        a default name and 0 tasks, and a background job is queued to backfill
        the metadata once the API responds.
        """
        url = request.json.get("url")
        rate_type = request.json.get("rate_type")
        mapping_rate = float(request.json.get("mapping_rate"))
        validation_rate = float(request.json.get("validation_rate"))
        max_editors = request.json.get("max_editors")
        max_validators = request.json.get("max_validators")
        visibility = request.json.get("visibility")

        challenge_id = self._extract_mr_challenge_id(url)
        if not challenge_id:
            return {"message": "Cannot get challenge ID from MapRoulette URL", "status": 400}

        # Check if project already exists
        project_exists = Project.query.filter_by(id=challenge_id).first()
        if project_exists:
            return {"message": "Project already exists", "status": 400}

        payments_enabled = request.json.get("payments_enabled", True)
        if payments_enabled:
            if mapping_rate < 0.01 or validation_rate < 0.01:
                return {"message": "Rate per task insufficient when payments enabled", "status": 400}

        # Create project immediately with defaults — metadata fetched by
        # background worker (MR API is too slow/unreliable for web requests)
        project_name = f"MR Challenge {challenge_id}"
        total_tasks = 0

        # Calculate budget
        if rate_type is True:
            calculation = (mapping_rate + validation_rate) * total_tasks
        else:
            calculation = 0

        short_name_input = request.json.get("short_name", "").strip()
        parsed_short, parsed_country = _auto_parse_project_name(project_name)
        final_short_name = short_name_input or parsed_short or ""

        Project.create(
            id=challenge_id,
            org_id=g.user.org_id,
            created_by=g.user.id,
            name=project_name,
            short_name=final_short_name,
            total_tasks=total_tasks,
            max_payment=float(calculation),
            url=url,
            validation_rate_per_task=validation_rate,
            mapping_rate_per_task=mapping_rate,
            max_editors=max_editors,
            max_validators=max_validators,
            visibility=visibility,
            status=True,
            source="mr",
            payments_enabled=payments_enabled,
        )

        _auto_assign_country(challenge_id, parsed_country)

        # Queue background metadata backfill (name + task count from MR API)
        from api.database import SyncJob
        SyncJob.create(
            org_id=g.user.org_id,
            status="queued",
            job_type="mr_metadata_backfill",
            target_id=challenge_id,
        )

        return {"message": "Project created — metadata loading in background", "project_id": challenge_id, "status": 200}

    @requires_team_admin_or_above
    def update_project(self):
        """Update a project's payment rates, visibility, status, etc.

        Open to all admin tiers — team_admin owners need to be able to
        adjust their own projects' rates and settings. Cross-org safety
        is enforced below via the ``org_id=g.user.org_id`` filter on
        the target project lookup.
        """
        response = {}
        # Check if user is authenticated
        if not hasattr(g, "user") or not g.user:
            return {"message": "Missing user info", "status": 304}
        # Check if required data is provided
        project_id = request.json.get("project_id")
        difficulty = request.json.get("difficulty")
        rate_type = request.json.get("rate_type")
        mapping_rate = float(request.json.get("mapping_rate"))
        validation_rate = float(request.json.get("validation_rate"))
        max_editors = request.json.get("max_editors")
        max_validators = request.json.get("max_validators")
        visibility = request.json.get("visibility")
        project_status = request.json.get("project_status")
        required_args = [
            "difficulty",
            "validation_rate",
            "mapping_rate",
            "max_editors",
            "max_validators",
            "project_id",
        ]
        for arg in required_args:
            if not request.json.get(arg):
                return {"message": f"{arg} required", "status": 400}
        if not project_status:
            project_status = False
        else:
            project_status = True
        target_project = Project.query.filter_by(
            org_id=g.user.org_id, id=project_id
        ).first()
        if not target_project:
            response["message"] = "Project %s not found" % (project_id)
            response["status"] = 400
            return response
        # Accept payments_enabled toggle
        payments_enabled = request.json.get("payments_enabled", target_project.payments_enabled)

        # Calculate payment rate and rate based on rate type
        if mapping_rate != 0 and validation_rate != 0:
            if rate_type is True:
                mapping_calculation = mapping_rate * target_project.total_tasks
            target_project.update(
                mapping_rate_per_task=mapping_rate,
                max_payment=float(mapping_calculation),
                validation_rate_per_task=validation_rate,
            )
        short_name = request.json.get("short_name", target_project.short_name)
        target_project.update(
            visibility=visibility, difficulty=difficulty, status=project_status,
            payments_enabled=payments_enabled, short_name=short_name,
        )
        if max_editors and max_editors != 0:
            target_project.update(
                max_editors=max_editors,
            )
        if max_validators and max_validators != 0:
            target_project.update(
                max_validators=max_validators,
            )
        response["status"] = 200
        return response

    @requires_admin
    def delete_project(self):
        response = {}
        # Check if user is authenticated
        if not g.user:
            return {"message": "Missing user info", "status": 304}
        # Check if required data is provided
        project_id = request.json.get("project_id")
        if not project_id:
            return {"message": "project_id required", "status": 400}
        target_project = Project.query.filter_by(
            org_id=g.user.org_id, id=project_id
        ).first()
        if not target_project:
            response["message"] = "Project %s not found" % (project_id)
            response["status"] = 400
            return response
        else:
            # Put logic here to process remaining payouts or whatever else before deletion  # noqa: E501
            target_project.delete(soft=False)
            response["message"] = "Project %s deleted" % (project_id)
            response["status"] = 200
            return response

    @requires_admin
    def calculate_budget(self):
        """Calculate projected budget for a TM4 or MapRoulette project."""
        if not hasattr(g, "user") or not g.user:
            return {"message": "Missing user info", "status": 304}

        url = request.json.get("url")
        rate_type = bool(request.json.get("rate_type"))
        mapping_rate = request.json.get("mapping_rate")
        validation_rate = request.json.get("validation_rate")
        project_id = request.json.get("project_id")

        required_args = ["mapping_rate", "validation_rate", "url"]
        for arg in required_args:
            if request.json.get(arg) is None:
                return {"message": f"{arg} required", "status": 400}

        # Detect source from URL
        source = self._detect_source(url)

        if source == "mr":
            # --- MapRoulette path ---
            challenge_id = self._extract_mr_challenge_id(url)
            if not challenge_id:
                return {"message": "Cannot get challenge ID from MapRoulette URL", "status": 400}

            try:
                mr_data = MapRouletteSync().fetch_challenge_metadata(challenge_id)
            except Exception as e:
                current_app.logger.error(f"MapRoulette API error: {e}")
                return {"message": "MapRoulette API error", "status": 500}

            if not mr_data:
                return {"message": "Could not fetch challenge metadata from MapRoulette", "status": 500}

            total_tasks = mr_data.get("task_count", 0)
        else:
            # --- TM4 path (unchanged) ---
            base_url = self._get_tm4_base_url()

            if project_id is not None:
                project = Project.query.filter_by(id=project_id).first()
                if not project:
                    return {"message": "Project not found", "status": 400}
            else:
                m = re.match(r"^.*\/([0-9]+)$", url)
                if not m:
                    return {"message": "Cannot get project ID from URL", "status": 400}
                project_id = m.group(1)

            stats_api = f"{base_url}/projects/{project_id}/"

            # Fetch project data from TM4
            try:
                current_app.logger.info(f"Fetching TM4 project data from: {stats_api}")
                tm_fetch = requests.get(stats_api, timeout=30)
                if not tm_fetch.ok:
                    current_app.logger.error(f"TM4 API returned {tm_fetch.status_code}: {tm_fetch.text[:500]}")
                    return {"message": f"TM4 API returned status {tm_fetch.status_code}", "status": 500}
            except requests.RequestException as e:
                current_app.logger.error(f"TM4 API request error: {e}")
                return {"message": "TM4 API error", "status": 500}

            try:
                json_data = tm_fetch.json()
            except requests.exceptions.JSONDecodeError:
                current_app.logger.error(f"TM4 API returned non-JSON response: {tm_fetch.text[:500]}")
                return {"message": "TM4 API returned invalid response", "status": 500}

            # Debug logging for task count
            project_info = json_data.get("projectInfo", {})
            features_count = len(json_data.get("tasks", {}).get("features", []))
            project_info_total = project_info.get("totalTasks")
            current_app.logger.info(f"TM4 project {project_id} - projectInfo.totalTasks: {project_info_total}, features count: {features_count}")
            current_app.logger.info(f"TM4 projectInfo keys: {list(project_info.keys())}")

            # Use totalTasks from projectInfo if available (more accurate than counting features)
            total_tasks = project_info_total or features_count
            tasks_overlap = project_info.get("tasksOverlap", 0) or 0
            current_app.logger.info(f"Using total_tasks: {total_tasks}, tasks_overlap: {tasks_overlap}")

        if rate_type is True:
            mapping_rate = float(mapping_rate)
            validation_rate = float(validation_rate)

            projected_mapping_budget = mapping_rate * total_tasks
            projected_validation_budget = validation_rate * total_tasks
            total_projected_budget = projected_mapping_budget + projected_validation_budget

            return_text = (
                f"${mapping_rate:.2f}(Mapping) + ${validation_rate:.2f}(Validation) "
                f"x {total_tasks} Tasks = Projected Budget: ${total_projected_budget:.2f}"
            )

            return {"calculation": return_text, "status": 200}

        return {"message": "rate_type must be true", "status": 400}

    def _count_tasks_split_aware(self, tasks, condition_fn=None):
        return count_tasks_split_aware(tasks, condition_fn)

    def _get_effective_task_counts(self, project_id):
        """
        Calculate effective task counts that properly handle split tasks.

        Split tasks (those with parent_task_id) are grouped together and counted
        as fractions. For example, if a task was split into 4, each split task
        contributes 0.25 to the count instead of 1.

        Returns:
            dict with effective_mapped, effective_validated, effective_invalidated,
            plus raw counts and split task info
        """
        project_tasks = Task.query.filter_by(project_id=project_id).all()

        # Separate normal tasks from split tasks
        normal_tasks = [t for t in project_tasks if not t.parent_task_id]
        split_tasks = [t for t in project_tasks if t.parent_task_id]

        # Count normal tasks directly
        normal_mapped = len([t for t in normal_tasks if t.mapped])
        normal_validated = len([t for t in normal_tasks if t.validated])
        normal_invalidated = len([t for t in normal_tasks if t.invalidated])

        # Group split tasks by parent_task_id and count each group as 1 task
        split_groups = {}
        for task in split_tasks:
            if task.parent_task_id not in split_groups:
                split_groups[task.parent_task_id] = {
                    "tasks": [],
                    "mapped": 0,
                    "validated": 0,
                    "invalidated": 0,
                }
            split_groups[task.parent_task_id]["tasks"].append(task)
            if task.mapped:
                split_groups[task.parent_task_id]["mapped"] += 1
            if task.validated:
                split_groups[task.parent_task_id]["validated"] += 1
            if task.invalidated:
                split_groups[task.parent_task_id]["invalidated"] += 1

        # For split groups, only count as 1 when ALL siblings are present AND complete
        # If not all siblings are present or complete, the group counts as 0
        split_mapped = 0
        split_validated = 0
        split_invalidated = 0

        for parent_id, group in split_groups.items():
            actual_sibling_count = len(group["tasks"])
            # Get expected sibling count (default to 4 for TM4 splits)
            expected_sibling_count = group["tasks"][0].sibling_count if group["tasks"][0].sibling_count else 4

            # Only count if we have ALL expected siblings
            if actual_sibling_count != expected_sibling_count:
                continue  # Missing siblings, don't count this group

            # Only count as 1 mapped task if ALL siblings are mapped
            if group["mapped"] == actual_sibling_count:
                split_mapped += 1
            # Only count as 1 validated task if ALL siblings are validated
            if group["validated"] == actual_sibling_count:
                split_validated += 1
            # Only count as 1 invalidated task if ALL siblings are invalidated
            if group["invalidated"] == actual_sibling_count:
                split_invalidated += 1

        # MR status breakdown (only meaningful for MR projects)
        mr_status_counts = {}
        for t in project_tasks:
            if t.mr_status is not None:
                mr_status_counts[t.mr_status] = mr_status_counts.get(t.mr_status, 0) + 1

        return {
            # Effective counts: normal tasks + completed split groups (all siblings done = 1)
            "effective_mapped": normal_mapped + split_mapped,
            "effective_validated": normal_validated + split_validated,
            "effective_invalidated": normal_invalidated + split_invalidated,
            # Raw counts: actual number of task records (includes each split segment)
            "raw_mapped": normal_mapped + len([t for t in split_tasks if t.mapped]),
            "raw_validated": normal_validated + len([t for t in split_tasks if t.validated]),
            "raw_invalidated": normal_invalidated + len([t for t in split_tasks if t.invalidated]),
            "split_task_groups": len(split_groups),
            "split_task_count": len(split_tasks),
            # MR status breakdown: {status_code: count} for MR projects
            "mr_status_breakdown": mr_status_counts,
        }

    @requires_team_admin_or_above
    def fetch_org_projects(self):
        # Check if user is authenticated
        if not g:
            return {"message": "User not found", "status": 304}

        # Check for filters in the request body
        req_body = request.json if request.json else {}
        filters = req_body.get("filters")
        created_by_me = req_body.get("created_by_me", False)
        country_id = req_body.get("country_id")
        region_id = req_body.get("region_id")
        team_id = req_body.get("team_id")
        filtered_user_ids = resolve_filtered_user_ids(filters, g.user.org_id)

        # team_admin: narrow to projects joined to managed teams via ProjectTeam
        team_admin_project_ids = None
        if g.user.role == "team_admin":
            managed = managed_team_ids_for(g.user)
            if not managed:
                return {
                    "org_active_projects": [],
                    "org_inactive_projects": [],
                    "message": "Projects found",
                    "status": 200,
                }
            team_admin_project_ids = {
                pt.project_id
                for pt in ProjectTeam.query.filter(
                    ProjectTeam.team_id.in_(managed)
                ).all()
            }
            if not team_admin_project_ids:
                return {
                    "org_active_projects": [],
                    "org_inactive_projects": [],
                    "message": "Projects found",
                    "status": 200,
                }

        # If filters produced a user-id set, restrict to projects that have
        # at least one assigned user in that set via the ProjectUser table.
        if filtered_user_ids is not None:
            filtered_project_ids = {
                pu.project_id
                for pu in ProjectUser.query.filter(
                    ProjectUser.user_id.in_(filtered_user_ids)
                ).all()
            }
        else:
            filtered_project_ids = None

        # Get all projects for the organization
        org_active_projects = []
        org_inactive_projects = []
        active_projects = Project.query.filter_by(
            org_id=g.user.org_id, status=True
        ).all()
        inactive_projects = Project.query.filter_by(
            org_id=g.user.org_id, status=False
        ).all()

        # team_admin: narrow to projects joined to managed teams
        if team_admin_project_ids is not None:
            active_projects = [
                p for p in active_projects if p.id in team_admin_project_ids
            ]
            inactive_projects = [
                p for p in inactive_projects if p.id in team_admin_project_ids
            ]

        # Batch-load location assignment counts for admin display
        all_project_ids = [p.id for p in active_projects + inactive_projects]
        _loc_rows = ProjectCountry.query.filter(
            ProjectCountry.project_id.in_(all_project_ids)
        ).all() if all_project_ids else []
        _loc_counts = {}
        for r in _loc_rows:
            _loc_counts[r.project_id] = _loc_counts.get(r.project_id, 0) + 1

        # Batch-load training assignment counts for admin display
        _trn_rows = ProjectTraining.query.filter(
            ProjectTraining.project_id.in_(all_project_ids)
        ).all() if all_project_ids else []
        _trn_counts = {}
        for r in _trn_rows:
            _trn_counts[r.project_id] = _trn_counts.get(r.project_id, 0) + 1

        # Apply project-level filter if filters were provided
        if filtered_project_ids is not None:
            active_projects = [
                p for p in active_projects if p.id in filtered_project_ids
            ]
            inactive_projects = [
                p for p in inactive_projects if p.id in filtered_project_ids
            ]
        # Filter to only projects created by the current admin
        if created_by_me:
            active_projects = [
                p for p in active_projects if p.created_by == g.user.id
            ]
            inactive_projects = [
                p for p in inactive_projects if p.created_by == g.user.id
            ]
        # Admin-supplied standalone filters — Region (geographic),
        # Country, Team — each narrows the project list independently
        # via project-direct lookups (ProjectCountry / ProjectTeam).
        # None means "All …" for that dimension. Filters AND together.

        # Country: reuses _loc_rows (no new query).
        if country_id is not None:
            try:
                _country_id = int(country_id)
                _country_project_ids = {
                    r.project_id for r in _loc_rows if r.country_id == _country_id
                }
                active_projects = [
                    p for p in active_projects if p.id in _country_project_ids
                ]
                inactive_projects = [
                    p for p in inactive_projects if p.id in _country_project_ids
                ]
            except (TypeError, ValueError):
                pass

        # Region (geographic, e.g. Asia): expand to its countries, then
        # filter by ProjectCountry. One small query for the country
        # ids; reuses _loc_rows for the project lookup.
        if region_id is not None:
            try:
                _region_id = int(region_id)
                _region_country_ids = {
                    c.id for c in (
                        Country.query
                        .with_entities(Country.id)
                        .filter(Country.region_id == _region_id)
                        .all()
                    )
                }
                _region_project_ids = {
                    r.project_id for r in _loc_rows
                    if r.country_id in _region_country_ids
                }
                active_projects = [
                    p for p in active_projects if p.id in _region_project_ids
                ]
                inactive_projects = [
                    p for p in inactive_projects if p.id in _region_project_ids
                ]
            except (TypeError, ValueError):
                pass

        # Team: ProjectTeam lookup. One small query bounded by team
        # size.
        if team_id is not None:
            try:
                _team_id = int(team_id)
                _team_project_ids = {
                    pt.project_id for pt in (
                        ProjectTeam.query
                        .filter(ProjectTeam.team_id == _team_id)
                        .all()
                    )
                }
                active_projects = [
                    p for p in active_projects if p.id in _team_project_ids
                ]
                inactive_projects = [
                    p for p in inactive_projects if p.id in _team_project_ids
                ]
            except (TypeError, ValueError):
                pass

        # Batch-load task stats for all projects (single SQL query instead of N queries)
        _batch_task_stats = get_batch_project_stats_fast(all_project_ids)

        # Add each project to the list
        for project in active_projects:
            task_counts = _batch_task_stats.get(project.id, {
                "effective_mapped": 0, "effective_validated": 0, "effective_invalidated": 0,
                "raw_mapped": 0, "raw_validated": 0, "raw_invalidated": 0,
                "split_task_groups": 0, "split_task_count": 0, "mr_status_breakdown": {},
            })
            org_active_projects.append(
                {
                    "id": project.id,
                    "name": project.name,
                    "short_name": project.short_name or "",
                    "visibility": project.visibility,
                    "max_payment": project.max_payment,
                    "payment_due": project.payment_due,
                    "total_payout": project.total_payout,
                    "validation_rate_per_task": project.validation_rate_per_task,  # noqa: E501
                    "mapping_rate_per_task": project.mapping_rate_per_task,
                    "max_editors": project.max_editors,
                    "total_editors": project.total_editors,
                    "max_validators": project.max_editors,
                    "total_validators": project.total_editors,
                    "total_tasks": project.total_tasks,
                    "url": project.url,
                    "difficulty": project.difficulty,
                    "source": project.source,
                    "created_by": project.created_by,
                    # Use effective counts that handle split tasks
                    "total_mapped": task_counts["effective_mapped"],
                    "total_validated": task_counts["effective_validated"],
                    "total_invalidated": task_counts["effective_invalidated"],
                    # Also include raw counts for reference
                    "raw_mapped": task_counts["raw_mapped"],
                    "raw_validated": task_counts["raw_validated"],
                    "raw_invalidated": task_counts["raw_invalidated"],
                    "split_task_groups": task_counts["split_task_groups"],
                    "mr_status_breakdown": task_counts.get("mr_status_breakdown", {}),
                    "status": project.status,
                    "payments_enabled": project.payments_enabled,
                    "assigned_locations": _loc_counts.get(project.id, 0),
                    "assigned_trainings": _trn_counts.get(project.id, 0),
                    "last_synced": project.last_sync_cursor.isoformat() if project.last_sync_cursor else None,
                }
            )
        for project in inactive_projects:
            task_counts = _batch_task_stats.get(project.id, {
                "effective_mapped": 0, "effective_validated": 0, "effective_invalidated": 0,
                "raw_mapped": 0, "raw_validated": 0, "raw_invalidated": 0,
                "split_task_groups": 0, "split_task_count": 0, "mr_status_breakdown": {},
            })
            org_inactive_projects.append(
                {
                    "id": project.id,
                    "name": project.name,
                    "short_name": project.short_name or "",
                    "visibility": project.visibility,
                    "max_payment": project.max_payment,
                    "payment_due": project.payment_due,
                    "total_payout": project.total_payout,
                    "validation_rate_per_task": project.validation_rate_per_task,  # noqa: E501
                    "mapping_rate_per_task": project.mapping_rate_per_task,
                    "max_editors": project.max_editors,
                    "total_editors": project.total_editors,
                    "max_validators": project.max_editors,
                    "total_validators": project.total_editors,
                    "total_tasks": project.total_tasks,
                    "url": project.url,
                    "difficulty": project.difficulty,
                    "source": project.source,
                    "created_by": project.created_by,
                    # Use effective counts that handle split tasks
                    "total_mapped": task_counts["effective_mapped"],
                    "total_validated": task_counts["effective_validated"],
                    "total_invalidated": task_counts["effective_invalidated"],
                    # Also include raw counts for reference
                    "raw_mapped": task_counts["raw_mapped"],
                    "raw_validated": task_counts["raw_validated"],
                    "raw_invalidated": task_counts["raw_invalidated"],
                    "split_task_groups": task_counts["split_task_groups"],
                    "mr_status_breakdown": task_counts.get("mr_status_breakdown", {}),
                    "status": project.status,
                    "payments_enabled": project.payments_enabled,
                    "assigned_locations": _loc_counts.get(project.id, 0),
                    "assigned_trainings": _trn_counts.get(project.id, 0),
                    "last_synced": project.last_sync_cursor.isoformat() if project.last_sync_cursor else None,
                }
            )
        return {
            "org_active_projects": org_active_projects,
            "org_inactive_projects": org_inactive_projects,
            "message": "Projects found",
            "status": 200,
        }

    def fetch_project_profile(self):
        """Fetch comprehensive profile data for a single project."""
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

        try:
            return self._build_project_profile(project)
        except Exception as e:
            current_app.logger.exception(
                f"Error building profile for project {project_id}: {e}"
            )
            return {
                "message": f"Error loading project profile: {str(e)}",
                "status": 500,
            }

    def _build_project_profile(self, project):
        """Build the full profile response for a project."""
        # Task counts (reuse existing helper)
        task_counts = self._get_effective_task_counts(project.id)

        # Created-by user name
        created_by_name = None
        if project.created_by:
            creator = User.query.get(project.created_by)
            if creator:
                created_by_name = f"{creator.first_name or ''} {creator.last_name or ''}".strip() or creator.email

        # --- Assigned users with per-user stats ---
        assigned_pu = ProjectUser.query.filter_by(project_id=project.id).all()
        assigned_user_ids = set(pu.user_id for pu in assigned_pu)

        # Per-user task aggregates
        user_task_stats = {}
        map_rows = (
            db.session.query(Task.mapped_by, func.count())
            .filter(
                Task.project_id == project.id,
                Task.mapped == True,
            )
            .group_by(Task.mapped_by)
            .all()
        )
        for osm_un, cnt in map_rows:
            if osm_un:
                user_task_stats.setdefault(osm_un, {"mapped": 0, "validated": 0})
                user_task_stats[osm_un]["mapped"] = cnt

        val_rows = (
            db.session.query(Task.validated_by, func.count())
            .filter(
                Task.project_id == project.id,
                Task.validated == True,
            )
            .group_by(Task.validated_by)
            .all()
        )
        for osm_un, cnt in val_rows:
            if osm_un:
                user_task_stats.setdefault(osm_un, {"mapped": 0, "validated": 0})
                user_task_stats[osm_un]["validated"] = cnt

        # Per-user time entries
        user_time = {}
        time_rows = (
            db.session.query(
                TimeEntry.user_id,
                func.sum(TimeEntry.duration_seconds),
            )
            .filter(
                TimeEntry.project_id == project.id,
                TimeEntry.status == "completed",
                TimeEntry.duration_seconds != None,
            )
            .group_by(TimeEntry.user_id)
            .all()
        )
        for uid, secs in time_rows:
            if uid and secs:
                user_time[uid] = secs

        # Build user list — only assigned users + users with actual contributions
        # Find user IDs that have task stats or time logged
        osm_usernames_with_stats = set(user_task_stats.keys())
        user_ids_with_time = set(user_time.keys())

        # Map OSM usernames to user IDs for contributors not in assigned list
        contributor_users = []
        if osm_usernames_with_stats:
            contributor_users = User.query.filter(
                User.osm_username.in_(osm_usernames_with_stats),
                User.org_id == g.user.org_id,
            ).all()

        all_user_ids = assigned_user_ids | user_ids_with_time | {u.id for u in contributor_users}
        users_data = []
        users = User.query.filter(User.id.in_(all_user_ids)).all() if all_user_ids else []
        for u in users:
            osm_un = u.osm_username or ""
            stats = user_task_stats.get(osm_un, {"mapped": 0, "validated": 0})
            mapping_earnings = stats["mapped"] * (project.mapping_rate_per_task or 0)
            validation_earnings = stats["validated"] * (project.validation_rate_per_task or 0)
            users_data.append({
                "id": u.id,
                "name": f"{u.first_name or ''} {u.last_name or ''}".strip() or u.email,
                "first_name": u.first_name or "",
                "last_name": u.last_name or "",
                "email": u.email,
                "role": u.role,
                "osm_username": u.osm_username,
                "tasks_mapped": stats["mapped"],
                "tasks_validated": stats["validated"],
                "time_logged_seconds": user_time.get(u.id, 0),
                "earnings": round(mapping_earnings + validation_earnings, 2),
                "is_assigned": u.id in assigned_user_ids,
            })

        # --- Assigned teams ---
        team_rows = (
            db.session.query(Team.id, Team.name, func.count(TeamUser.id))
            .join(ProjectTeam, ProjectTeam.team_id == Team.id)
            .outerjoin(TeamUser, TeamUser.team_id == Team.id)
            .filter(ProjectTeam.project_id == project.id)
            .group_by(Team.id, Team.name)
            .all()
        )
        teams_data = [
            {"id": t_id, "name": t_name, "member_count": cnt}
            for t_id, t_name, cnt in team_rows
        ]

        # --- Time tracking summary ---
        time_cat_rows = (
            db.session.query(
                TimeEntry.category,
                func.sum(TimeEntry.duration_seconds),
            )
            .filter(
                TimeEntry.project_id == project.id,
                TimeEntry.status == "completed",
                TimeEntry.duration_seconds != None,
            )
            .group_by(TimeEntry.category)
            .all()
        )
        time_by_category = {}
        total_time_seconds = 0
        for cat, secs in time_cat_rows:
            if cat and secs:
                time_by_category[cat] = secs
                total_time_seconds += secs

        # Recent time entries (last 20)
        recent_entries = (
            TimeEntry.query.filter(
                TimeEntry.project_id == project.id,
                TimeEntry.status == "completed",
            )
            .order_by(TimeEntry.clock_out.desc())
            .limit(20)
            .all()
        )
        recent_entries_data = []
        # Build a quick user ID->name lookup
        entry_user_ids = list(set(e.user_id for e in recent_entries))
        entry_users = {u.id: u for u in User.query.filter(User.id.in_(entry_user_ids)).all()} if entry_user_ids else {}
        for e in recent_entries:
            eu = entry_users.get(e.user_id)
            recent_entries_data.append({
                "user_name": (f"{eu.first_name or ''} {eu.last_name or ''}".strip() or eu.email) if eu else "Unknown",
                "first_name": (eu.first_name or "") if eu else "",
                "last_name": (eu.last_name or "") if eu else "",
                "category": e.category,
                "clock_in": e.clock_in.isoformat() if e.clock_in else None,
                "clock_out": e.clock_out.isoformat() if e.clock_out else None,
                "duration_seconds": e.duration_seconds,
                "user_notes": e.user_notes,
            })

        # --- Assigned trainings ---
        pt_rows = ProjectTraining.query.filter_by(project_id=project.id).all()
        training_ids = [pt.training_id for pt in pt_rows]
        trainings_data = []
        if training_ids:
            trainings = Training.query.filter(Training.id.in_(training_ids)).all()
            for t in trainings:
                trainings_data.append({
                    "id": t.id,
                    "title": t.title,
                    "difficulty": t.difficulty,
                    "point_value": t.point_value,
                    "training_type": t.training_type,
                })

        # --- Assigned locations ---
        loc_rows = (
            db.session.query(ProjectCountry.country_id)
            .filter(ProjectCountry.project_id == project.id)
            .all()
        )
        country_ids = [r[0] for r in loc_rows]
        locations_data = []
        if country_ids:
            from ..database import Country
            countries = Country.query.filter(Country.id.in_(country_ids)).all()
            locations_data = [
                {"id": c.id, "name": c.name, "code": c.iso_code}
                for c in countries
            ]

        # --- Recent tasks (last 50) ---
        recent_tasks = (
            Task.query.filter_by(project_id=project.id)
            .order_by(Task.date_mapped.desc().nullslast())
            .limit(50)
            .all()
        )
        tasks_data = [
            {
                "task_id": t.task_id,
                "mapped_by": t.mapped_by,
                "validated_by": t.validated_by,
                "date_mapped": t.date_mapped.isoformat() if t.date_mapped else None,
                "date_validated": t.date_validated.isoformat() if t.date_validated else None,
                "paid_out": t.paid_out,
                "mr_status": t.mr_status,
            }
            for t in recent_tasks
        ]

        # Avg time per task
        completed_tasks = task_counts["effective_mapped"] + task_counts["effective_validated"]
        avg_time_per_task = round(total_time_seconds / completed_tasks) if completed_tasks > 0 and total_time_seconds > 0 else None

        return {
            "status": 200,
            "project": {
                "id": project.id,
                "name": project.name,
                "short_name": project.short_name or "",
                "url": project.url,
                "source": project.source,
                "status": project.status,
                "visibility": project.visibility,
                "difficulty": project.difficulty,
                "created_by": project.created_by,
                "created_by_name": created_by_name,
                "total_tasks": project.total_tasks,
                "mapping_rate_per_task": project.mapping_rate_per_task,
                "validation_rate_per_task": project.validation_rate_per_task,
                "max_payment": project.max_payment,
                "payment_due": project.payment_due,
                "total_payout": project.total_payout,
                "payments_enabled": project.payments_enabled,
                "max_editors": project.max_editors,
                "total_editors": project.total_editors,
                "last_synced": project.last_sync_cursor.isoformat() if project.last_sync_cursor else None,
                **task_counts,
            },
            "assigned_users": users_data,
            "assigned_teams": teams_data,
            "tasks": tasks_data,
            "time_summary": {
                "total_seconds": total_time_seconds,
                "by_category": time_by_category,
            },
            "recent_time_entries": recent_entries_data,
            "assigned_trainings": trainings_data,
            "assigned_locations": locations_data,
            "avg_time_per_task": avg_time_per_task,
        }

    @requires_team_admin_or_above
    def fetch_admin_dash_stats(self):
        # Check if user is authenticated
        if not g:
            return {"message": "User not found", "status": 304}
        org_id = g.user.org_id

        # Admin-supplied region filter from the dashboard's RegionFilter
        # dropdown. None means "all regions" (current behavior). When
        # set, project + task counts narrow to projects assigned to
        # that country.
        req_body = request.json if request.json else {}
        country_id = req_body.get("country_id")
        visible_project_ids = None
        if country_id is not None:
            try:
                _country_id = int(country_id)
                visible_project_ids = [
                    r.project_id for r in (
                        ProjectCountry.query
                        .filter(ProjectCountry.country_id == _country_id)
                        .all()
                    )
                ]
                # Also bound to org. ProjectCountry rows reference org's
                # projects; intersect with org's project ids to be safe.
                org_project_ids = {
                    p.id for p in
                    Project.query.with_entities(Project.id)
                    .filter(Project.org_id == org_id).all()
                }
                visible_project_ids = [
                    pid for pid in visible_project_ids if pid in org_project_ids
                ]
            except (TypeError, ValueError):
                visible_project_ids = None

        # team_admin: narrow to projects joined to managed teams.
        # Intersects with any country/region filter.
        if g.user.role == "team_admin":
            managed = managed_team_ids_for(g.user)
            if not managed:
                # zero-team team_admin: empty result
                return {
                    "month_contribution_change": 0,
                    "total_contributions_for_month": 0,
                    "weekly_contributions_array": [],
                    "active_projects": 0,
                    "inactive_projects": 0,
                    "completed_projects": 0,
                    "mapped_tasks": 0,
                    "validated_tasks": 0,
                    "invalidated_tasks": 0,
                    "payable_total": 0,
                    "requests_total": 0,
                    "payouts_total": 0,
                    "message": "Stats Fetched",
                    "status": 200,
                }
            ta_project_ids = {
                pt.project_id
                for pt in ProjectTeam.query.filter(
                    ProjectTeam.team_id.in_(managed)
                ).all()
            }
            if visible_project_ids is not None:
                visible_project_ids = [
                    pid for pid in visible_project_ids if pid in ta_project_ids
                ]
            else:
                visible_project_ids = list(ta_project_ids)

        # Weekly contributions (already SQL-based)
        end_date = datetime.now()
        start_date = end_date - timedelta(days=30)
        weekly_contributions_this_month = (
            UserTasks.query.with_entities(
                func.extract("week", UserTasks.timestamp).label("week"),
                func.count().label("total_contributions"),
            )
            .filter(UserTasks.timestamp >= start_date, UserTasks.timestamp <= end_date)
            .group_by(func.extract("week", UserTasks.timestamp))
            .all()
        )

        weekly_contributions_last_month = (
            UserTasks.query.with_entities(
                func.extract("week", UserTasks.timestamp).label("week"),
                func.count().label("total_contributions"),
            )
            .filter(
                UserTasks.timestamp >= start_date - timedelta(days=30),
                UserTasks.timestamp <= end_date - timedelta(days=30),
            )
            .group_by(func.extract("week", UserTasks.timestamp))
            .all()
        )

        weekly_contributions_array = []
        total_contributions_this_month = 0
        total_contributions_last_month = 0
        for week, total_contributions in weekly_contributions_this_month:
            weekly_contributions_array.append(total_contributions)
            total_contributions_this_month += total_contributions

        for week, total_contributions in weekly_contributions_last_month:
            weekly_contributions_array.append(total_contributions)
            total_contributions_last_month += total_contributions

        month_contribution_change = (
            total_contributions_this_month - total_contributions_last_month
        )

        # Project counts — single query
        proj_counts_q = db.session.query(
            func.count(case((Project.status == True, 1))).label("active"),
            func.count(case((Project.status == False, 1))).label("inactive"),
            func.count(case((Project.completed == True, 1))).label("completed"),
        ).filter(Project.org_id == org_id)
        if visible_project_ids is not None:
            proj_counts_q = proj_counts_q.filter(Project.id.in_(visible_project_ids))
        proj_counts = proj_counts_q.first()

        active_projects_count = proj_counts.active or 0
        inactive_projects_count = proj_counts.inactive or 0
        completed_projects_count = proj_counts.completed or 0

        # Task counts — single query (simple counts, no split-aware for dashboard summary)
        task_counts_q = db.session.query(
            func.count(case((and_(Task.mapped == True, Task.validated == False, Task.invalidated == False), 1))).label("mapped"),
            func.count(case((and_(Task.mapped == True, Task.validated == True), 1))).label("validated"),
            func.count(case((Task.invalidated == True, 1))).label("invalidated"),
        ).filter(Task.org_id == org_id)
        if visible_project_ids is not None:
            task_counts_q = task_counts_q.filter(Task.project_id.in_(visible_project_ids))
        task_counts = task_counts_q.first()

        mapped_tasks_count = task_counts.mapped or 0
        validated_tasks_count = task_counts.validated or 0
        invalidated_tasks_count = task_counts.invalidated or 0

        # Payment totals — SQL sums
        payable_total = db.session.query(
            func.coalesce(func.sum(User.payable_total), 0)
        ).filter(User.org_id == org_id).scalar() or 0

        requests_total = db.session.query(
            func.coalesce(func.sum(PayRequests.amount_requested), 0)
        ).filter(PayRequests.org_id == org_id).scalar() or 0

        payouts_total = db.session.query(
            func.coalesce(func.sum(Payments.amount_paid), 0)
        ).filter(Payments.org_id == org_id).scalar() or 0

        # Construct response dictionary
        response = {
            "month_contribution_change": month_contribution_change,
            "total_contributions_for_month": total_contributions_this_month,
            "weekly_contributions_array": weekly_contributions_array,
            "active_projects": active_projects_count,
            "inactive_projects": inactive_projects_count,
            "completed_projects": completed_projects_count,
            "mapped_tasks": mapped_tasks_count,
            "validated_tasks": validated_tasks_count,
            "invalidated_tasks": invalidated_tasks_count,
            "payable_total": payable_total,
            "requests_total": requests_total,
            "payouts_total": payouts_total,
            "message": "Stats Fetched",
            "status": 200,
        }
        return response

    def fetch_user_dash_stats(self):
        # Check if user is authenticated
        if not g.user:
            return {"message": "User not found", "status": 304}
        user_id = g.user.id
        org_id = g.user.org_id
        osm_username = g.user.osm_username

        # User's task counts via SQL (mapped/validated/invalidated as mapper)
        user_task_counts = db.session.query(
            func.count(case((and_(Task.mapped == True, Task.validated == False, Task.invalidated == False), 1))).label("mapped"),
            func.count(case((and_(Task.mapped == True, Task.validated == True), 1))).label("validated"),
            func.count(case((Task.invalidated == True, 1))).label("invalidated"),
        ).join(UserTasks, UserTasks.task_id == Task.id).filter(
            UserTasks.user_id == user_id
        ).first()

        user_mapped_tasks_count = user_task_counts.mapped or 0
        user_validated_tasks_count = user_task_counts.validated or 0
        user_invalidated_tasks_count = user_task_counts.invalidated or 0

        # Validator stats — tasks validated/invalidated BY this user
        validator_counts = db.session.query(
            func.count(case((and_(Task.validated == True, Task.self_validated == False), 1))).label("validated"),
            func.count(case((Task.invalidated == True, 1))).label("invalidated"),
        ).filter(
            Task.org_id == org_id,
            Task.validated_by == osm_username,
        ).first()

        validator_validated = validator_counts.validated or 0
        validator_invalidated = validator_counts.invalidated or 0

        # Payment balances (payable = validated tasks not yet claimed)
        _pay = get_user_payment_balances(g.user)
        payable_total = _pay["mapping_payable_total"] or 0

        # Payment sums via SQL
        requests_total = db.session.query(
            func.coalesce(func.sum(PayRequests.amount_requested), 0)
        ).filter(PayRequests.org_id == org_id, PayRequests.user_id == user_id).scalar() or 0

        payouts_total = db.session.query(
            func.coalesce(func.sum(Payments.amount_paid), 0)
        ).filter(Payments.org_id == org_id, Payments.user_id == user_id).scalar() or 0

        # Weekly contributions (already SQL-based)
        end_date = datetime.now()
        start_date = end_date - timedelta(days=30)
        weekly_contributions_this_month = (
            UserTasks.query.with_entities(
                func.extract("week", UserTasks.timestamp).label("week"),
                func.count().label("total_contributions"),
            )
            .filter(
                UserTasks.user_id == user_id,
                UserTasks.timestamp >= start_date,
                UserTasks.timestamp <= end_date,
            )
            .group_by(func.extract("week", UserTasks.timestamp))
            .all()
        )

        weekly_contributions_last_month = (
            UserTasks.query.with_entities(
                func.extract("week", UserTasks.timestamp).label("week"),
                func.count().label("total_contributions"),
            )
            .filter(
                UserTasks.user_id == user_id,
                UserTasks.timestamp >= start_date - timedelta(days=30),
                UserTasks.timestamp <= end_date - timedelta(days=30),
            )
            .group_by(func.extract("week", UserTasks.timestamp))
            .all()
        )

        weekly_contributions_array = []
        total_contributions_this_month = 0
        total_contributions_last_month = 0
        for week, total_contributions in weekly_contributions_this_month:
            weekly_contributions_array.append(total_contributions)
            total_contributions_this_month += total_contributions

        for week, total_contributions in weekly_contributions_last_month:
            weekly_contributions_array.append(total_contributions)
            total_contributions_last_month += total_contributions

        month_contribution_change = (
            total_contributions_this_month - total_contributions_last_month
        )

        # Construct response dictionary
        response = {
            "month_contribution_change": month_contribution_change,
            "total_contributions_for_month": total_contributions_this_month,
            "weekly_contributions_array": weekly_contributions_array,
            "mapped_tasks": user_mapped_tasks_count,
            "validated_tasks": user_validated_tasks_count,
            "invalidated_tasks": user_invalidated_tasks_count,
            "validator_validated": validator_validated,
            "validator_invalidated": validator_invalidated,
            "mapping_payable_total": _pay["mapping_payable_total"],
            "validation_payable_total": _pay["validation_payable_total"],
            "payable_total": payable_total,
            "requests_total": float(requests_total),
            "payouts_total": float(payouts_total),
            "message": "Stats Fetched",
            "status": 200,
        }
        return response

    def fetch_validator_dash_stats(self):
        # Check if user is authenticated
        if not g:
            return {"message": "User not found", "status": 304}
        user_id = g.user.id
        org_id = g.user.org_id
        osm_username = g.user.osm_username

        # Project assignment counts via SQL
        all_user_assignments_count = db.session.query(func.count()).filter(
            ProjectUser.user_id == user_id
        ).scalar() or 0

        # Active projects count via SQL
        active_projects_count = db.session.query(func.count()).filter(
            Project.org_id == org_id, Project.status == True
        ).scalar() or 0

        # Completed projects assigned to user via SQL
        completed_projects_count = db.session.query(func.count()).join(
            ProjectUser, ProjectUser.project_id == Project.id
        ).filter(
            Project.org_id == org_id,
            ProjectUser.user_id == user_id,
            Project.completed == True,
        ).scalar() or 0

        # User's task counts via SQL (mapped/validated/invalidated as mapper)
        user_task_counts = db.session.query(
            func.count(case((and_(Task.mapped == True, Task.validated == False, Task.invalidated == False), 1))).label("mapped"),
            func.count(case((and_(Task.mapped == True, Task.validated == True), 1))).label("validated"),
            func.count(case((Task.invalidated == True, 1))).label("invalidated"),
        ).join(UserTasks, UserTasks.task_id == Task.id).filter(
            UserTasks.user_id == user_id
        ).first()

        user_mapped_tasks_count = user_task_counts.mapped or 0
        user_validated_tasks_count = user_task_counts.validated or 0
        user_invalidated_tasks_count = user_task_counts.invalidated or 0

        # Validator stats — tasks validated/invalidated BY this user
        validator_counts = db.session.query(
            func.count(case((and_(Task.validated == True, Task.self_validated == False), 1))).label("validated"),
            func.count(case((Task.invalidated == True, 1))).label("invalidated"),
            func.count(case((and_(Task.validated == True, Task.self_validated == True), 1))).label("self_validated"),
        ).filter(
            Task.org_id == org_id,
            Task.validated_by == osm_username,
        ).first()

        validator_validated_tasks = validator_counts.validated or 0
        validator_invalidated_tasks = validator_counts.invalidated or 0
        self_validated_tasks_count = validator_counts.self_validated or 0

        # Validation earnings via SQL (excluding self-validated)
        validation_earnings = db.session.query(
            func.coalesce(func.sum(Task.validation_rate), 0)
        ).filter(
            Task.org_id == org_id,
            Task.validated_by == osm_username,
            Task.validated == True,
            Task.self_validated == False,
        ).scalar() or 0

        # Invalidation earnings via SQL
        invalidation_earnings = db.session.query(
            func.coalesce(func.sum(Task.validation_rate), 0)
        ).filter(
            Task.org_id == org_id,
            Task.validated_by == osm_username,
            Task.invalidated == True,
        ).scalar() or 0

        # Payment sums via SQL
        requests_total = db.session.query(
            func.coalesce(func.sum(PayRequests.amount_requested), 0)
        ).filter(PayRequests.org_id == org_id, PayRequests.user_id == user_id).scalar() or 0

        payouts_total = db.session.query(
            func.coalesce(func.sum(Payments.amount_paid), 0)
        ).filter(Payments.org_id == org_id, Payments.user_id == user_id).scalar() or 0

        # Payment balances (payable = validated tasks not yet claimed)
        _pay = get_user_payment_balances(g.user)
        payable_total = float(
            _pay["mapping_payable_total"] + _pay["validation_payable_total"]
        )

        # Construct response dictionary
        # Use snake_case field names to match frontend types
        response = {
            "active_projects": all_user_assignments_count,
            "inactive_projects": active_projects_count - all_user_assignments_count,
            "completed_projects": completed_projects_count,
            # Mapped tasks (as mapper)
            "tasks_mapped": user_mapped_tasks_count,
            "mapped_tasks": user_mapped_tasks_count,  # Legacy alias
            # Tasks validated by others (where user was mapper)
            "tasks_validated": user_validated_tasks_count,
            "validated_tasks": user_validated_tasks_count,  # Legacy alias
            "tasks_invalidated": user_invalidated_tasks_count,
            "invalidated_tasks": user_invalidated_tasks_count,  # Legacy alias
            # Validation work done BY this user (as validator)
            "validator_validated": validator_validated_tasks,
            "validator_invalidated": validator_invalidated_tasks,
            "self_validated_count": self_validated_tasks_count,  # For frontend warning display
            # Payment totals
            "mapping_payable_total": _pay["mapping_payable_total"],
            "validation_payable_total": _pay["validation_payable_total"],
            "calculated_validation_earnings": float(validation_earnings) + float(invalidation_earnings),
            "payable_total": payable_total,
            "paid_total": float(payouts_total),  # Alias for frontend
            "requests_total": float(requests_total),
            "payouts_total": float(payouts_total),
            "message": "Stats Fetched",
            "status": 200,
        }
        return response

    def fetch_user_projects(self):
        # Check if user is authenticated
        if not g.user:
            return {"message": "User not found", "status": 304}

        # Fetch only projects the user is assigned to
        user_projects = []

        assigned_project_ids = {
            r.project_id
            for r in ProjectUser.query.filter_by(user_id=g.user.id).all()
        }

        active_projects = Project.query.filter(
            Project.org_id == g.user.org_id,
            Project.status == True,
        ).all()

        # Only include projects the user is assigned to
        active_projects = [
            p for p in active_projects if p.id in assigned_project_ids
        ]

        # Location visibility filter
        user_cids = get_user_country_ids(g.user.id)
        all_pc = ProjectCountry.query.filter(
            ProjectCountry.project_id.in_([p.id for p in active_projects])
        ).all() if active_projects else []
        proj_loc_map = {}
        for r in all_pc:
            proj_loc_map.setdefault(r.project_id, set()).add(r.country_id)
        active_projects = [
            p for p in active_projects
            if is_visible_by_location(proj_loc_map.get(p.id, set()), user_cids)
        ]

        # Per-project "last worked on" timestamps for THIS user (F1).
        # Drives the clock-in dropdown's recent-first sort on the
        # frontend. One grouped aggregation over time_entries — lands
        # on the existing (user_id, status) + project_id indexes.
        last_worked_map = {}
        if active_projects:
            last_worked_rows = (
                db.session.query(
                    TimeEntry.project_id,
                    func.max(TimeEntry.clock_out),
                )
                .filter(
                    TimeEntry.user_id == g.user.id,
                    TimeEntry.project_id.in_([p.id for p in active_projects]),
                    TimeEntry.status != "voided",
                )
                .group_by(TimeEntry.project_id)
                .all()
            )
            last_worked_map = {
                pid: (last_ts.isoformat() + "Z") if last_ts else None
                for pid, last_ts in last_worked_rows
            }

        for project in active_projects:
            user_task_ids = [
                relation.task_id
                for relation in UserTasks.query.filter_by(user_id=g.user.id).all()
            ]
            all_project_tasks = Task.query.filter_by(project_id=project.id).all()
            _proj_stats = get_project_stats_from_tasks(all_project_tasks)
            user_project_task_ids = [
                task.id for task in all_project_tasks if task.id in user_task_ids
            ]
            user_project_tasks = [
                task for task in all_project_tasks if task.id in user_project_task_ids
            ]

            # Use split-aware counting - only counts as 1 when ALL siblings complete
            user_project_mapped_tasks = self._count_tasks_split_aware(
                user_project_tasks,
                lambda t: t.mapped is True and t.validated is False and t.invalidated is False
            )
            user_project_approved_tasks = self._count_tasks_split_aware(
                user_project_tasks,
                lambda t: t.mapped is True and t.validated is True and t.invalidated is False
            )
            user_project_unapproved_tasks = self._count_tasks_split_aware(
                user_project_tasks,
                lambda t: t.mapped is True and t.validated is False and t.invalidated is True
            )

            # Calculate earnings using split-aware payment calculation
            user_mapping_earnings = sum(
                self._calculate_task_payment(task, is_mapping=True)
                for task in user_project_tasks
                if task.validated is True and not getattr(task, 'self_validated', False)
            )
            user_project_earnings = user_mapping_earnings
            user_projects.append(
                {
                    "id": project.id,
                    "name": project.name,
                    "short_name": project.short_name or "",
                    "visibility": project.visibility,
                    "max_payment": project.max_payment,
                    "payment_due": project.payment_due,
                    "total_payout": project.total_payout,
                    "validation_rate_per_task": project.validation_rate_per_task,  # noqa: E501
                    "mapping_rate_per_task": project.mapping_rate_per_task,
                    "max_editors": project.max_editors,
                    "total_editors": project.total_editors,
                    "max_validators": project.max_editors,
                    "total_validators": project.total_editors,
                    "total_tasks": project.total_tasks,
                    "url": project.url,
                    "difficulty": project.difficulty,
                    "source": project.source,
                    "payments_enabled": project.payments_enabled,
                    "tasks_mapped": user_project_mapped_tasks,
                    "tasks_approved": user_project_approved_tasks,
                    "tasks_unapproved": user_project_unapproved_tasks,
                    "total_mapped": _proj_stats["tasks_mapped"],
                    "total_validated": _proj_stats["tasks_validated"],
                    "total_invalidated": _proj_stats["tasks_invalidated"],
                    "user_earnings": user_project_earnings,
                    "status": project.status,
                    # For F1 — frontend sorts the clock-in dropdown
                    # so the user's most-recent project pins to the
                    # top. null for projects they've never clocked
                    # into (sort to bottom on the client).
                    "last_worked_on": last_worked_map.get(project.id),
                }
            )

        return {
            "user_projects": user_projects,
            "message": "Projects found",
            "status": 200,
        }

    @requires_admin
    def assign_user_project(self):
        # Check if user is authenticated
        if not g:
            return {"message": "User not found", "status": 304}
        project_id = request.json.get("project_id")
        user_id = request.json.get("user_id")
        if not user_id:
            return {"message": "user_id required", "status": 400}
        if not project_id:
            return {"message": "project_id required", "status": 400}
        target_project = Project.query.filter_by(id=project_id).first()
        if target_project.total_editors == target_project.max_editors:
            return {"message": "Editor limit reached", "status": 400}
        ProjectUser.create(project_id=project_id, user_id=user_id)
        if not target_project:
            return {
                "message": "project %s not found" % (project_id),
                "status": 400,
            }
        new_editor_count = target_project.total_editors + 1
        target_project.update(total_editors=new_editor_count)
        return {
            "message": "User %s has joined project %s" % (user_id, project_id),
            "status": 200,
        }

    @requires_admin
    def unassign_user_project(self):
        # Check if user is authenticated
        if not g:
            return {"message": "User not found", "status": 304}
        project_id = request.json.get("project_id")
        user_id = request.json.get("user_id")
        if not user_id:
            return {"message": "user_id required", "status": 400}
        if not project_id:
            return {"message": "project_id required", "status": 400}
        target_relation = ProjectUser.query.filter_by(
            project_id=project_id, user_id=user_id
        ).first()
        if not target_relation:
            return {"message": "project assignment not found", "status": 400}
        target_relation.delete(soft=False)
        target_project = Project.query.filter_by(id=project_id).first()
        if not target_project:
            return {
                "message": "project %s not found" % (project_id),
                "status": 400,
            }
        new_editor_count = target_project.total_editors - 1
        target_project.update(total_editors=new_editor_count)
        return {
            "message": "User %s has left project %s" % (user_id, project_id),
            "status": 200,
        }

    def fetch_validator_projects(self):
        # Check if user is authenticated
        if not g:
            return {"message": "User not found", "status": 304}

        # Get all projects for the validator
        org_active_projects = []
        org_inactive_projects = []
        unassigned_projects_with_validations = []

        all_user_project_ids = [
            relation.project_id
            for relation in ProjectUser.query.filter_by(user_id=g.user.id).all()
        ]

        # Find projects where user has validated tasks but is not assigned
        validated_project_ids = set(
            row[0]
            for row in db.session.query(Task.project_id.distinct()).filter(
                Task.org_id == g.user.org_id,
                Task.validated_by == g.user.osm_username,
            ).all()
        )
        unassigned_validation_project_ids = validated_project_ids - set(all_user_project_ids)

        user_joined_projects = [
            project
            for project in Project.query.filter_by(
                org_id=g.user.org_id, status=True
            ).all()
            if project.id in all_user_project_ids
        ]

        # Projects where user validated tasks but is not assigned
        unassigned_validation_projects = [
            project
            for project in Project.query.filter_by(
                org_id=g.user.org_id, status=True
            ).all()
            if project.id in unassigned_validation_project_ids
        ]

        user_available_projects = [
            project
            for project in Project.query.filter_by(
                org_id=g.user.org_id, status=True
            ).all()
            if project.id not in all_user_project_ids
            and project.id not in unassigned_validation_project_ids
            and project.total_editors < project.max_editors
        ]

        # Location visibility filter for available projects
        val_user_cids = get_user_country_ids(g.user.id)
        all_avail_ids = [p.id for p in user_available_projects]
        if all_avail_ids:
            _avail_pc = ProjectCountry.query.filter(
                ProjectCountry.project_id.in_(all_avail_ids)
            ).all()
        else:
            _avail_pc = []
        _avail_loc = {}
        for r in _avail_pc:
            _avail_loc.setdefault(r.project_id, set()).add(r.country_id)
        user_available_projects = [
            p for p in user_available_projects
            if is_visible_by_location(_avail_loc.get(p.id, set()), val_user_cids)
        ]

        # Add each project to the list
        for project in user_joined_projects:
            user_task_ids = [
                relation.task_id
                for relation in UserTasks.query.filter_by(user_id=g.user.id).all()
            ]
            all_project_tasks = Task.query.filter_by(project_id=project.id).all()
            user_project_task_ids = [
                task.id for task in all_project_tasks if task.id in user_task_ids
            ]
            user_project_tasks = [
                task for task in all_project_tasks if task.id in user_project_task_ids
            ]

            # Use split-aware counting - only counts as 1 when ALL siblings complete
            user_project_mapped_tasks = self._count_tasks_split_aware(
                user_project_tasks,
                lambda t: t.mapped is True and t.validated is False and t.invalidated is False
            )
            user_project_approved_tasks = self._count_tasks_split_aware(
                user_project_tasks,
                lambda t: t.mapped is True and t.validated is True and t.invalidated is False
            )
            user_project_unapproved_tasks = self._count_tasks_split_aware(
                user_project_tasks,
                lambda t: t.mapped is True and t.validated is False and t.invalidated is True
            )

            # Exclude self-validated tasks from payment counts (keep list for earnings calc)
            user_project_validated_tasks_list = [
                task
                for task in all_project_tasks
                if task.mapped is True
                and task.validated is True
                and task.invalidated is False
                and task.validated_by == g.user.osm_username
                and not task.self_validated
            ]
            # Split-aware count for display
            user_project_validated_tasks = self._count_tasks_split_aware(
                all_project_tasks,
                lambda t: t.mapped is True
                and t.validated is True
                and t.invalidated is False
                and t.validated_by == g.user.osm_username
                and not t.self_validated
            )

            user_project_invalidated_tasks_list = [
                task
                for task in all_project_tasks
                if task.mapped is True
                and task.validated is False
                and task.invalidated is True
                and task.validated_by == g.user.osm_username
            ]
            # Split-aware count for display
            user_project_invalidated_tasks = self._count_tasks_split_aware(
                all_project_tasks,
                lambda t: t.mapped is True
                and t.validated is False
                and t.invalidated is True
                and t.validated_by == g.user.osm_username
            )

            # Count self-validated tasks for warning display (split-aware)
            self_validated_count = self._count_tasks_split_aware(
                all_project_tasks,
                lambda t: t.validated is True
                and t.validated_by == g.user.osm_username
                and t.self_validated is True
            )

            # Calculate earnings using split-aware payment calculation
            user_mapping_earnings = sum(
                self._calculate_task_payment(task, is_mapping=True)
                for task in user_project_tasks
                if task.validated is True and not task.self_validated
            )
            user_validator_earnings = sum(
                self._calculate_task_payment(task, is_mapping=False)
                for task in user_project_validated_tasks_list
            )
            user_invalidator_earnings = sum(
                self._calculate_task_payment(task, is_mapping=False)
                for task in user_project_invalidated_tasks_list
            )
            user_project_earnings = (
                user_mapping_earnings
                + user_validator_earnings
                + user_invalidator_earnings
            )

            org_active_projects.append(
                {
                    "id": project.id,
                    "name": project.name,
                    "short_name": project.short_name or "",
                    "visibility": project.visibility,
                    "max_payment": project.max_payment,
                    "payment_due": project.payment_due,
                    "total_payout": project.total_payout,
                    "validation_rate_per_task": project.validation_rate_per_task,  # noqa: E501
                    "mapping_rate_per_task": project.mapping_rate_per_task,
                    "max_editors": project.max_editors,
                    "total_editors": project.total_editors,
                    "max_validators": project.max_validators,
                    "total_validators": project.total_validators,
                    "total_tasks": project.total_tasks,
                    "url": project.url,
                    "difficulty": project.difficulty,
                    "source": project.source,
                    "payments_enabled": project.payments_enabled,
                    "tasks_mapped": user_project_mapped_tasks,
                    "tasks approved": user_project_approved_tasks,
                    "tasks unapproved": user_project_unapproved_tasks,
                    "tasks_validated": user_project_validated_tasks,
                    "tasks_invalidated": user_project_invalidated_tasks,
                    "self_validated_count": self_validated_count,
                    "user_earnings": user_project_earnings,
                    "status": project.status,
                }
            )
        for project in user_available_projects:
            org_inactive_projects.append(
                {
                    "id": project.id,
                    "name": project.name,
                    "short_name": project.short_name or "",
                    "visibility": project.visibility,
                    "max_payment": project.max_payment,
                    "payment_due": project.payment_due,
                    "total_payout": project.total_payout,
                    "validation_rate_per_task": project.validation_rate_per_task,  # noqa: E501
                    "mapping_rate_per_task": project.mapping_rate_per_task,
                    "max_editors": project.max_editors,
                    "total_editors": project.total_editors,
                    "max_validators": project.max_validators,
                    "total_validators": project.total_validators,
                    "total_tasks": project.total_tasks,
                    "url": project.url,
                    "difficulty": project.difficulty,
                    "source": project.source,
                    "payments_enabled": project.payments_enabled,
                    # "tasks_mapped": user_project_mapped_tasks,
                    # "tasks approved": user_project_approved_tasks,
                    # "tasks unapproved": user_project_unapproved_tasks,
                    # "tasks_validated": user_project_validated_tasks,
                    # "tasks_invalidated": user_project_invalidated_tasks,
                    # "user_earnings":user_project_earnings,
                    "status": project.status,
                }
            )

        # Projects where user validated tasks but is not assigned
        for project in unassigned_validation_projects:
            all_project_tasks = Task.query.filter_by(project_id=project.id).all()

            # Only count tasks validated by this user (no mapping stats since unassigned)
            user_project_validated_tasks = len(
                [
                    task
                    for task in all_project_tasks
                    if task.validated is True
                    and task.validated_by == g.user.osm_username
                    and not task.self_validated
                ]
            )
            user_project_invalidated_tasks = len(
                [
                    task
                    for task in all_project_tasks
                    if task.invalidated is True
                    and task.validated_by == g.user.osm_username
                ]
            )
            # Count self-validated tasks for warning
            self_validated_count = len(
                [
                    task
                    for task in all_project_tasks
                    if task.validated is True
                    and task.validated_by == g.user.osm_username
                    and task.self_validated is True
                ]
            )

            user_validator_earnings = sum(
                self._calculate_task_payment(task, is_mapping=False)
                for task in all_project_tasks
                if task.validated is True
                and task.validated_by == g.user.osm_username
                and not task.self_validated
            )
            user_invalidator_earnings = sum(
                self._calculate_task_payment(task, is_mapping=False)
                for task in all_project_tasks
                if task.invalidated is True
                and task.validated_by == g.user.osm_username
            )
            user_project_earnings = user_validator_earnings + user_invalidator_earnings

            unassigned_projects_with_validations.append(
                {
                    "id": project.id,
                    "name": project.name,
                    "short_name": project.short_name or "",
                    "visibility": project.visibility,
                    "max_payment": project.max_payment,
                    "payment_due": project.payment_due,
                    "total_payout": project.total_payout,
                    "validation_rate_per_task": project.validation_rate_per_task,
                    "mapping_rate_per_task": project.mapping_rate_per_task,
                    "max_editors": project.max_editors,
                    "total_editors": project.total_editors,
                    "max_validators": project.max_validators,
                    "total_validators": project.total_validators,
                    "total_tasks": project.total_tasks,
                    "url": project.url,
                    "difficulty": project.difficulty,
                    "source": project.source,
                    "payments_enabled": project.payments_enabled,
                    "tasks_mapped": 0,  # Not assigned, so no mapping
                    "tasks approved": 0,
                    "tasks unapproved": 0,
                    "tasks_validated": user_project_validated_tasks,
                    "tasks_invalidated": user_project_invalidated_tasks,
                    "self_validated_count": self_validated_count,
                    "user_earnings": user_project_earnings,
                    "status": project.status,
                    "unassigned": True,  # Flag for frontend
                }
            )

        return {
            "org_active_projects": org_active_projects,
            "org_inactive_projects": org_inactive_projects,
            "unassigned_validation_projects": unassigned_projects_with_validations,
            "message": "Projects found",
            "status": 200,
        }

    @requires_admin
    def purge_all_projects(self):
        """DEV ONLY: Purge all projects and related data."""
        if not g.user:
            return {"message": "User not found", "status": 304}

        org_id = g.user.org_id

        # Get all project IDs for this org
        projects = Project.query.filter_by(org_id=org_id).all()
        project_ids = [p.id for p in projects]

        # Delete all user-task relations for these projects
        for pid in project_ids:
            tasks = Task.query.filter_by(project_id=pid).all()
            task_ids = [t.id for t in tasks]
            for tid in task_ids:
                user_tasks = UserTasks.query.filter_by(task_id=tid).all()
                for ut in user_tasks:
                    ut.delete(soft=False)

        # Delete all tasks for these projects
        tasks_deleted = 0
        for pid in project_ids:
            tasks = Task.query.filter_by(project_id=pid).all()
            tasks_deleted += len(tasks)
            for task in tasks:
                task.delete(soft=False)

        # Delete all project-user relations
        for pid in project_ids:
            project_users = ProjectUser.query.filter_by(project_id=pid).all()
            for pu in project_users:
                pu.delete(soft=False)

        # Delete all projects
        projects_deleted = len(projects)
        for project in projects:
            project.delete(soft=False)

        # Reset user project-related stats
        users = User.query.filter_by(org_id=org_id).all()
        users_reset = 0
        for user in users:
            user.update(
                total_tasks_mapped=0,
                total_tasks_validated=0,
                mapping_payable_total=0,
                validation_payable_total=0,
            )
            users_reset += 1

        return {
            "message": "All projects purged",
            "projects_deleted": projects_deleted,
            "tasks_deleted": tasks_deleted,
            "users_reset": users_reset,
            "status": 200,
        }

    @requires_admin
    def fetch_project_trainings(self):
        """Fetch trainings assigned to a project and all available trainings."""
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        project_id = request.json.get("project_id")
        if not project_id:
            return {"message": "project_id required", "status": 400}

        # Get assigned training IDs for this project
        assigned_rows = ProjectTraining.query.filter_by(
            project_id=project_id
        ).all()
        assigned_ids = {row.training_id for row in assigned_rows}

        # Get all trainings for this org
        all_trainings = Training.query.filter_by(
            org_id=g.user.org_id
        ).all()

        assigned_trainings = []
        available_trainings = []
        for t in all_trainings:
            info = {
                "id": t.id,
                "title": t.title,
                "training_type": t.training_type,
                "difficulty": t.difficulty,
            }
            if t.id in assigned_ids:
                assigned_trainings.append(info)
            else:
                available_trainings.append(info)

        return {
            "assigned_trainings": assigned_trainings,
            "available_trainings": available_trainings,
            "status": 200,
        }

    @requires_admin
    def assign_project_training(self):
        """Assign a training to a project."""
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        project_id = request.json.get("project_id")
        training_id = request.json.get("training_id")
        if not project_id or not training_id:
            return {"message": "project_id and training_id required", "status": 400}

        # Check project belongs to this org
        project = Project.query.filter_by(
            id=project_id, org_id=g.user.org_id
        ).first()
        if not project:
            return {"message": "Project not found", "status": 404}

        # Check training belongs to this org
        training = Training.query.filter_by(
            id=training_id, org_id=g.user.org_id
        ).first()
        if not training:
            return {"message": "Training not found", "status": 404}

        # Check if already assigned
        existing = ProjectTraining.query.filter_by(
            project_id=project_id, training_id=training_id
        ).first()
        if existing:
            return {"message": "Training already assigned", "status": 200}

        ProjectTraining.create(
            project_id=project_id,
            training_id=training_id,
        )

        return {"message": "Training assigned", "status": 200}

    @requires_admin
    def unassign_project_training(self):
        """Remove a training from a project."""
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        project_id = request.json.get("project_id")
        training_id = request.json.get("training_id")
        if not project_id or not training_id:
            return {"message": "project_id and training_id required", "status": 400}

        row = ProjectTraining.query.filter_by(
            project_id=project_id, training_id=training_id
        ).first()
        if not row:
            return {"message": "Assignment not found", "status": 404}

        row.delete(soft=False)
        return {"message": "Training unassigned", "status": 200}
