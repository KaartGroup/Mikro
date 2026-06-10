#!/usr/bin/env python3
from ..utils import requires_team_admin_or_above
from flask.views import MethodView
from flask import g, request

from ..utils import requires_admin
from ..database import Project, ProjectTraining, Training


class ProjectTrainingAPI(MethodView):
    """Project–training assignment endpoints."""

    def post(self, path: str):
        if path == "fetch_project_trainings":
            return self.fetch_project_trainings()
        elif path == "assign_project_training":
            return self.assign_project_training()
        elif path == "unassign_project_training":
            return self.unassign_project_training()
        return {"message": "Not found"}, 405

    @requires_team_admin_or_above
    def fetch_project_trainings(self):
        """Fetch trainings assigned to a project and all available trainings."""
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        project_id = request.json.get("project_id")
        if not project_id:
            return {"message": "project_id required", "status": 400}

        assigned_rows = ProjectTraining.query.filter_by(project_id=project_id).all()
        assigned_ids = {row.training_id for row in assigned_rows}

        all_trainings = Training.query.filter_by(org_id=g.user.org_id).all()

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

    @requires_team_admin_or_above
    def assign_project_training(self):
        """Assign a training to a project."""
        if not g.user:
            return {"message": "Missing user info", "status": 304}

        project_id = request.json.get("project_id")
        training_id = request.json.get("training_id")
        if not project_id or not training_id:
            return {"message": "project_id and training_id required", "status": 400}

        project = Project.query.filter_by(id=project_id, org_id=g.user.org_id).first()
        if not project:
            return {"message": "Project not found", "status": 404}

        training = Training.query.filter_by(id=training_id, org_id=g.user.org_id).first()
        if not training:
            return {"message": "Training not found", "status": 404}

        existing = ProjectTraining.query.filter_by(
            project_id=project_id, training_id=training_id
        ).first()
        if existing:
            return {"message": "Training already assigned", "status": 200}

        ProjectTraining.create(project_id=project_id, training_id=training_id)
        return {"message": "Training assigned", "status": 200}

    @requires_team_admin_or_above
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
