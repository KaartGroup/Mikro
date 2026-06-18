#!/usr/bin/env python3
"""
Project API endpoints for Mikro.

Handles project management operations.
TM3 support has been removed - all projects are now TM4.
"""

import re

import requests
from flask.views import MethodView
from flask import g, request, current_app
from sqlalchemy import func

from ..utils import requires_admin, requires_auth, requires_team_admin_or_above
from ..auth import (
    is_org_admin_or_above,
    team_admin_can_access_user,
)
from ..filters import resolve_filtered_user_ids
from ..stats import count_tasks_split_aware, get_project_stats_from_tasks, get_batch_project_stats_fast
from ..services.project_service import ProjectService
from ..time_tracking import AggregateQuery, ACTIVITY_DISPLAY_MAP
from .MapRoulette import MapRouletteSync
from ..database import (
    db,
    Project,
    Task,
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



class ProjectAPI(MethodView):
    """Project management API endpoints."""

    def _get_tm4_base_url(self):
        return ProjectService.get_tm4_base_url()

    def _detect_source(self, url):
        return ProjectService.detect_source(url)

    def _extract_mr_challenge_id(self, url):
        return ProjectService.extract_mr_challenge_id(url)

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
        elif path == "fetch_deleted_projects":
            return self.fetch_deleted_projects()
        elif path == "restore_project":
            return self.restore_project()
        elif path == "purge_project":
            return self.purge_project()
        elif path == "request_reactivation":
            return self.request_reactivation()
        elif path == "fetch_my_archived_projects":
            return self.fetch_my_archived_projects()
        elif path == "dismiss_reactivation_request":
            return self.dismiss_reactivation_request()
        elif path == "calculate_budget":
            return self.calculate_budget()
        elif path == "fetch_org_projects":
            return self.fetch_org_projects()
        elif path == "fetch_org_projects_paged":
            return self.fetch_org_projects_paged()
        elif path == "fetch_org_projects_stats":
            return self.fetch_org_projects_stats()
        elif path == "fetch_user_projects":
            return self.fetch_user_projects()
        elif path == "fetch_user_projects_paged":
            return self.fetch_user_projects_paged()
        elif path == "update_project":
            return self.update_project()
        elif path == "assign_user_project":
            return self.assign_user_project()
        elif path == "unassign_user_project":
            return self.unassign_user_project()
        elif path == "fetch_project_profile":
            return self.fetch_project_profile()
        elif path == "lookup_project_by_url":
            return self.lookup_project_by_url()

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

        # Check if required data is provided. Rates are intentionally NOT in
        # this list: a project with payments disabled sends rate 0, and a
        # blanket truthy check would reject 0 as "missing". Rates are validated
        # conditionally further down (only required when payments_enabled).
        required_args = [
            "url",
            "rate_type",
            "visibility",
        ]

        for arg in required_args:
            if not request.json.get(arg):
                return {"message": f"{arg} required", "status": 400}

        # Assign the data to variables
        url = request.json.get("url")

        rate_type = request.json.get("rate_type")
        mapping_rate = float(request.json.get("mapping_rate") or 0)
        validation_rate = float(request.json.get("validation_rate") or 0)
        _vis = request.json.get("visibility")
        visibility = True if _vis is None else bool(_vis)
        payments_enabled = request.json.get("payments_enabled", True)
        short_name_input = request.json.get("short_name", "").strip()
        community = bool(request.json.get("community", False))
        priority = request.json.get("priority", "Medium")

        svc = ProjectService()
        source = svc.detect_source(url)
        if source == "mr":
            return svc.create_mr_project(
                url=url,
                rate_type=rate_type,
                mapping_rate=mapping_rate,
                validation_rate=validation_rate,
                visibility=visibility,
                payments_enabled=payments_enabled,
                community=community,
                priority=priority,
                org_id=g.user.org_id,
                created_by=g.user.id,
            )
        return svc.create_tm4_project(
            url=url,
            rate_type=rate_type,
            mapping_rate=mapping_rate,
            validation_rate=validation_rate,
            visibility=visibility,
            short_name_input=short_name_input,
            payments_enabled=payments_enabled,
            community=community,
            priority=priority,
            org_id=g.user.org_id,
            created_by=g.user.id,
        )

    @requires_team_admin_or_above
    def update_project(self):
        """Update a project's payment rates, visibility, status, etc."""
        if not hasattr(g, "user") or not g.user:
            return {"message": "Missing user info", "status": 304}

        required_args = ["difficulty", "project_id"]
        for arg in required_args:
            if not request.json.get(arg):
                return {"message": f"{arg} required", "status": 400}

        project_status = bool(request.json.get("project_status", False))

        return ProjectService.update_project(
            project_id=request.json.get("project_id"),
            org_id=g.user.org_id,
            difficulty=request.json.get("difficulty"),
            rate_type=request.json.get("rate_type"),
            mapping_rate=float(request.json.get("mapping_rate") or 0),
            validation_rate=float(request.json.get("validation_rate") or 0),
            visibility=request.json.get("visibility"),
            project_status=project_status,
            payments_enabled=request.json.get("payments_enabled"),
            short_name=request.json.get("short_name"),
            community=request.json.get("community"),
            priority=request.json.get("priority"),
        )

    @requires_team_admin_or_above
    def delete_project(self):
        if not g.user:
            return {"message": "Missing user info", "status": 304}
        project_id = request.json.get("project_id")
        if not project_id:
            return {"message": "project_id required", "status": 400}
        return ProjectService.delete_project(project_id=project_id, user=g.user)

    @requires_team_admin_or_above
    def fetch_deleted_projects(self):
        """List soft-deleted projects recoverable by the current user."""
        if not g.user:
            return {"message": "Missing user info", "status": 304}
        return ProjectService.fetch_deleted_projects(user=g.user)

    @requires_team_admin_or_above
    def restore_project(self):
        """Restore a soft-deleted project (clears deleted_date)."""
        if not g.user:
            return {"message": "Missing user info", "status": 304}
        project_id = request.json.get("project_id")
        if not project_id:
            return {"message": "project_id required", "status": 400}
        return ProjectService.restore_project(project_id=project_id, user=g.user)

    @requires_team_admin_or_above
    def purge_project(self):
        """Permanently delete an already soft-deleted project. Org admin only.

        Gated with @requires_team_admin_or_above at the view layer but
        enforces org-admin internally via is_org_admin_or_above — mirroring
        how delete_project gates team_admin scope inside the service rather
        than relying on a separate decorator.
        """
        if not g.user:
            return {"message": "Missing user info", "status": 304}
        project_id = request.json.get("project_id")
        if not project_id:
            return {"message": "project_id required", "status": 400}
        return ProjectService.purge_project(project_id=project_id, user=g.user)

    @requires_auth
    def request_reactivation(self):
        """Let an assigned mapper request reactivation of an archived project.

        Open to any authenticated user — the service enforces that the
        requester is actually assigned to the (archived) project.
        """
        if not g.user:
            return {"message": "Missing user info", "status": 304}
        project_id = request.json.get("project_id")
        if not project_id:
            return {"message": "project_id required", "status": 400}
        reason = request.json.get("reason")
        return ProjectService.request_reactivation(
            project_id=project_id, reason=reason, user=g.user
        )

    @requires_auth
    def fetch_my_archived_projects(self):
        """List archived projects the current user is assigned to."""
        if not g.user:
            return {"message": "Missing user info", "status": 304}
        return ProjectService.fetch_my_archived_projects(user=g.user)

    @requires_team_admin_or_above
    def dismiss_reactivation_request(self):
        """Clear a pending reactivation request (project stays archived)."""
        if not g.user:
            return {"message": "Missing user info", "status": 304}
        project_id = request.json.get("project_id")
        if not project_id:
            return {"message": "project_id required", "status": 400}
        return ProjectService.dismiss_reactivation_request(
            project_id=project_id, user=g.user
        )

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

    _EMPTY_TASK_COUNTS = {
        "effective_mapped": 0, "effective_validated": 0, "effective_invalidated": 0,
        "raw_mapped": 0, "raw_validated": 0, "raw_invalidated": 0,
        "split_task_groups": 0, "split_task_count": 0, "mr_status_breakdown": {},
    }

    @staticmethod
    def _int_or_none(val):
        try:
            return int(val) if val is not None else None
        except (TypeError, ValueError):
            return None

    def _serialize_projects(self, svc, projects):
        """Serialize a list of Project rows to the response shape, computing
        the per-project task / location / training stats in batch for ONLY
        the supplied projects. Shared by the full-list and paginated
        endpoints so their item shape never drifts."""
        project_ids = [p.id for p in projects]
        loc_counts = svc.get_location_counts(project_ids)
        trn_counts = svc.get_training_counts(project_ids)
        batch_task_stats = get_batch_project_stats_fast(project_ids)

        def _serialize(project):
            tc = batch_task_stats.get(project.id, self._EMPTY_TASK_COUNTS)
            return {
                "id": project.id,
                "name": project.name,
                "short_name": project.short_name or "",
                "visibility": project.visibility,
                "max_payment": project.max_payment,
                "payment_due": project.payment_due,
                "total_payout": project.total_payout,
                "validation_rate_per_task": project.validation_rate_per_task,
                "mapping_rate_per_task": project.mapping_rate_per_task,
                "total_editors": project.total_editors,
                "total_tasks": project.total_tasks,
                "url": project.url,
                "difficulty": project.difficulty,
                "community": project.community,
                "priority": project.priority,
                "source": project.source,
                "created_by": project.created_by,
                "can_delete": (
                    is_org_admin_or_above(g.user)
                    or project.created_by == g.user.id
                ),
                "total_mapped": tc["effective_mapped"],
                "total_validated": tc["effective_validated"],
                "total_invalidated": tc["effective_invalidated"],
                "raw_mapped": tc["raw_mapped"],
                "raw_validated": tc["raw_validated"],
                "raw_invalidated": tc["raw_invalidated"],
                "split_task_groups": tc["split_task_groups"],
                "mr_status_breakdown": tc.get("mr_status_breakdown", {}),
                "status": project.status,
                "payments_enabled": project.payments_enabled,
                "assigned_locations": loc_counts.get(project.id, 0),
                "assigned_trainings": trn_counts.get(project.id, 0),
                "last_synced": project.last_sync_cursor.isoformat() if project.last_sync_cursor else None,
            }

        return [_serialize(p) for p in projects]

    @requires_team_admin_or_above
    def fetch_org_projects(self):
        if not g:
            return {"message": "User not found", "status": 304}

        req_body = request.json if request.json else {}

        svc = ProjectService()
        projects = svc.get(
            org_id=g.user.org_id,
            user=g.user,
            filters={
                "country_id": self._int_or_none(req_body.get("country_id")),
                "region_id": self._int_or_none(req_body.get("region_id")),
                "team_id": self._int_or_none(req_body.get("team_id")),
                "created_by_me": req_body.get("created_by_me", False),
                "user_ids": resolve_filtered_user_ids(
                    req_body.get("filters"), g.user.org_id
                ),
            },
        )

        active_projects = [p for p in projects if p.status]
        inactive_projects = [p for p in projects if not p.status]

        return {
            "org_active_projects": self._serialize_projects(svc, active_projects),
            "org_inactive_projects": self._serialize_projects(svc, inactive_projects),
            "message": "Projects found",
            "status": 200,
        }

    @requires_team_admin_or_above
    def fetch_org_projects_paged(self):
        """One sorted, filtered, paginated page of projects for a single
        status tab. Body: status (bool), search, community (bool),
        priority, country_id, region_id, team_id, created_by_me,
        sort_key, sort_dir, page, page_size."""
        if not g:
            return {"message": "User not found", "status": 304}

        req_body = request.json if request.json else {}
        svc = ProjectService()

        status = req_body.get("status")
        items, total = svc.get_page(
            org_id=g.user.org_id,
            user=g.user,
            filters=self._list_filters(req_body, status=status),
            sort_key=req_body.get("sort_key") or "name",
            sort_dir=req_body.get("sort_dir") or "asc",
            page=self._int_or_none(req_body.get("page")) or 1,
            page_size=self._int_or_none(req_body.get("page_size")) or 20,
        )

        return {
            "projects": self._serialize_projects(svc, items),
            "total": total,
            "page": self._int_or_none(req_body.get("page")) or 1,
            "page_size": self._int_or_none(req_body.get("page_size")) or 20,
            "status": 200,
        }

    @requires_team_admin_or_above
    def fetch_org_projects_stats(self):
        """Aggregate counts for the stat cards + tab badges over the filtered
        set (status excluded so both active/inactive counts are reported)."""
        if not g:
            return {"message": "User not found", "status": 304}

        req_body = request.json if request.json else {}
        svc = ProjectService()
        counts = svc.get_status_counts(
            org_id=g.user.org_id,
            user=g.user,
            filters=self._list_filters(req_body, status=None),
        )
        return {**counts, "status": 200}

    def _list_filters(self, req_body, status):
        """Build the ProjectService filter dict shared by the paged + stats
        endpoints. ``status`` is passed explicitly (None to omit)."""
        community = req_body.get("community")
        return {
            "status": status if isinstance(status, bool) else None,
            "search": req_body.get("search"),
            "community": community if isinstance(community, bool) else None,
            "priority": req_body.get("priority"),
            "country_id": self._int_or_none(req_body.get("country_id")),
            "region_id": self._int_or_none(req_body.get("region_id")),
            "team_id": self._int_or_none(req_body.get("team_id")),
            "created_by_me": req_body.get("created_by_me", False),
            "user_ids": resolve_filtered_user_ids(
                req_body.get("filters"), g.user.org_id
            ),
        }

    @requires_team_admin_or_above
    def lookup_project_by_url(self):
        """Preflight duplicate check for the Add-Project modal.

        The frontend posts a URL the admin has just pasted in and we
        report whether Mikro already has that source project — same
        org or another org. Lets the admin abort the form before
        filling everything out only to hit a hard 400 on submit.

        Response shape:
            { exists: false }                            no record at this id
            { exists: true, same_org: true, project: {.}}  importable; admin
                                                            should open it
                                                            instead
            { exists: true, same_org: false }            another org owns it;
                                                            no leakage of name
        """
        if not g.user:
            return {"message": "User not found", "status": 304}
        url = (request.json or {}).get("url", "").strip()
        if not url:
            return {"message": "url required", "status": 400}
        # Reuse the source-detect + ID-extract helpers so this stays in
        # lock-step with whatever create_project will derive from the
        # same URL.
        source = self._detect_source(url)
        project_id = None
        if source == "mr":
            project_id = self._extract_mr_challenge_id(url)
        else:
            m = re.match(r"^.*\/([0-9]+)$", url)
            if m:
                project_id = int(m.group(1))
        if project_id is None:
            # parseable=false sentinel: caller distinguishes via this flag,
            # NOT via the absence of source_id (a fresh-but-parseable URL
            # also returns exists:false but DOES carry source_id below).
            return {
                "status": 200,
                "exists": False,
                "parseable": False,
                "message": "Could not extract a project id from the URL",
            }
        existing = Project.query.filter_by(id=project_id).first()
        if not existing:
            return {
                "status": 200,
                "exists": False,
                "parseable": True,
                "source": source,
                "source_id": project_id,
            }
        same_org = existing.org_id == g.user.org_id
        out = {
            "status": 200,
            "exists": True,
            "parseable": True,
            "same_org": same_org,
            "source": source,
            "source_id": project_id,
        }
        if same_org:
            # Show enough for the admin to open it instead; never leak
            # cross-org project names.
            out["project"] = {
                "id": existing.id,
                "name": existing.name,
                "short_name": existing.short_name,
            }
        return out

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

        # Per-user time entries — completed-only seconds for this project,
        # via the shared AggregateQuery scope (org + status) with the
        # project filter layered on the bare queryset.
        user_time = {}
        time_rows = (
            AggregateQuery(project.org_id, {}, viewer=None)
            .queryset()
            .with_entities(TimeEntry.user_id, func.sum(TimeEntry.duration_seconds))
            .filter(TimeEntry.project_id == project.id)
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

        # --- Time tracking summary --- completed-only seconds per activity
        # for this project, via the shared AggregateQuery scope.
        time_cat_rows = (
            AggregateQuery(project.org_id, {}, viewer=None)
            .queryset()
            .with_entities(TimeEntry.activity, func.sum(TimeEntry.duration_seconds))
            .filter(TimeEntry.project_id == project.id)
            .group_by(TimeEntry.activity)
            .all()
        )
        # `by_category` is keyed by the display label (e.g. "QC / Validation")
        # so the frontend can render it directly. The model column is `activity`
        # (slug); we display-map via ACTIVITY_DISPLAY_MAP. JSON key kept as
        # `by_category` for frontend back-compat, mirroring the convention in
        # TimeTracking.py:444-449.
        time_by_category = {}
        total_time_seconds = 0
        for activity_slug, secs in time_cat_rows:
            if activity_slug and secs:
                display = ACTIVITY_DISPLAY_MAP.get(
                    activity_slug,
                    activity_slug.capitalize() if activity_slug else "",
                )
                time_by_category[display] = time_by_category.get(display, 0) + secs
                total_time_seconds += secs

        # Recent time entries (last 20). Completed-only scope comes from the
        # shared AggregateQuery; this list orders by clock_out (not the
        # clock_in default), so the ordering/limit is layered on the queryset.
        recent_entries = (
            AggregateQuery(project.org_id, {}, viewer=None)
            .queryset()
            .filter(TimeEntry.project_id == project.id)
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
            # Mirror TimeTracking.py:444-449 convention: `category` is the
            # display label (kept for frontend back-compat), `activity` is the
            # raw slug. Model column was renamed `category` -> `activity` in
            # migration c4f8a9b0d1e2 — reading e.activity here, never e.category.
            recent_entries_data.append({
                "user_name": (f"{eu.first_name or ''} {eu.last_name or ''}".strip() or eu.email) if eu else "Unknown",
                "first_name": (eu.first_name or "") if eu else "",
                "last_name": (eu.last_name or "") if eu else "",
                "category": ACTIVITY_DISPLAY_MAP.get(
                    e.activity,
                    e.activity.capitalize() if e.activity else "",
                ),
                "activity": e.activity,
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
                "community": project.community,
                "priority": project.priority,
                "created_by": project.created_by,
                "created_by_name": created_by_name,
                "total_tasks": project.total_tasks,
                "mapping_rate_per_task": project.mapping_rate_per_task,
                "validation_rate_per_task": project.validation_rate_per_task,
                "max_payment": project.max_payment,
                "payment_due": project.payment_due,
                "total_payout": project.total_payout,
                "payments_enabled": project.payments_enabled,
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

    def fetch_user_projects(self):
        if not g.user:
            return {"message": "User not found", "status": 304}

        body = request.get_json(silent=True) or {}
        country_id = int(body["country_id"]) if body.get("country_id") else None
        region_id = int(body["region_id"]) if body.get("region_id") else None

        svc = ProjectService()
        active_projects = svc.get(
            org_id=g.user.org_id,
            user=g.user,
            filters={
                "for_user_id": g.user.id,
                "status": True,
                "country_id": country_id,
                "region_id": region_id,
            },
        )

        return {
            "user_projects": self._serialize_user_projects(active_projects),
            "message": "Projects found",
            "status": 200,
        }

    def _serialize_user_projects(self, projects):
        """Enrich + serialize the current user's assigned projects, computing
        per-user task counts for ONLY the supplied projects. Shared by the
        full-list + paginated user endpoints."""
        project_ids = [p.id for p in projects]
        user_projects = []

        user_country_id = g.user.country_id
        in_country_project_ids = set()
        if user_country_id:
            in_country_project_ids = {
                row.project_id
                for row in ProjectCountry.query.filter(
                    ProjectCountry.country_id == user_country_id,
                    ProjectCountry.project_id.in_(project_ids),
                ).all()
            }

        user_task_ids = {
            r.task_id
            for r in UserTasks.query.filter_by(user_id=g.user.id).all()
        }
        tasks_by_project: dict = {}
        for t in Task.query.filter(Task.project_id.in_(project_ids)).all():
            tasks_by_project.setdefault(t.project_id, []).append(t)

        for project in projects:
            all_project_tasks = tasks_by_project.get(project.id, [])
            _proj_stats = get_project_stats_from_tasks(all_project_tasks)
            user_project_tasks = [t for t in all_project_tasks if t.id in user_task_ids]

            # Use split-aware counting - only counts as 1 when ALL siblings complete
            user_project_mapped_tasks = count_tasks_split_aware(
                user_project_tasks,
                lambda t: t.mapped is True and t.validated is False and t.invalidated is False
            )
            user_project_approved_tasks = count_tasks_split_aware(
                user_project_tasks,
                lambda t: t.mapped is True and t.validated is True and t.invalidated is False
            )
            user_project_unapproved_tasks = count_tasks_split_aware(
                user_project_tasks,
                lambda t: t.mapped is True and t.validated is False and t.invalidated is True
            )

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
                    "total_editors": project.total_editors,
                    "total_tasks": project.total_tasks,
                    "url": project.url,
                    "difficulty": project.difficulty,
                    "community": project.community,
                    "priority": project.priority,
                    "source": project.source,
                    "payments_enabled": project.payments_enabled,
                    "tasks_mapped": user_project_mapped_tasks,
                    "tasks_approved": user_project_approved_tasks,
                    "tasks_unapproved": user_project_unapproved_tasks,
                    "total_mapped": _proj_stats["tasks_mapped"],
                    "total_validated": _proj_stats["tasks_validated"],
                    "total_invalidated": _proj_stats["tasks_invalidated"],
                    "user_earnings": 0,
                    "status": project.status,
                    "in_user_country": project.id in in_country_project_ids,
                }
            )

        return user_projects

    def fetch_user_projects_paged(self):
        """One sorted, filtered, paginated page of the current user's assigned
        (active) projects. Body: search, community, priority, country_id,
        region_id, sort_key, sort_dir, page, page_size."""
        if not g.user:
            return {"message": "User not found", "status": 304}

        body = request.get_json(silent=True) or {}
        community = body.get("community")
        svc = ProjectService()
        items, total = svc.get_page(
            org_id=g.user.org_id,
            user=g.user,
            filters={
                "for_user_id": g.user.id,
                "status": True,
                "search": body.get("search"),
                "community": community if isinstance(community, bool) else None,
                "priority": body.get("priority"),
                "country_id": self._int_or_none(body.get("country_id")),
                "region_id": self._int_or_none(body.get("region_id")),
            },
            sort_key=body.get("sort_key") or "name",
            sort_dir=body.get("sort_dir") or "asc",
            page=self._int_or_none(body.get("page")) or 1,
            page_size=self._int_or_none(body.get("page_size")) or 20,
        )

        return {
            "user_projects": self._serialize_user_projects(items),
            "total": total,
            "page": self._int_or_none(body.get("page")) or 1,
            "page_size": self._int_or_none(body.get("page_size")) or 20,
            "status": 200,
        }

    @requires_team_admin_or_above
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
        # team_admin can only attach members of teams they lead.
        # `team_admin_can_access_user` short-circuits to False for any
        # viewer with no managed teams, which would also catch org_admins
        # who don't happen to lead a team — gate explicitly on the role.
        if g.user.role == "team_admin" and not team_admin_can_access_user(g.user, user_id):
            return {
                "message": "User not on a team you manage",
                "status": 403,
            }
        target_project = Project.query.filter_by(id=project_id).first()
        if not target_project:
            return {
                "message": "project %s not found" % (project_id),
                "status": 400,
            }
        ProjectUser.create(project_id=project_id, user_id=user_id)
        new_editor_count = target_project.total_editors + 1
        target_project.update(total_editors=new_editor_count)
        return {
            "message": "User %s has joined project %s" % (user_id, project_id),
            "status": 200,
        }

    @requires_team_admin_or_above
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
        # team_admin scope mirrors assign: can only detach a member of
        # a team they lead. Bypass for org_admin+ — see assign for why
        # the explicit role gate is needed.
        if g.user.role == "team_admin" and not team_admin_can_access_user(g.user, user_id):
            return {
                "message": "User not on a team you manage",
                "status": 403,
            }
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


