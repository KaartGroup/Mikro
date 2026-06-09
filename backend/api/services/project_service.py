#!/usr/bin/env python3
"""
ProjectService — single source of truth for project CRUD operations.

Extracted from ``api/views/Projects.py``. Accepts plain Python arguments
(not request objects) so logic is decoupled from HTTP and is easily testable.
"""

import logging
import re

import requests
from ..database import Team, TeamLead, TeamUser
from sqlalchemy import func
from ..auth.team_scoping import is_org_admin_or_above
from ..database.core import ProjectTeam, ProjectUser
from ..stats import (
    count_tasks_split_aware,
    get_batch_project_stats_fast,
    get_project_stats_from_tasks,
)
from flask import current_app

from ..database import db, Country, Region, Project, ProjectCountry, ProjectTraining


class ProjectService:
    """Project creation, update, and deletion operations."""

    # ─── URL / source helpers ─────────────────────────────────────────────

    @staticmethod
    def detect_source(url: str) -> str:
        """Return ``"mr"`` for MapRoulette URLs, ``"tm4"`` for everything else."""
        if "maproulette" in url.lower():
            return "mr"
        return "tm4"

    @staticmethod
    def extract_mr_challenge_id(url: str):
        """Return the integer challenge ID from a MapRoulette URL, or None."""
        m = re.match(r".*(?:challenges?|challenge)/(\d+)", url)
        if m:
            return int(m.group(1))
        m = re.match(r"^.*\/(\d+)$", url)
        return int(m.group(1)) if m else None

    @staticmethod
    def get_tm4_base_url() -> str:
        return current_app.config.get("TM4_API_URL", "https://tasks.kaart.com/api/v2")

    # ─── Name / country helpers ───────────────────────────────────────────

    @staticmethod
    def strip_trailing_hashtags(name: str) -> str:
        """Return everything before the first ` #` in a project title."""
        if not name:
            return name
        return re.split(r"\s+#", name, 1)[0].strip()

    @staticmethod
    def auto_parse_project_name(name: str):
        """Parse a project name to extract a short display name and country candidate.

        Returns (short_name or None, country_name or None).
        """
        if not name:
            return None, None

        short_name = None
        country_name = None

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

        if len(name) <= 40:
            return None, None

        return short_name, country_name

    @staticmethod
    def auto_assign_country(project_id: int, country_candidate: str) -> None:
        """Link project to a country by name match if one exists."""
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

    # ─── CRUD ─────────────────────────────────────────────────────────────

    def create_tm4_project(
        self,
        url: str,
        rate_type,
        mapping_rate: float,
        validation_rate: float,
        visibility: bool,
        short_name_input: str,
        payments_enabled: bool,
        community: bool,
        priority: str,
        org_id: str,
        created_by: str,
    ) -> dict:
        """Create a new TM4 project. Returns a response dict with a ``status`` key."""
        m = re.match(r"^.*\/([0-9]+)$", url)
        if not m:
            return {"message": "Cannot get project ID from URL", "status": 400}
        project_id = m.group(1)

        project_exists = Project.query.filter_by(id=project_id).first()
        if project_exists:
            same_org = project_exists.org_id == org_id
            return {
                "message": (
                    "Project already exists in this org: "
                    f"\"{project_exists.name}\" (#{project_exists.id})"
                ) if same_org else (
                    "Project source already imported by another organization; "
                    "contact admin to share access."
                ),
                "status": 400,
            }

        base_url = self.get_tm4_base_url()
        stats_api = f"{base_url}/projects/{project_id}/"

        try:
            current_app.logger.info(f"Fetching TM4 project data from: {stats_api}")
            tm_fetch = requests.get(stats_api, timeout=30)
            if not tm_fetch.ok:
                current_app.logger.error(
                    f"TM4 API returned {tm_fetch.status_code}: {tm_fetch.text[:500]}"
                )
                return {"message": f"TM4 API returned status {tm_fetch.status_code}", "status": 400}
        except requests.RequestException as e:
            current_app.logger.error(f"TM4 API request error: {e}")
            return {"message": "TM4 API error", "status": 500}

        try:
            project_data = tm_fetch.json()
        except requests.exceptions.JSONDecodeError:
            current_app.logger.error(
                f"TM4 API returned non-JSON response: {tm_fetch.text[:500]}"
            )
            return {"message": "TM4 API returned invalid response - check project URL", "status": 400}

        project_info = project_data.get("projectInfo", {})
        project_name = project_info.get("name", f"Project {project_id}")
        total_tasks = project_info.get("totalTasks") or len(
            project_data.get("tasks", {}).get("features", [])
        )
        tasks_overlap = project_info.get("tasksOverlap", 0) or 0

        if rate_type is True:
            calculation = (mapping_rate + validation_rate) * total_tasks
        else:
            calculation = 0

        if payments_enabled:
            if mapping_rate < 0.01 or validation_rate < 0.01:
                return {"message": "Rate per task insufficient when payments enabled", "status": 400}

        parsed_short, parsed_country = self.auto_parse_project_name(project_name)
        final_short_name = short_name_input or parsed_short or ""

        Project.create(
            id=project_id,
            org_id=org_id,
            created_by=created_by,
            name=project_name,
            short_name=final_short_name,
            total_tasks=total_tasks,
            tasks_overlap=tasks_overlap,
            max_payment=float(calculation),
            url=url,
            validation_rate_per_task=validation_rate,
            mapping_rate_per_task=mapping_rate,
            visibility=visibility,
            status=True,
            payments_enabled=payments_enabled,
            community=community,
            priority=priority,
        )

        self.auto_assign_country(project_id, parsed_country)

        return {"message": "Project created", "project_id": project_id, "status": 200}

    def create_mr_project(
        self,
        url: str,
        rate_type,
        mapping_rate: float,
        validation_rate: float,
        visibility: bool,
        payments_enabled: bool,
        community: bool,
        priority: str,
        org_id: str,
        created_by: str,
    ) -> dict:
        """Create a new MapRoulette project. Returns a response dict with a ``status`` key."""
        challenge_id = self.extract_mr_challenge_id(url)
        if not challenge_id:
            return {"message": "Cannot get challenge ID from MapRoulette URL", "status": 400}

        project_exists = Project.query.filter_by(id=challenge_id).first()
        if project_exists:
            same_org = project_exists.org_id == org_id
            return {
                "message": (
                    "Project already exists in this org: "
                    f"\"{project_exists.name}\" (#{project_exists.id})"
                ) if same_org else (
                    "Project source already imported by another organization; "
                    "contact admin to share access."
                ),
                "status": 400,
            }

        if payments_enabled:
            if mapping_rate < 0.01 or validation_rate < 0.01:
                return {"message": "Rate per task insufficient when payments enabled", "status": 400}

        project_name = f"MR Challenge {challenge_id}"
        total_tasks = 0

        if rate_type is True:
            calculation = (mapping_rate + validation_rate) * total_tasks
        else:
            calculation = 0

        parsed_short, parsed_country = self.auto_parse_project_name(project_name)
        final_short_name = parsed_short or ""

        Project.create(
            id=challenge_id,
            org_id=org_id,
            created_by=created_by,
            name=project_name,
            short_name=final_short_name,
            total_tasks=total_tasks,
            max_payment=float(calculation),
            url=url,
            validation_rate_per_task=validation_rate,
            mapping_rate_per_task=mapping_rate,
            visibility=visibility,
            status=True,
            source="mr",
            payments_enabled=payments_enabled,
            community=community,
            priority=priority,
        )

        self.auto_assign_country(challenge_id, parsed_country)

        from ..worker.sync_queue import SyncJobQueue
        SyncJobQueue.enqueue_mr_backfill(org_id, challenge_id)

        return {
            "message": "Project created — metadata loading in background",
            "project_id": challenge_id,
            "status": 200,
        }

    @staticmethod
    def update_project(
        project_id,
        org_id: str,
        difficulty: str,
        rate_type,
        mapping_rate: float,
        validation_rate: float,
        visibility,
        project_status: bool,
        payments_enabled,
        short_name,
        community,
        priority,
    ) -> dict:
        """Update an existing project. Returns a response dict with a ``status`` key."""
        target_project = Project.query.filter_by(org_id=org_id, id=project_id).first()
        if not target_project:
            return {"message": f"Project {project_id} not found", "status": 400}

        if payments_enabled is None:
            payments_enabled = target_project.payments_enabled

        if mapping_rate != 0 and validation_rate != 0:
            mapping_calculation = 0
            if rate_type is True:
                mapping_calculation = mapping_rate * target_project.total_tasks
            target_project.update(
                mapping_rate_per_task=mapping_rate,
                max_payment=float(mapping_calculation),
                validation_rate_per_task=validation_rate,
            )

        if short_name is None:
            short_name = target_project.short_name

        target_project.update(
            visibility=visibility,
            difficulty=difficulty,
            status=project_status,
            payments_enabled=payments_enabled,
            short_name=short_name,
        )

        if community is not None:
            target_project.update(community=community)
        if priority is not None:
            target_project.update(priority=priority)

        return {"status": 200}

    @staticmethod
    def delete_project(project_id, user) -> dict:
        """Delete a project. Returns a response dict with a ``status`` key."""
        from ..auth import is_org_admin_or_above

        target_project = Project.query.filter_by(org_id=user.org_id, id=project_id).first()
        if not target_project:
            return {"message": f"Project {project_id} not found", "status": 400}

        if not is_org_admin_or_above(user) and target_project.created_by != user.id:
            return {
                "message": "Team admins can only delete projects they created",
                "status": 403,
            }

        target_project.delete(soft=False)
        return {"message": f"Project {project_id} deleted", "status": 200}
    
    @staticmethod
    def role_scope_projects_query(query, user):
        """Return a base Project query scoped to the user's role visibility."""
        if is_org_admin_or_above(user):
            return query
        elif user.role == "team_admin":
            managed_team_ids = (
                db.select(TeamLead.team_id)
                .where(TeamLead.user_id == user.id)
                .scalar_subquery()
            )
            team_project_ids = (
                db.select(ProjectTeam.project_id)
                .where(ProjectTeam.team_id.in_(managed_team_ids))
                .scalar_subquery()
            )
            query = query.filter(
                db.or_(
                    Project.id.in_(team_project_ids),
                    Project.created_by == user.id,
                )
            )
            return query
        else:
            query = query.join(ProjectUser, ProjectUser.project_id == Project.id).filter(
                ProjectUser.user_id == user.id
            )
            return query

    @staticmethod
    def get_project_by_status(query, status: bool):
        """Return a Project query filtered by active/inactive status."""
        if isinstance(status, bool):
            return query.filter(Project.status == status)
        logging.info(f"Invalid status filter: {status}")
        return query
    
    @staticmethod
    def get_project_by_country(query, country_id: int):
        project_ids = (
            db.select(ProjectCountry.project_id)
            .where(ProjectCountry.country_id == country_id)
            .scalar_subquery()
        )
        return query.filter(Project.id.in_(project_ids))

    @staticmethod
    def get_project_by_region(query, region_id: int):
        country_ids = (
            db.select(Country.id)
            .where(Country.region_id == region_id)
            .scalar_subquery()
        )
        project_ids = (
            db.select(ProjectCountry.project_id)
            .where(ProjectCountry.country_id.in_(country_ids))
            .scalar_subquery()
        )
        return query.filter(Project.id.in_(project_ids))

    @staticmethod
    def get_project_by_team(query, team_id: int):
        project_ids = (
            db.select(ProjectTeam.project_id)
            .where(ProjectTeam.team_id == team_id)
            .scalar_subquery()
        )
        return query.filter(Project.id.in_(project_ids))

    @staticmethod
    def get_project_by_created_by(query, user_id: str):
        return query.filter(Project.created_by == user_id)

    @staticmethod
    def get_project_by_assigned_users(query, user_ids: list):
        project_ids = (
            db.select(ProjectUser.project_id)
            .where(ProjectUser.user_id.in_(user_ids))
            .scalar_subquery()
        )
        return query.filter(Project.id.in_(project_ids))

    @staticmethod
    def filter_by_assigned_user(query, user_id: str):
        """Restrict a Project query to projects the user is directly assigned to."""
        project_ids = (
            db.select(ProjectUser.project_id)
            .where(ProjectUser.user_id == user_id)
            .scalar_subquery()
        )
        return query.filter(Project.id.in_(project_ids))

    @staticmethod
    def get_location_counts(project_ids: list) -> dict:
        if not project_ids:
            return {}
        return dict(
            db.session.query(ProjectCountry.project_id, func.count())
            .filter(ProjectCountry.project_id.in_(project_ids))
            .group_by(ProjectCountry.project_id)
            .all()
        )

    @staticmethod
    def get_training_counts(project_ids: list) -> dict:
        if not project_ids:
            return {}
        return dict(
            db.session.query(ProjectTraining.project_id, func.count())
            .filter(ProjectTraining.project_id.in_(project_ids))
            .group_by(ProjectTraining.project_id)
            .all()
        )

    def get(self, org_id: str, user, filters: dict | None = None) -> list:
        """Return projects visible to the user.

        Pass ``for_user_id`` in filters to fetch a specific user's assigned
        projects (bypasses role scoping; uses ProjectUser as the scope gate).
        """
        filters = filters or {}
        query = Project.query.filter(Project.org_id == org_id)

        if filters.get("for_user_id"):
            query = self.filter_by_assigned_user(query, filters["for_user_id"])
        else:
            query = self.role_scope_projects_query(query, user)

        if filters.get("status") is not None:
            query = self.get_project_by_status(query, filters["status"])

        if filters.get("country_id") is not None:
            query = self.get_project_by_country(query, filters["country_id"])

        if filters.get("region_id") is not None:
            query = self.get_project_by_region(query, filters["region_id"])

        if filters.get("team_id") is not None:
            query = self.get_project_by_team(query, filters["team_id"])

        if filters.get("created_by_me"):
            query = self.get_project_by_created_by(query, user.id)

        if filters.get("user_ids") is not None:
            query = self.get_project_by_assigned_users(query, filters["user_ids"])

        return query.all()
