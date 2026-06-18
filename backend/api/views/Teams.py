#!/usr/bin/env python3
"""
Team API endpoints for Mikro.

Handles team management operations: CRUD and membership.
"""

from flask.views import MethodView
from flask import g, request

from ..utils import requires_admin, requires_auth, requires_team_admin_or_above
from ..auth import (
    is_admin_tier,
    is_org_admin_or_above,
    managed_team_ids_for,
    team_admin_can_access_team,
)
from ..database import (
    Team,
    TeamUser,
    TeamLead,
    User,
    ProjectTeam,
    ProjectUser,
    Project,
    TeamTraining,
    Training,
    Task,
)
from ..database.common import db
from ..filters import resolve_filtered_user_ids
from ..stats import get_batch_user_task_stats
from ..services.payment_balance import PaymentBalanceService


def _build_team_leads(team_ids):
    """Return ``{team_id: [{id, name, first_name, last_name}, ...]}``.

    One row per (team, lead) pair, ordered by TeamLead.created_at so the
    "first" lead is stable. Empty dict for empty input.
    """
    ids = [t for t in (team_ids or []) if t is not None]
    if not ids:
        return {}
    rows = (
        db.session.query(TeamLead.team_id, User)
        .join(User, User.id == TeamLead.user_id)
        .filter(TeamLead.team_id.in_(ids))
        .order_by(TeamLead.created_at.asc(), TeamLead.user_id.asc())
        .all()
    )
    out = {}
    for team_id, u in rows:
        name = f"{u.first_name or ''} {u.last_name or ''}".strip() or u.email
        out.setdefault(team_id, []).append(
            {
                "id": u.id,
                "name": name,
                "first_name": u.first_name or "",
                "last_name": u.last_name or "",
            }
        )
    return out


def _team_lead_fields(leads):
    """Build the standard lead-related response fields from a list of leads.

    Returns a dict with both the legacy singular fields (``lead_id`` /
    ``lead_name`` / ``lead_first_name`` / ``lead_last_name``, populated
    from the first lead) and the new array fields (``lead_ids`` /
    ``lead_names`` / ``leads``).
    """
    primary = leads[0] if leads else None
    return {
        "lead_id": primary["id"] if primary else None,
        "lead_name": primary["name"] if primary else None,
        "lead_first_name": primary["first_name"] if primary else "",
        "lead_last_name": primary["last_name"] if primary else "",
        "lead_ids": [l["id"] for l in leads],
        "lead_names": [l["name"] for l in leads],
        "leads": leads,
    }


def _set_team_leads(team, user_ids):
    """Replace ``team``'s leads with the given ``user_ids`` (in order).

    Drops existing TeamLead rows and inserts new ones. Also syncs
    ``team.lead_id`` to the first user_id (or ``None``) so legacy
    consumers of the denormalized pointer stay correct.
    """
    user_ids = [uid for uid in (user_ids or []) if uid]
    existing = TeamLead.query.filter_by(team_id=team.id).all()
    for tl in existing:
        tl.delete(soft=False)
    for uid in user_ids:
        TeamLead.create(team_id=team.id, user_id=uid)
    team.update(lead_id=user_ids[0] if user_ids else None)


def _extract_lead_ids_from_request(req_json):
    """Read leads from a create/update request payload.

    Accepts the new ``leadIds: [...]`` form OR falls back to the legacy
    singular ``leadId``. Returns a list (possibly empty).
    ``leadIds`` absent AND ``leadId`` absent → returns ``None`` so the
    caller can distinguish "leads not in this payload" from "leads
    explicitly cleared to empty".
    """
    if "leadIds" in req_json:
        raw = req_json.get("leadIds") or []
        if not isinstance(raw, list):
            raw = [raw]
        return [str(x) for x in raw if x]
    if "leadId" in req_json:
        legacy = req_json.get("leadId")
        return [str(legacy)] if legacy else []
    return None


def _validate_lead_ids(lead_ids, org_id):
    """Ensure every proposed team lead is an in-org user with an admin role.

    A team lead inherits managed-teams access via ``Team.lead_id``; assigning a
    non-admin (a plain mapper) as lead would leave them a lead with no
    permissions to act on the team. Reject any lead_id that isn't an admin-tier
    user (super_admin / admin / team_admin) in this org.

    Returns an error-response dict on failure, or ``None`` if every lead is valid.
    """
    for uid in lead_ids or []:
        user = User.query.filter_by(id=uid, org_id=org_id).first()
        if not user:
            return {"message": f"Lead user {uid} not found in your org", "status": 400}
        if not is_admin_tier(user):
            name = (
                f"{user.first_name or ''} {user.last_name or ''}".strip() or user.email
            )
            return {
                "message": (
                    f"{name} is not an admin and cannot be a team lead. "
                    "Give them an admin role first."
                ),
                "status": 400,
            }
    return None


class TeamAPI(MethodView):
    """Team management API endpoints."""

    def post(self, path: str):
        if path == "fetch_teams":
            return self.fetch_teams()
        elif path == "create_team":
            return self.create_team()
        elif path == "update_team":
            return self.update_team()
        elif path == "delete_team":
            return self.delete_team()
        elif path == "fetch_team_members":
            return self.fetch_team_members()
        elif path == "assign_team_member":
            return self.assign_team_member()
        elif path == "unassign_team_member":
            return self.unassign_team_member()
        elif path == "fetch_project_teams":
            return self.fetch_project_teams()
        elif path == "assign_team_to_project":
            return self.assign_team_to_project()
        elif path == "unassign_team_from_project":
            return self.unassign_team_from_project()
        elif path == "fetch_team_trainings":
            return self.fetch_team_trainings()
        elif path == "assign_training_to_team":
            return self.assign_training_to_team()
        elif path == "unassign_training_from_team":
            return self.unassign_training_from_team()
        elif path == "fetch_team_profile":
            return self.fetch_team_profile()
        elif path == "fetch_user_teams":
            return self.fetch_user_teams()
        elif path == "fetch_user_team_profile":
            return self.fetch_user_team_profile()
        elif path == "fetch_managed_teams":
            return self.fetch_managed_teams()
        return {"message": "Unknown path", "status": 404}

    @requires_team_admin_or_above
    def fetch_teams(self):
        """List all teams for the org with member counts.

        Supports optional filters in request body to narrow teams
        to only those containing at least one matching member.

        For team_admin, narrows to only teams they manage.
        """
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        filters = request.json.get("filters") if request.json else None
        filtered_user_ids = resolve_filtered_user_ids(filters, g.user.org_id)

        org_teams = Team.query.filter_by(org_id=g.user.org_id).all()

        # team_admin sees only teams they manage
        if g.user.role == "team_admin":
            managed = set(managed_team_ids_for(g.user))
            org_teams = [t for t in org_teams if t.id in managed]

        # If filters are active, restrict to teams with at least one matching member
        if filtered_user_ids is not None:
            matching_team_ids = {
                tu.team_id
                for tu in TeamUser.query.filter(
                    TeamUser.user_id.in_(filtered_user_ids)
                ).all()
            }
            org_teams = [t for t in org_teams if t.id in matching_team_ids]

        leads_map = _build_team_leads([t.id for t in org_teams])
        teams = []
        for team in org_teams:
            member_count = TeamUser.query.filter_by(team_id=team.id).count()
            teams.append(
                {
                    "id": team.id,
                    "name": team.name,
                    "description": team.description,
                    **_team_lead_fields(leads_map.get(team.id, [])),
                    "member_count": member_count,
                    "created_at": (
                        team.created_at.isoformat() if team.created_at else None
                    ),
                }
            )

        return {"teams": teams, "status": 200}

    @requires_admin
    def create_team(self):
        """Create a new team."""
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        team_name = request.json.get("teamName")
        if not team_name:
            return {"message": "teamName required", "status": 400}

        team_description = request.json.get("teamDescription")
        lead_ids_input = _extract_lead_ids_from_request(request.json) or []

        lead_error = _validate_lead_ids(lead_ids_input, g.user.org_id)
        if lead_error is not None:
            return lead_error

        team = Team.create(
            name=team_name,
            description=team_description,
            org_id=g.user.org_id,
            lead_id=None,  # _set_team_leads will sync this
        )
        _set_team_leads(team, lead_ids_input)

        leads_map = _build_team_leads([team.id])
        return {
            "message": "Team created",
            "team": {
                "id": team.id,
                "name": team.name,
                "description": team.description,
                **_team_lead_fields(leads_map.get(team.id, [])),
            },
            "status": 200,
        }

    @requires_team_admin_or_above
    def update_team(self):
        """Update team name, description, or lead.

        team_admin can update teams they manage; only Org Admin / super_admin
        can change the team's lead.
        """
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        team_id = request.json.get("teamId")
        if not team_id:
            return {"message": "teamId required", "status": 400}

        team = Team.query.filter_by(id=team_id, org_id=g.user.org_id).first()
        if not team:
            return {"message": f"Team {team_id} not found", "status": 400}

        if not is_org_admin_or_above(g.user) and not team_admin_can_access_team(
            g.user, team_id
        ):
            return {"message": "Not in your managed teams", "status": 403}

        updates = {}
        if "teamName" in request.json:
            updates["name"] = request.json["teamName"]
        if "teamDescription" in request.json:
            updates["description"] = request.json["teamDescription"]

        lead_ids_input = _extract_lead_ids_from_request(request.json)
        if lead_ids_input is not None:
            # Only Org Admin / super_admin can change team leads.
            if not is_org_admin_or_above(g.user):
                return {
                    "message": "Only Org Admin can change team leads",
                    "status": 403,
                }
            # Every lead must be an in-org admin-tier user.
            lead_error = _validate_lead_ids(lead_ids_input, g.user.org_id)
            if lead_error is not None:
                return lead_error

        if updates:
            team.update(**updates)
        if lead_ids_input is not None:
            _set_team_leads(team, lead_ids_input)

        return {"message": "Team updated", "status": 200}

    @requires_admin
    def delete_team(self):
        """Soft-delete a team and remove all member associations."""
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        team_id = request.json.get("teamId")
        if not team_id:
            return {"message": "teamId required", "status": 400}

        team = Team.query.filter_by(id=team_id, org_id=g.user.org_id).first()
        if not team:
            return {"message": f"Team {team_id} not found", "status": 400}

        # Remove all team member associations
        team_users = TeamUser.query.filter_by(team_id=team_id).all()
        for tu in team_users:
            tu.delete(soft=False)

        # Soft-delete the team
        team.delete(soft=True)

        return {"message": "Team deleted", "status": 200}

    @requires_team_admin_or_above
    def fetch_team_members(self):
        """Get all org users with their assignment status for a team."""
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        team_id = request.json.get("teamId")
        if not team_id:
            return {"message": "teamId required", "status": 400}

        team = Team.query.filter_by(id=team_id, org_id=g.user.org_id).first()
        if not team:
            return {"message": f"Team {team_id} not found", "status": 400}

        if not is_org_admin_or_above(g.user) and not team_admin_can_access_team(
            g.user, team_id
        ):
            return {"message": "Not in your managed teams", "status": 403}

        # Get all assigned user IDs for this team
        assigned_ids = {
            tu.user_id for tu in TeamUser.query.filter_by(team_id=team_id).all()
        }

        # Get all org users
        org_users = User.query.filter_by(org_id=g.user.org_id).all()

        users = []
        for user in org_users:
            name = (
                f"{user.first_name or ''} {user.last_name or ''}".strip() or user.email
            )
            users.append(
                {
                    "id": user.id,
                    "name": name,
                    "first_name": user.first_name or "",
                    "last_name": user.last_name or "",
                    "email": user.email,
                    "role": user.role,
                    "assigned": (
                        "Assigned" if user.id in assigned_ids else "Not Assigned"
                    ),
                }
            )

        return {"users": users, "status": 200}

    @requires_team_admin_or_above
    def assign_team_member(self):
        """Add a user to a team (idempotent). Also assigns the user to all projects the team has."""
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        team_id = request.json.get("teamId")
        user_id = request.json.get("userId")
        if not team_id:
            return {"message": "teamId required", "status": 400}
        if not user_id:
            return {"message": "userId required", "status": 400}

        team = Team.query.filter_by(id=team_id, org_id=g.user.org_id).first()
        if not team:
            return {"message": f"Team {team_id} not found", "status": 400}

        if not is_org_admin_or_above(g.user) and not team_admin_can_access_team(
            g.user, team_id
        ):
            return {"message": "Not in your managed teams", "status": 403}

        # Check if already assigned
        existing = TeamUser.query.filter_by(team_id=team_id, user_id=user_id).first()
        if not existing:
            TeamUser.create(team_id=team_id, user_id=user_id)

        # Cascade: assign user to all projects this team already has
        team_projects = ProjectTeam.query.filter_by(team_id=team_id).all()
        projects_assigned = 0
        for tp in team_projects:
            existing_pu = ProjectUser.query.filter_by(
                user_id=user_id, project_id=tp.project_id
            ).first()
            if not existing_pu:
                ProjectUser.create(user_id=user_id, project_id=tp.project_id)
                projects_assigned += 1

        return {
            "message": "User assigned to team",
            "projects_assigned": projects_assigned,
            "status": 200,
        }

    @requires_team_admin_or_above
    def unassign_team_member(self):
        """Remove a user from a team."""
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        team_id = request.json.get("teamId")
        user_id = request.json.get("userId")
        if not team_id:
            return {"message": "teamId required", "status": 400}
        if not user_id:
            return {"message": "userId required", "status": 400}

        if not is_org_admin_or_above(g.user) and not team_admin_can_access_team(
            g.user, team_id
        ):
            return {"message": "Not in your managed teams", "status": 403}

        relation = TeamUser.query.filter_by(team_id=team_id, user_id=user_id).first()
        if relation:
            relation.delete(soft=False)

        return {"message": "User removed from team", "status": 200}

    @requires_team_admin_or_above
    def fetch_project_teams(self):
        """Get all org teams with their assignment status for a project.

        For team_admin, narrows the team list to only their managed teams.
        """
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        project_id = request.json.get("projectId")
        if not project_id:
            return {"message": "projectId required", "status": 400}

        project = Project.query.filter_by(id=project_id, org_id=g.user.org_id).first()
        if not project:
            return {"message": f"Project {project_id} not found", "status": 400}

        org_teams = Team.query.filter_by(org_id=g.user.org_id).all()

        if g.user.role == "team_admin":
            managed = set(managed_team_ids_for(g.user))
            org_teams = [t for t in org_teams if t.id in managed]

        assigned_team_ids = {
            pt.team_id
            for pt in ProjectTeam.query.filter_by(project_id=project_id).all()
        }

        leads_map = _build_team_leads([t.id for t in org_teams])
        teams = []
        for team in org_teams:
            member_count = TeamUser.query.filter_by(team_id=team.id).count()
            leads = leads_map.get(team.id, [])
            teams.append(
                {
                    "id": team.id,
                    "name": team.name,
                    "member_count": member_count,
                    "lead_name": leads[0]["name"] if leads else None,
                    "lead_names": [l["name"] for l in leads],
                    "assigned": (
                        "Assigned" if team.id in assigned_team_ids else "Not Assigned"
                    ),
                }
            )

        return {"teams": teams, "status": 200}

    @requires_team_admin_or_above
    def assign_team_to_project(self):
        """Assign a team to a project, bulk-creating ProjectUser rows."""
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        team_id = request.json.get("teamId")
        project_id = request.json.get("projectId")
        if not team_id:
            return {"message": "teamId required", "status": 400}
        if not project_id:
            return {"message": "projectId required", "status": 400}

        team = Team.query.filter_by(id=team_id, org_id=g.user.org_id).first()
        if not team:
            return {"message": f"Team {team_id} not found", "status": 400}

        if not is_org_admin_or_above(g.user) and not team_admin_can_access_team(
            g.user, team_id
        ):
            return {"message": "Not in your managed teams", "status": 403}

        project = Project.query.filter_by(id=project_id, org_id=g.user.org_id).first()
        if not project:
            return {"message": f"Project {project_id} not found", "status": 400}

        # Create ProjectTeam row if not exists (idempotent)
        existing_pt = ProjectTeam.query.filter_by(
            team_id=team_id, project_id=project_id
        ).first()
        if not existing_pt:
            ProjectTeam.create(team_id=team_id, project_id=project_id)

        # Bulk-assign all team members to the project
        team_members = TeamUser.query.filter_by(team_id=team_id).all()
        assigned = 0
        skipped = 0
        for tm in team_members:
            existing_pu = ProjectUser.query.filter_by(
                user_id=tm.user_id, project_id=project_id
            ).first()
            if existing_pu:
                skipped += 1
            else:
                ProjectUser.create(user_id=tm.user_id, project_id=project_id)
                assigned += 1

        return {
            "message": "Team assigned to project",
            "assigned": assigned,
            "skipped": skipped,
            "status": 200,
        }

    @requires_team_admin_or_above
    def unassign_team_from_project(self):
        """Remove a team from a project, bulk-removing ProjectUser rows."""
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        team_id = request.json.get("teamId")
        project_id = request.json.get("projectId")
        if not team_id:
            return {"message": "teamId required", "status": 400}
        if not project_id:
            return {"message": "projectId required", "status": 400}

        if not is_org_admin_or_above(g.user) and not team_admin_can_access_team(
            g.user, team_id
        ):
            return {"message": "Not in your managed teams", "status": 403}

        # Remove ProjectTeam row
        pt = ProjectTeam.query.filter_by(team_id=team_id, project_id=project_id).first()
        if pt:
            pt.delete(soft=False)

        # Bulk-remove all team members from the project
        team_members = TeamUser.query.filter_by(team_id=team_id).all()
        removed = 0
        for tm in team_members:
            pu = ProjectUser.query.filter_by(
                user_id=tm.user_id, project_id=project_id
            ).first()
            if pu:
                pu.delete(soft=False)
                removed += 1

        return {
            "message": "Team removed from project",
            "removed": removed,
            "status": 200,
        }

    @requires_team_admin_or_above
    def fetch_team_trainings(self):
        """Get all org trainings with their assignment status for a team."""
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        team_id = request.json.get("teamId")
        if not team_id:
            return {"message": "teamId required", "status": 400}

        team = Team.query.filter_by(id=team_id, org_id=g.user.org_id).first()
        if not team:
            return {"message": f"Team {team_id} not found", "status": 400}

        if not is_org_admin_or_above(g.user) and not team_admin_can_access_team(
            g.user, team_id
        ):
            return {"message": "Not in your managed teams", "status": 403}

        assigned_ids = {
            tt.training_id for tt in TeamTraining.query.filter_by(team_id=team_id).all()
        }

        org_trainings = Training.query.filter_by(org_id=g.user.org_id).all()

        trainings = []
        for t in org_trainings:
            trainings.append(
                {
                    "id": t.id,
                    "title": t.title,
                    "training_type": t.training_type,
                    "difficulty": t.difficulty,
                    "point_value": t.point_value,
                    "assigned": "Assigned" if t.id in assigned_ids else "Not Assigned",
                }
            )

        return {"trainings": trainings, "status": 200}

    @requires_team_admin_or_above
    def assign_training_to_team(self):
        """Assign a training to a team (idempotent)."""
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        team_id = request.json.get("teamId")
        training_id = request.json.get("trainingId")
        if not team_id:
            return {"message": "teamId required", "status": 400}
        if not training_id:
            return {"message": "trainingId required", "status": 400}

        team = Team.query.filter_by(id=team_id, org_id=g.user.org_id).first()
        if not team:
            return {"message": f"Team {team_id} not found", "status": 400}

        if not is_org_admin_or_above(g.user) and not team_admin_can_access_team(
            g.user, team_id
        ):
            return {"message": "Not in your managed teams", "status": 403}

        existing = TeamTraining.query.filter_by(
            team_id=team_id, training_id=training_id
        ).first()
        if not existing:
            TeamTraining.create(team_id=team_id, training_id=training_id)

        return {"message": "Training assigned to team", "status": 200}

    @requires_team_admin_or_above
    def unassign_training_from_team(self):
        """Remove a training from a team."""
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        team_id = request.json.get("teamId")
        training_id = request.json.get("trainingId")
        if not team_id:
            return {"message": "teamId required", "status": 400}
        if not training_id:
            return {"message": "trainingId required", "status": 400}

        if not is_org_admin_or_above(g.user) and not team_admin_can_access_team(
            g.user, team_id
        ):
            return {"message": "Not in your managed teams", "status": 403}

        relation = TeamTraining.query.filter_by(
            team_id=team_id, training_id=training_id
        ).first()
        if relation:
            relation.delete(soft=False)

        return {"message": "Training removed from team", "status": 200}

    @requires_team_admin_or_above
    def fetch_team_profile(self):
        """Fetch aggregated profile data for a team (admin only)."""
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        team_id = request.json.get("teamId")
        if not team_id:
            return {"message": "teamId required", "status": 400}

        team = Team.query.filter_by(id=team_id, org_id=g.user.org_id).first()
        if not team:
            return {"message": f"Team {team_id} not found", "status": 400}

        if not is_org_admin_or_above(g.user) and not team_admin_can_access_team(
            g.user, team_id
        ):
            return {"message": "Not in your managed teams", "status": 403}

        team_leads = _build_team_leads([team.id]).get(team.id, [])

        # Get all team members
        team_user_rows = TeamUser.query.filter_by(team_id=team_id).all()
        member_ids = [tu.user_id for tu in team_user_rows]
        members_data = []
        osm_usernames = set()

        # Aggregated stats
        agg = {
            "total_tasks_mapped": 0,
            "total_tasks_validated": 0,
            "total_tasks_invalidated": 0,
            "mapping_payable_total": 0.0,
            "validation_payable_total": 0.0,
            "payable_total": 0.0,
            "requested_total": 0.0,
            "paid_total": 0.0,
        }

        members = [User.query.get(uid) for uid in member_ids]
        members = [u for u in members if u is not None]
        _batch_stats = get_batch_user_task_stats(members, g.user.org_id)
        _batch_pay = PaymentBalanceService(g.user.org_id).batch_balances(members)

        for u in members:
            name = f"{u.first_name or ''} {u.last_name or ''}".strip() or u.email
            if u.osm_username:
                osm_usernames.add(u.osm_username)

            _ustats = _batch_stats.get(u.id, {})
            _upay = _batch_pay.get(u.id, {})
            agg["total_tasks_mapped"] += _ustats.get("total_tasks_mapped", 0)
            agg["total_tasks_validated"] += _ustats.get("total_tasks_validated", 0)
            agg["total_tasks_invalidated"] += _ustats.get("total_tasks_invalidated", 0)
            agg["mapping_payable_total"] += _upay.get("mapping_payable_total", 0)
            agg["validation_payable_total"] += _upay.get("validation_payable_total", 0)
            agg["payable_total"] += u.payable_total or 0
            agg["requested_total"] += u.requested_total or 0
            agg["paid_total"] += u.paid_total or 0

            members_data.append(
                {
                    "id": u.id,
                    "name": name,
                    "email": u.email,
                    "role": u.role,
                    "osm_username": u.osm_username,
                    "total_tasks_mapped": _ustats.get("total_tasks_mapped", 0),
                    "total_tasks_validated": _ustats.get("total_tasks_validated", 0),
                    "total_tasks_invalidated": _ustats.get(
                        "total_tasks_invalidated", 0
                    ),
                    "payable_total": round(u.payable_total or 0, 2),
                }
            )

        # Round aggregated financial values
        for key in [
            "mapping_payable_total",
            "validation_payable_total",
            "payable_total",
            "requested_total",
            "paid_total",
        ]:
            agg[key] = round(agg[key], 2)

        # Get projects via ProjectTeam
        project_teams = ProjectTeam.query.filter_by(team_id=team_id).all()
        projects_data = []
        for pt in project_teams:
            proj = Project.query.get(pt.project_id)
            if not proj:
                continue
            # Count tasks by team members in this project
            team_mapped = 0
            team_validated = 0
            team_earnings = 0.0
            if osm_usernames:
                tasks = Task.query.filter_by(project_id=proj.id).all()
                for t in tasks:
                    if t.mapped_by in osm_usernames and t.mapped:
                        team_mapped += 1
                        team_earnings += t.mapping_rate or 0
                    if t.validated_by in osm_usernames and t.validated:
                        team_validated += 1
                        team_earnings += t.validation_rate or 0
            projects_data.append(
                {
                    "id": proj.id,
                    "name": proj.name,
                    "url": proj.url,
                    "team_tasks_mapped": team_mapped,
                    "team_tasks_validated": team_validated,
                    "team_earnings": round(team_earnings, 2),
                }
            )

        # Get assigned trainings
        team_trainings = TeamTraining.query.filter_by(team_id=team_id).all()
        trainings_data = []
        for tt in team_trainings:
            t = Training.query.get(tt.training_id)
            if t:
                trainings_data.append(
                    {
                        "id": t.id,
                        "title": t.title,
                        "training_type": t.training_type,
                        "difficulty": t.difficulty,
                        "point_value": t.point_value,
                    }
                )

        return {
            "team": {
                "id": team.id,
                "name": team.name,
                "description": team.description,
                **_team_lead_fields(team_leads),
                "member_count": len(member_ids),
                "created_at": team.created_at.isoformat() if team.created_at else None,
            },
            "members": members_data,
            "aggregated_stats": agg,
            "projects": projects_data,
            "assigned_trainings": trainings_data,
            "status": 200,
        }

    @requires_auth
    def fetch_user_teams(self):
        """Fetch teams that the current user belongs to."""
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        team_user_rows = TeamUser.query.filter_by(user_id=g.user.id).all()
        visible_teams = []
        for tu in team_user_rows:
            team = Team.query.get(tu.team_id)
            if team and team.org_id == g.user.org_id:
                visible_teams.append(team)

        leads_map = _build_team_leads([t.id for t in visible_teams])
        teams = []
        for team in visible_teams:
            member_count = TeamUser.query.filter_by(team_id=team.id).count()
            leads = leads_map.get(team.id, [])
            teams.append(
                {
                    "id": team.id,
                    "name": team.name,
                    "description": team.description,
                    "lead_name": leads[0]["name"] if leads else None,
                    "lead_names": [l["name"] for l in leads],
                    "member_count": member_count,
                }
            )

        return {"teams": teams, "status": 200}

    @requires_team_admin_or_above
    def fetch_managed_teams(self):
        """Return teams the current user leads.

        Used by the frontend to power team_admin scoped UIs (selector
        dropdowns, empty-state detection, dashboard scoping).

        - team_admin: returns teams where they hold a `team_leads` row.
        - Org Admin / super_admin: returns ALL teams in their org
          (so org-wide admin tools that reuse this endpoint just work).
        Empty list is a valid response — the zero-team team_admin
        empty state is handled on the client.
        """
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        if is_org_admin_or_above(g.user):
            org_teams = Team.query.filter_by(org_id=g.user.org_id).all()
        else:
            managed_ids = managed_team_ids_for(g.user)
            if not managed_ids:
                return {"teams": [], "status": 200}
            org_teams = Team.query.filter(Team.id.in_(managed_ids)).all()

        leads_map = _build_team_leads([t.id for t in org_teams])
        teams = []
        for team in org_teams:
            member_count = TeamUser.query.filter_by(team_id=team.id).count()
            teams.append(
                {
                    "id": team.id,
                    "name": team.name,
                    "description": team.description,
                    **_team_lead_fields(leads_map.get(team.id, [])),
                    "member_count": member_count,
                }
            )

        return {"teams": teams, "status": 200}

    @requires_auth
    def fetch_user_team_profile(self):
        """Fetch team profile scoped for a regular user (no financial data)."""
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        team_id = request.json.get("teamId")
        if not team_id:
            return {"message": "teamId required", "status": 400}

        team = Team.query.filter_by(id=team_id, org_id=g.user.org_id).first()
        if not team:
            return {"message": f"Team {team_id} not found", "status": 400}

        # Verify user is a member of this team
        membership = TeamUser.query.filter_by(
            team_id=team_id, user_id=g.user.id
        ).first()
        if not membership:
            return {"message": "You are not a member of this team", "status": 403}

        team_leads = _build_team_leads([team.id]).get(team.id, [])

        # Get all team members
        team_user_rows = TeamUser.query.filter_by(team_id=team_id).all()
        member_ids = [tu.user_id for tu in team_user_rows]
        members_data = []
        osm_usernames = set()

        agg = {
            "total_tasks_mapped": 0,
            "total_tasks_validated": 0,
            "total_tasks_invalidated": 0,
        }

        members = [User.query.get(uid) for uid in member_ids]
        members = [u for u in members if u is not None]
        _batch_stats = get_batch_user_task_stats(members, g.user.org_id)

        for u in members:
            name = f"{u.first_name or ''} {u.last_name or ''}".strip() or u.email
            if u.osm_username:
                osm_usernames.add(u.osm_username)

            _ustats = _batch_stats.get(u.id, {})
            agg["total_tasks_mapped"] += _ustats.get("total_tasks_mapped", 0)
            agg["total_tasks_validated"] += _ustats.get("total_tasks_validated", 0)
            agg["total_tasks_invalidated"] += _ustats.get("total_tasks_invalidated", 0)

            members_data.append(
                {
                    "id": u.id,
                    "name": name,
                    "role": u.role,
                    "osm_username": u.osm_username,
                    "total_tasks_mapped": _ustats.get("total_tasks_mapped", 0),
                    "total_tasks_validated": _ustats.get("total_tasks_validated", 0),
                }
            )

        # Get projects via ProjectTeam (no earnings)
        project_teams = ProjectTeam.query.filter_by(team_id=team_id).all()
        projects_data = []
        for pt in project_teams:
            proj = Project.query.get(pt.project_id)
            if not proj:
                continue
            team_mapped = 0
            team_validated = 0
            if osm_usernames:
                tasks = Task.query.filter_by(project_id=proj.id).all()
                for t in tasks:
                    if t.mapped_by in osm_usernames and t.mapped:
                        team_mapped += 1
                    if t.validated_by in osm_usernames and t.validated:
                        team_validated += 1
            projects_data.append(
                {
                    "id": proj.id,
                    "name": proj.name,
                    "url": proj.url,
                    "team_tasks_mapped": team_mapped,
                    "team_tasks_validated": team_validated,
                }
            )

        # Get assigned trainings
        team_trainings = TeamTraining.query.filter_by(team_id=team_id).all()
        trainings_data = []
        for tt in team_trainings:
            t = Training.query.get(tt.training_id)
            if t:
                trainings_data.append(
                    {
                        "id": t.id,
                        "title": t.title,
                        "training_type": t.training_type,
                        "difficulty": t.difficulty,
                        "point_value": t.point_value,
                    }
                )

        return {
            "team": {
                "id": team.id,
                "name": team.name,
                "description": team.description,
                **_team_lead_fields(team_leads),
                "member_count": len(member_ids),
                "created_at": team.created_at.isoformat() if team.created_at else None,
            },
            "members": members_data,
            "aggregated_stats": agg,
            "projects": projects_data,
            "assigned_trainings": trainings_data,
            "status": 200,
        }
