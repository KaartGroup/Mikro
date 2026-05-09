#!/usr/bin/env python3
"""
Training API endpoints for Mikro.

Handles training module management operations.
"""

from flask.views import MethodView
from flask import g, request

from ..utils import requires_admin, requires_team_admin_or_above
from ..auth import managed_team_ids_for
from ..filters import get_user_country_ids, is_visible_by_location
from ..database import (
    Training,
    TrainingCompleted,
    TrainingCountry,
    TrainingQuestion,
    TrainingQuestionAnswer,
    TeamTraining,
    User,
)


def _create_training_questions(training_id, questions_data):
    """Create questions and answers for a training module.

    Args:
        training_id: The ID of the training to attach questions to.
        questions_data: List of question dicts, each with 'question',
            'correct', and 'incorrect' keys.
    """
    for question in questions_data:
        new_training_question = TrainingQuestion.create(
            training_id=training_id, question=question["question"]
        )
        TrainingQuestionAnswer.create(
            training_id=training_id,
            training_question_id=new_training_question.id,
            value=True,
            answer=question["correct"],
        )
        for incorrect in question["incorrect"]:
            TrainingQuestionAnswer.create(
                training_id=training_id,
                training_question_id=new_training_question.id,
                value=False,
                answer=incorrect["answer"],
            )


class TrainingAPI(MethodView):
    """Training module management API endpoints."""

    def post(self, path: str):
        if path == "create_training":
            return self.create_training()
        elif path == "modify_training":
            return self.modify_training()
        elif path == "update_training":
            return self.update_training()
        elif path == "fetch_org_trainings":
            return self.fetch_org_trainings()
        elif path == "fetch_user_trainings":
            return self.fetch_user_trainings()
        elif path == "delete_training":
            return self.delete_training()
        elif path == "complete_training":
            return self.complete_training()
        elif path == "submit_quiz":
            return self.submit_quiz()
        elif path == "purge_all_trainings":
            return self.purge_all_trainings()
        return {
            "message": "Only /project/{fetch_users,fetch_user_projects} is permitted with GET",  # noqa: E501
        }, 405

    @requires_admin
    def create_training(self):
        required_args = [
            "title",
            "questions",
            "point_value",
            "difficulty",
            "training_url",
            "training_type",
        ]
        missing_args = [
            arg for arg in required_args if arg not in request.json
        ]
        if missing_args:
            response = {
                "message": f"Missing required argument(s): {', '.join(missing_args)}",  # noqa: E501
                "status": 400,
            }
            return response, 400
        questions = request.json["questions"]
        try:
            # Build created_by from current user
            creator_name = "%s (%s)" % (
                (g.user.first_name or "").capitalize(),
                g.user.osm_username or g.user.email or "",
            )
            new_training = Training.create(
                title=request.json["title"],
                org_id=g.user.org_id,
                point_value=request.json["point_value"],
                difficulty=request.json["difficulty"],
                training_url=request.json["training_url"],
                training_type=request.json["training_type"],
                created_by=creator_name,
            )
            _create_training_questions(new_training.id, questions)
            response = {"message": "New Training Created", "status": 200}
            return response, 200
        except Exception as e:
            response = {
                "message": f"Failed to create training: {str(e)}",
                "status": 500,
            }
            return response, 500

    @requires_team_admin_or_above
    def fetch_org_trainings(self):
        # Check if user is authenticated
        if not g:
            return {"message": "User Not Found", "status": 304}
        # Get all projects for the organization
        org_id = g.user.org_id

        # team_admin: narrow to trainings assigned to managed teams
        ta_training_ids = None
        if g.user.role == "team_admin":
            managed = managed_team_ids_for(g.user)
            if not managed:
                return {
                    "org_mapping_trainings": [],
                    "org_validation_trainings": [],
                    "org_project_trainings": [],
                    "status": 200,
                }
            ta_training_ids = {
                tt.training_id
                for tt in TeamTraining.query.filter(
                    TeamTraining.team_id.in_(managed)
                ).all()
            }
            if not ta_training_ids:
                return {
                    "org_mapping_trainings": [],
                    "org_validation_trainings": [],
                    "org_project_trainings": [],
                    "status": 200,
                }

        def _filter_ta(rows):
            if ta_training_ids is None:
                return rows
            return [t for t in rows if t.id in ta_training_ids]

        mapping_trainings = _filter_ta(Training.query.filter_by(
            org_id=org_id, training_type="Mapping"
        ).all())
        validation_trainings = _filter_ta(Training.query.filter_by(
            org_id=org_id, training_type="Validation"
        ).all())
        project_trainings = _filter_ta(Training.query.filter_by(
            org_id=org_id, training_type="Project"
        ).all())
        # Batch-load location counts for admin display
        all_training_ids = [t.id for t in mapping_trainings + validation_trainings + project_trainings]
        _tc_rows = TrainingCountry.query.filter(
            TrainingCountry.training_id.in_(all_training_ids)
        ).all() if all_training_ids else []
        _tc_counts = {}
        for r in _tc_rows:
            _tc_counts[r.training_id] = _tc_counts.get(r.training_id, 0) + 1

        # Prepare response
        org_mapping_trainings = [
            {**self.format_training(training), "assigned_locations": _tc_counts.get(training.id, 0)}
            for training in mapping_trainings
        ]
        org_validation_trainings = [
            {**self.format_training(training), "assigned_locations": _tc_counts.get(training.id, 0)}
            for training in validation_trainings
        ]
        org_project_trainings = [
            {**self.format_training(training), "assigned_locations": _tc_counts.get(training.id, 0)}
            for training in project_trainings
        ]
        return {
            "org_mapping_trainings": org_mapping_trainings,
            "org_validation_trainings": org_validation_trainings,
            "org_project_trainings": org_project_trainings,
            "status": 200,
        }

    @requires_admin
    def update_training(self):
        """Update training metadata (title, url, points, difficulty)."""
        if not g:
            return {"message": "User not found", "status": 304}

        training_id = request.json.get("training_id")
        if not training_id:
            return {"message": "training_id required", "status": 400}

        target_training = Training.query.filter_by(
            id=training_id, org_id=g.user.org_id
        ).first()
        if not target_training:
            return {"message": f"Training {training_id} not found", "status": 404}

        # Update only the fields that are provided
        if request.json.get("title"):
            target_training.update(title=request.json.get("title"))
        if request.json.get("training_url"):
            target_training.update(training_url=request.json.get("training_url"))
        if request.json.get("point_value") is not None:
            target_training.update(point_value=request.json.get("point_value"))
        if request.json.get("difficulty"):
            target_training.update(difficulty=request.json.get("difficulty"))

        return {"message": "Training updated", "status": 200}

    @requires_admin
    def modify_training(self):
        # Check if user is authenticated
        if not g:
            return {"message": "User not found", "status": 304}
        required_args = [
            "title",
            "questions",
            "point_value",
            "difficulty",
            "training_url",
            "training_type",
        ]
        missing_args = [
            arg for arg in required_args if arg not in request.json
        ]
        if missing_args:
            response = {
                "message": f"Missing required argument(s): {', '.join(missing_args)}",  # noqa: E501
                "status": 400,
            }
            return response
        questions = request.json["questions"]
        # Update training data
        training_id = request.json.get("training_id")
        target_training = Training.query.filter_by(id=training_id).first()
        if not target_training:
            return {
                "message": f"Training {training_id} not found",
                "status": 400,
            }
        target_training.update(
            title=request.json.get("title"),
            point_value=request.json.get("point_value"),
            difficulty=request.json.get("difficulty"),
            training_url=request.json.get("training_url"),
            training_type=request.json.get("training_type"),
        )
        target_training_questions = TrainingQuestion.query.filter_by(
            training_id=target_training.id
        ).all()
        for question in target_training_questions:
            target_question_answers = TrainingQuestionAnswer.query.filter_by(
                training_question_id=question.id,
                training_id=target_training.id,
            ).all()
            for answer in target_question_answers:

                answer.delete(soft=False)
            question.delete(soft=False)

        _create_training_questions(target_training.id, questions)

        # Return response
        return {
            "message": f"Training {training_id} has been updated",
            "status": 200,
        }

    @requires_admin
    def delete_training(self):
        response = {}
        # Check if user is authenticated
        if not g:
            response["message"] = "User not found"
            response["status"] = 304
            return response
        # Check if required data is provided
        training_id = request.json.get("training_id")
        if not training_id:
            return {"message": "training_id required", "status": 400}
        target_training = Training.query.filter_by(
            org_id=g.user.org_id, id=training_id
        ).first()
        if not target_training:
            response["message"] = "Training %s not found" % (training_id)
            response["status"] = 400
            return response
        else:
            target_training_questions = TrainingQuestion.query.filter_by(
                training_id=target_training.id
            ).all()
            target_training_answers = TrainingQuestionAnswer.query.filter_by(
                training_id=target_training.id
            ).all()
            for question, answer in zip(
                target_training_questions, target_training_answers
            ):
                question.delete(soft=False)
            target_training.delete(soft=False)
            response["message"] = "Training %s deleted" % (training_id)
            response["status"] = 200
            return response

    def complete_training(self):
        if not g:
            return {"message": "User Not Found", "status": 304}
        training_id = request.json.get("training_id")
        if not training_id:
            return {"message": "Training ID required", "status": 400}
        target_training = Training.query.filter_by(id=training_id).first()
        if not target_training:
            return {"message": "Training not found", "status": 400}
        completion_exists = TrainingCompleted.query.filter_by(
            training_id=training_id, user_id=g.user.id
        ).first()
        if completion_exists:
            return {"message": "Training already completed", "status": 200}
        TrainingCompleted.create(training_id=training_id, user_id=g.user.id)
        if target_training.training_type == "Mapping":
            g.user.update(
                mapper_points=g.user.mapper_points
                + target_training.point_value
            )
            earned_points = g.user.mapper_points
        elif target_training.training_type == "Validation":
            g.user.update(
                validator_points=g.user.validator_points
                + target_training.point_value
            )
            earned_points = g.user.validator_points
        elif target_training.training_type == "Project":
            g.user.update(
                special_project_points=g.user.special_project_points
                + target_training.point_value
            )
            earned_points = g.user.special_project_points
        return {
            "training_type": target_training.training_type,
            "earned_points": earned_points,
            "message": "Training completed",
            "status": 200,
        }

    def submit_quiz(self):
        """
        Submit quiz answers and calculate score.
        Expects: { training_id: int, answers: [{ question_id: int, answer_id: int }] }
        Returns: { score: int, passed: bool, status: int }
        """
        if not g:
            return {"message": "User Not Found", "status": 304}

        training_id = request.json.get("training_id")
        answers = request.json.get("answers", [])

        if not training_id:
            return {"message": "training_id required", "status": 400}

        target_training = Training.query.filter_by(id=training_id).first()
        if not target_training:
            return {"message": "Training not found", "status": 404}

        # Check if already completed
        completion_exists = TrainingCompleted.query.filter_by(
            training_id=training_id, user_id=g.user.id
        ).first()
        if completion_exists:
            return {
                "message": "Training already completed",
                "score": 100,
                "passed": True,
                "status": 200,
            }

        # Get all questions for this training
        questions = TrainingQuestion.query.filter_by(training_id=training_id).all()
        if not questions:
            return {"message": "No questions found for this training", "status": 400}

        # Calculate score
        correct_count = 0
        total_questions = len(questions)

        for submitted in answers:
            question_id = submitted.get("question_id")
            answer_id = submitted.get("answer_id")

            # Find the correct answer for this question
            correct_answer = TrainingQuestionAnswer.query.filter_by(
                training_id=training_id,
                training_question_id=question_id,
                value=True,
            ).first()

            if correct_answer and correct_answer.id == answer_id:
                correct_count += 1

        # Calculate percentage score
        score = int((correct_count / total_questions) * 100) if total_questions > 0 else 0
        passed = score >= 70

        # If passed, mark training as complete and award points
        if passed:
            TrainingCompleted.create(training_id=training_id, user_id=g.user.id)

            if target_training.training_type == "Mapping":
                g.user.update(
                    mapper_points=g.user.mapper_points + target_training.point_value
                )
            elif target_training.training_type == "Validation":
                g.user.update(
                    validator_points=g.user.validator_points + target_training.point_value
                )
            elif target_training.training_type == "Project":
                g.user.update(
                    special_project_points=g.user.special_project_points
                    + target_training.point_value
                )

        return {
            "score": score,
            "passed": passed,
            "correct": correct_count,
            "total": total_questions,
            "message": "Quiz passed!" if passed else "Quiz failed. You need 70% to pass.",
            "status": 200,
        }

    def fetch_user_trainings(self):
        # Check if user is authenticated
        if not g:
            return {"message": "User Not Found", "status": 304}
        # Get all projects for the organization
        org_id = g.user.org_id
        trainings_completed_ids = [
            completion.training_id
            for completion in TrainingCompleted.query.filter_by(
                user_id=g.user.id
            ).all()
        ]

        # Location visibility filter
        all_org_trainings = Training.query.filter_by(org_id=org_id).all()
        _user_cids = get_user_country_ids(g.user.id)
        _tc_all = TrainingCountry.query.filter(
            TrainingCountry.training_id.in_([t.id for t in all_org_trainings])
        ).all() if all_org_trainings else []
        _t_loc_map = {}
        for r in _tc_all:
            _t_loc_map.setdefault(r.training_id, set()).add(r.country_id)
        visible_trainings = [
            t for t in all_org_trainings
            if is_visible_by_location(_t_loc_map.get(t.id, set()), _user_cids)
        ]

        mapping_trainings = [
            t for t in visible_trainings
            if t.training_type == "Mapping" and t.id not in trainings_completed_ids
        ]
        validation_trainings = [
            t for t in visible_trainings
            if t.training_type == "Validation" and t.id not in trainings_completed_ids
        ]
        project_trainings = [
            t for t in visible_trainings
            if t.training_type == "Project" and t.id not in trainings_completed_ids
        ]
        completed_trainings = [
            t for t in visible_trainings
            if t.id in trainings_completed_ids
        ]
        # Prepare response
        formatted_mapping_trainings = [
            self.format_training(training) for training in mapping_trainings
        ]
        formatted_validation_trainings = [
            self.format_training(training) for training in validation_trainings
        ]
        formatted_project_trainings = [
            self.format_training(training) for training in project_trainings
        ]
        user_completed_trainings = [
            self.format_training(training) for training in completed_trainings
        ]
        return {
            # Keys match what frontend expects
            "mapping_trainings": formatted_mapping_trainings,
            "validation_trainings": formatted_validation_trainings,
            "project_trainings": formatted_project_trainings,
            "user_completed_trainings": user_completed_trainings,
            "status": 200,
        }

    def format_training(self, training):
        questions = []
        training_questions = TrainingQuestion.query.filter_by(
            training_id=training.id
        ).all()
        for question in training_questions:
            all_answers = TrainingQuestionAnswer.query.filter_by(
                training_question_id=question.id,
                training_id=training.id,
            ).all()
            answers = [
                {
                    "id": answer.id,
                    "answer": answer.answer,
                    "correct": answer.value,
                }
                for answer in all_answers
            ]
            question_obj = {
                "id": question.id,
                "question": question.question,
                "answers": answers,
            }
            questions.append(question_obj)

        return {
            "id": training.id,
            "title": training.title,
            "point_value": training.point_value,
            "difficulty": training.difficulty,
            "training_url": training.training_url,
            "training_type": training.training_type,
            "created_by": training.created_by,
            "questions": questions,
        }

    @requires_admin
    def purge_all_trainings(self):
        """DEV ONLY: Purge all trainings and reset related user stats."""
        response = {}
        if not g:
            response["message"] = "User not found"
            response["status"] = 304
            return response

        org_id = g.user.org_id

        # Get all training IDs for this org
        trainings = Training.query.filter_by(org_id=org_id).all()
        training_ids = [t.id for t in trainings]

        # Delete all training completions
        completions = TrainingCompleted.query.filter(
            TrainingCompleted.training_id.in_(training_ids)
        ).all()
        for completion in completions:
            completion.delete(soft=False)

        # Delete all training answers
        answers = TrainingQuestionAnswer.query.filter(
            TrainingQuestionAnswer.training_id.in_(training_ids)
        ).all()
        for answer in answers:
            answer.delete(soft=False)

        # Delete all training questions
        questions = TrainingQuestion.query.filter(
            TrainingQuestion.training_id.in_(training_ids)
        ).all()
        for question in questions:
            question.delete(soft=False)

        # Delete all trainings
        trainings_deleted = len(trainings)
        for training in trainings:
            training.delete(soft=False)

        # Reset user training stats
        users = User.query.filter_by(org_id=org_id).all()
        users_reset = 0
        for user in users:
            user.update(
                mapper_points=0,
                validator_points=0,
                special_project_points=0,
            )
            users_reset += 1

        response["message"] = "All trainings purged"
        response["trainings_deleted"] = trainings_deleted
        response["users_reset"] = users_reset
        response["status"] = 200
        return response
