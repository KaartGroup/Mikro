#!/usr/bin/env python3
"""
Database models for Mikro API.

This module defines all SQLAlchemy models for the Mikro application.
Updated for Auth0 authentication (string-based user IDs).
"""

from __future__ import annotations

from sqlalchemy import (
    BigInteger,
    Column,
    String,
    DateTime,
    Float,
    ForeignKey,
    Text,
    func,
    Integer,
    Boolean,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.ext.mutable import MutableList

from .common import ModelWithSoftDeleteAndCRUD, SurrogatePK, CRUDMixin, db


class User(ModelWithSoftDeleteAndCRUD, SurrogatePK):
    """
    User model for Mikro.

    Users are identified by their Auth0 'sub' claim (string).
    """

    __tablename__ = "users"

    # Primary key is Auth0 sub (string format: "auth0|abc123" or "google-oauth2|123")
    id = db.Column(db.String(255), primary_key=True, nullable=False)
    auth0_sub = db.Column(db.String(255), unique=True, nullable=True, index=True)

    # User info
    email = Column(String(255), unique=True, nullable=True, index=True)
    payment_email = Column(String(255), nullable=True)
    first_name = Column(String(100))
    last_name = Column(String(100))
    osm_username = Column(String(100), unique=True, nullable=True, index=True)
    mapillary_username = Column(String(100), nullable=True, index=True)

    # OSM Account Linking
    osm_id = Column(BigInteger, nullable=True, unique=True, index=True)
    osm_verified = Column(Boolean, default=False, server_default="False")
    osm_verified_at = Column(DateTime, nullable=True)

    # Location
    city = Column(String(100), nullable=True)
    country = Column(String(100), nullable=True)

    # Normalized location (FK to countries table)
    country_id = db.Column(
        db.Integer,
        db.ForeignKey("countries.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    timezone = db.Column(db.String(50), nullable=True)  # e.g. "America/Bogota"

    # Role and organization
    role = Column(String(50), default="user")  # user, validator, admin
    org_id = Column(String(255), nullable=True)  # Auth0 org ID (string)

    # Deactivation flag — distinct from soft-delete (deleted_date).
    # False blocks login at the auth gate AND filters from default
    # admin user lists. Historical data is preserved either way.
    is_active = db.Column(
        db.Boolean, nullable=False, default=True, server_default="true"
    )

    # Timestamps
    create_time = Column(DateTime, default=func.now())

    # Assignments
    assigned_projects = Column(MutableList.as_mutable(ARRAY(Integer)))
    assigned_checklists = Column(MutableList.as_mutable(ARRAY(Integer)))

    # Mapper stats
    mapper_level = db.Column(db.Integer, default=0, nullable=True)
    mapper_points = db.Column(db.Integer, default=0, nullable=True)
    validator_points = db.Column(db.Integer, default=0, nullable=True)
    special_project_points = db.Column(db.Integer, default=0, nullable=True)

    # Payment tracking
    validation_payable_total = db.Column(
        db.Float, nullable=True, default=0, server_default="0"
    )
    mapping_payable_total = db.Column(
        db.Float, nullable=True, default=0, server_default="0"
    )
    checklist_payable_total = db.Column(
        db.Float, nullable=True, default=0, server_default="0"
    )
    payable_total = db.Column(db.Float, nullable=True, default=0, server_default="0")
    requested_total = db.Column(db.Float, nullable=True, default=0, server_default="0")
    paid_total = db.Column(db.Float, nullable=True, default=0, server_default="0")

    # Task stats
    total_tasks_mapped = db.Column(
        db.BigInteger, nullable=True, default=0, server_default="0"
    )
    total_tasks_validated = db.Column(
        db.BigInteger, nullable=True, default=0, server_default="0"
    )
    total_tasks_invalidated = db.Column(
        db.Integer, nullable=False, default=0, server_default="0"
    )

    # Checklist stats
    total_checklists_completed = db.Column(
        db.Integer, nullable=False, default=0, server_default="0"
    )
    validator_total_checklists_confirmed = db.Column(
        db.Integer, nullable=False, default=0, server_default="0"
    )

    # Validator stats
    validator_tasks_invalidated = db.Column(
        db.Integer, nullable=True, default=0, server_default="0"
    )
    validator_tasks_validated = db.Column(
        db.Integer, nullable=True, default=0, server_default="0"
    )

    # Payment request status
    requesting_payment = db.Column(
        db.Boolean,
        nullable=False,
        default=False,
        server_default="False",
    )

    # Time tracking
    time_tracking_required = db.Column(
        db.Boolean, nullable=False, default=False, server_default="False"
    )

    # Tracked-only users (no Auth0, no login — OSM tracking only)
    is_tracked_only = db.Column(
        db.Boolean, nullable=False, default=False, server_default="False"
    )

    # Micropayment visibility — controls whether user sees task-based micropayments UI
    micropayments_visible = db.Column(
        db.Boolean, nullable=False, default=False, server_default="false"
    )

    # Hourly contractor rate (if set, user is treated as hourly contractor)
    hourly_rate = db.Column(db.Float, nullable=True, default=None)

    def __repr__(self):
        return f"<User {self.email}>"

    @property
    def full_name(self):
        """Return the user's full name."""
        return f"{self.first_name or ''} {self.last_name or ''}".strip()


class UserNameAudit(CRUDMixin, db.Model):
    """
    Diagnostic audit log for every change to User.first_name / last_name.

    Temporary instrumentation added 2026-04 while investigating reports
    that admin-set user names revert to email addresses. Each write path
    that touches first_name or last_name records a row here tagged with
    the code path (`source`) and the actor (`changed_by`). Once the
    regression is confirmed fixed this table can be dropped in a future
    migration.
    """

    __tablename__ = "user_name_audits"

    id = db.Column(db.BigInteger, primary_key=True, autoincrement=True)
    user_id = db.Column(
        db.String(255),
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    changed_at = db.Column(
        DateTime, nullable=False, default=func.now(), server_default=func.now(),
        index=True,
    )
    old_first_name = db.Column(db.String(100), nullable=True)
    old_last_name = db.Column(db.String(100), nullable=True)
    new_first_name = db.Column(db.String(100), nullable=True)
    new_last_name = db.Column(db.String(100), nullable=True)
    source = db.Column(db.String(50), nullable=False, index=True)
    changed_by = db.Column(db.String(255), nullable=True)
    details = db.Column(db.Text, nullable=True)

    def __repr__(self):
        return (
            f"<UserNameAudit user={self.user_id} src={self.source} "
            f"at={self.changed_at}>"
        )


class Project(ModelWithSoftDeleteAndCRUD, SurrogatePK):
    """TM4 Project model."""

    __tablename__ = "projects"

    id = db.Column(db.Integer, primary_key=True, autoincrement=False)
    name = db.Column(db.String(255), nullable=True)
    short_name = db.Column(db.String(100), nullable=True)  # Admin-set display name
    org_id = db.Column(db.String(255), nullable=True)  # Changed to String for Auth0
    url = db.Column(db.String(500), nullable=False)
    source = db.Column(db.String(20), nullable=False, server_default="tm4")  # "tm4" or "mr"
    created_by = db.Column(db.String(255), nullable=True)  # Auth0 user ID of admin who created/imported
    last_sync_cursor = db.Column(db.DateTime, nullable=True)  # For incremental MR sync

    # Payment settings
    max_payment = db.Column(db.Float, nullable=True, default=0)
    payment_due = db.Column(db.Float, nullable=True, default=0)
    total_payout = db.Column(db.Float, nullable=True, default=0)
    validation_rate_per_task = db.Column(db.Float, nullable=True, default=100)
    mapping_rate_per_task = db.Column(db.Float, nullable=True, default=100)
    payments_enabled = db.Column(db.Boolean, nullable=False, default=True, server_default="true")

    # Capacity
    max_editors = db.Column(db.Integer, nullable=True, default=5)
    max_validators = db.Column(db.Integer, nullable=True, default=5)
    total_editors = db.Column(db.BigInteger, default=0)
    total_validators = db.Column(db.BigInteger, default=0)

    # Task stats
    total_tasks = db.Column(db.BigInteger, default=0)
    tasks_mapped = db.Column(db.BigInteger, default=0)
    tasks_validated = db.Column(db.BigInteger, default=0)
    tasks_invalidated = db.Column(db.BigInteger, default=0)
    tasks_overlap = db.Column(db.Integer, default=0)

    # Metadata
    difficulty = db.Column(db.String(50), nullable=True, default="Intermediate")
    visibility = db.Column(db.Boolean, nullable=True, server_default="False")
    status = db.Column(db.Boolean, nullable=True, server_default="False")
    completed = db.Column(db.Boolean, nullable=True, server_default="False")

    def __repr__(self):
        return f"<Project {self.id}: {self.name}>"


class Task(ModelWithSoftDeleteAndCRUD, SurrogatePK):
    """Task model for tracking individual TM4 tasks."""

    __tablename__ = "tasks"

    id = db.Column(db.BigInteger, primary_key=True, nullable=False)
    task_id = db.Column(db.BigInteger, nullable=True, index=True)
    org_id = db.Column(db.String(255), nullable=True)  # Changed to String for Auth0
    project_id = db.Column(db.BigInteger, nullable=False, index=True)
    source = db.Column(db.String(20), nullable=False, server_default="tm4")  # "tm4" or "mr"

    # Rates
    validation_rate = db.Column(db.Float, nullable=True, default=100)
    mapping_rate = db.Column(db.Float, nullable=True, default=100)

    # Status
    paid_out = db.Column(db.Boolean, nullable=False, default=False)
    mapped = db.Column(db.Boolean, nullable=True, default=False)
    validated = db.Column(db.Boolean, nullable=True, default=False)
    invalidated = db.Column(db.Boolean, nullable=True, default=False)
    self_validated = db.Column(db.Boolean, default=False)  # Flags tasks where mapper validated their own work

    # MapRoulette status (NULL for TM4 tasks; 1=Fixed, 2=FalsePositive, 3=Skipped, 5=AlreadyFixed, 6=CantComplete)
    mr_status = db.Column(db.Integer, nullable=True)

    # TM4 split tracking
    parent_task_id = db.Column(db.Integer, nullable=True)  # From TM4 for split tracking
    sibling_count = db.Column(db.Integer, nullable=True)  # Total siblings in split group (4 for TM4)

    # Date tracking for time-filtered stats
    date_mapped = db.Column(db.DateTime, nullable=True)
    date_validated = db.Column(db.DateTime, nullable=True)

    # Attribution
    mapped_by = db.Column(db.String(100), nullable=False)
    validated_by = db.Column(db.String(100), nullable=True)
    unknown_validator = db.Column(db.Boolean, nullable=True, default=False)

    def __repr__(self):
        return f"<Task {self.task_id} in Project {self.project_id}>"


class ValidatorTaskAction(CRUDMixin, db.Model):
    """
    Tracks multiple validation actions for a task.

    Used to record invalidation cycles - when a validator invalidates a task,
    the mapper fixes it, and a validator validates again, each action is recorded.
    """

    __tablename__ = "validator_task_actions"

    id = db.Column(db.BigInteger, primary_key=True, autoincrement=True)
    validator_id = db.Column(
        db.String(255),
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    task_id = db.Column(
        db.BigInteger,
        db.ForeignKey("tasks.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    project_id = db.Column(
        db.Integer,
        db.ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    action_type = db.Column(db.String(20), nullable=False)  # 'invalidate' or 'validate'
    action_date = db.Column(db.DateTime, nullable=False)
    paid = db.Column(db.Boolean, default=False)

    # Relationships
    # passive_deletes lets the DB's ON DELETE CASCADE remove these rows
    # when a User is hard-deleted, instead of SQLAlchemy trying to NULL
    # user_id first (which fails — column is NOT NULL).
    validator = db.relationship("User", backref=db.backref("validation_actions", passive_deletes=True))
    task = db.relationship("Task", backref="validation_actions")
    project = db.relationship("Project", backref="validation_actions")

    def __repr__(self):
        return f"<ValidatorTaskAction {self.action_type} by {self.validator_id} on Task {self.task_id}>"


class Checklist(ModelWithSoftDeleteAndCRUD, SurrogatePK, db.Model):
    """Checklist template model."""

    __tablename__ = "checklists"

    id = db.Column(db.BigInteger, primary_key=True, nullable=False)
    name = db.Column(db.String(255), nullable=True)
    author = db.Column(db.String(200), nullable=True)
    description = db.Column(db.Text, nullable=True)
    due_date = Column(DateTime, nullable=True)
    org_id = db.Column(db.String(255), nullable=True)

    # Rates
    total_payout = db.Column(db.Float, nullable=True, default=0)
    validation_rate = db.Column(db.Float, nullable=True, default=100)
    completion_rate = db.Column(db.Float, nullable=True, default=100)

    # Metadata
    difficulty = db.Column(db.String(50), nullable=True, default="Intermediate")
    visibility = db.Column(db.Boolean, nullable=True, server_default="False")
    active_status = db.Column(db.Boolean, nullable=True, server_default="False")
    completed = db.Column(db.Boolean, nullable=True, server_default="False")
    confirmed = db.Column(db.Boolean, nullable=True, server_default="False")


class ChecklistItem(ModelWithSoftDeleteAndCRUD, SurrogatePK, db.Model):
    """Individual item within a checklist."""

    __tablename__ = "checklist_item"

    id = db.Column(db.BigInteger, primary_key=True, nullable=False)
    checklist_id = db.Column(db.BigInteger, index=True)
    item_number = db.Column(db.Integer)
    item_action = db.Column(db.Text)
    item_link = db.Column(db.String(500))


class ChecklistComment(ModelWithSoftDeleteAndCRUD, SurrogatePK, db.Model):
    """Comment on a checklist."""

    __tablename__ = "checklist_comment"

    id = db.Column(db.BigInteger, primary_key=True, nullable=False)
    checklist_id = db.Column(db.BigInteger, index=True)
    comment = db.Column(db.Text)
    author = db.Column(db.String(200))
    role = db.Column(db.String(50))
    date = Column(DateTime, default=func.now())


class UserChecklist(ModelWithSoftDeleteAndCRUD, SurrogatePK, db.Model):
    """User's instance of a checklist."""

    __tablename__ = "user_checklists"

    id = db.Column(db.BigInteger, primary_key=True, nullable=False)
    user_id = db.Column(db.String(255), index=True)  # Changed to String for Auth0
    checklist_id = db.Column(db.BigInteger, index=True)
    date_created = Column(DateTime, default=func.now())

    # Copied from template
    name = db.Column(db.String(255), nullable=True)
    author = db.Column(db.String(200), nullable=True)
    description = db.Column(db.Text, nullable=True)
    due_date = Column(DateTime, nullable=True)
    org_id = db.Column(db.String(255), nullable=True)

    # Rates
    total_payout = db.Column(db.Float, nullable=True, default=0)
    validation_rate = db.Column(db.Float, nullable=True, default=100)
    completion_rate = db.Column(db.Float, nullable=True, default=100)

    # Metadata
    difficulty = db.Column(db.String(50), nullable=True, default="Intermediate")
    visibility = db.Column(db.Boolean, nullable=True, server_default="False")
    active_status = db.Column(db.Boolean, nullable=True, server_default="False")
    completed = db.Column(db.Boolean, nullable=True, server_default="False")
    confirmed = db.Column(db.Boolean, nullable=True, server_default="False")

    # Timestamps
    last_completion_date = Column(DateTime, nullable=True)
    last_confirmation_date = Column(DateTime, nullable=True)
    final_completion_date = Column(DateTime, nullable=True)
    final_confirmation_date = Column(DateTime, nullable=True)


class UserChecklistItem(ModelWithSoftDeleteAndCRUD, SurrogatePK, db.Model):
    """User's instance of a checklist item."""

    __tablename__ = "user_checklist_item"

    id = db.Column(db.BigInteger, primary_key=True, nullable=False)
    user_id = db.Column(db.String(255), index=True)  # Changed to String for Auth0
    checklist_id = db.Column(db.BigInteger, index=True)
    item_number = db.Column(db.Integer)
    item_action = db.Column(db.Text)
    item_link = db.Column(db.String(500))
    completed = db.Column(db.Boolean, default=False)
    confirmed = db.Column(db.Boolean, default=False)
    completion_date = Column(DateTime, nullable=True)
    confirmation_date = Column(DateTime, nullable=True)


class Training(ModelWithSoftDeleteAndCRUD, SurrogatePK, db.Model):
    """Training module model."""

    __tablename__ = "training"

    id = Column(Integer, primary_key=True, autoincrement=True)
    title = db.Column(db.String(255), nullable=True)
    org_id = db.Column(db.String(255), nullable=True)
    training_type = db.Column(db.String(100), nullable=True)
    point_value = db.Column(db.Integer, nullable=True)
    training_url = db.Column(db.String(500), nullable=True)
    difficulty = db.Column(db.String(50), nullable=True)
    created_by = db.Column(db.String(200), nullable=True)


class TrainingQuestion(ModelWithSoftDeleteAndCRUD, SurrogatePK, db.Model):
    """Question within a training module."""

    __tablename__ = "training_question"

    id = Column(Integer, primary_key=True, autoincrement=True)
    training_id = db.Column(
        db.BigInteger,
        db.ForeignKey("training.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    question = db.Column(db.Text, nullable=True)


class TrainingQuestionAnswer(ModelWithSoftDeleteAndCRUD, SurrogatePK, db.Model):
    """Answer option for a training question."""

    __tablename__ = "training_question_answer"

    id = Column(Integer, primary_key=True, autoincrement=True)
    training_id = db.Column(
        db.BigInteger,
        db.ForeignKey("training.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    training_question_id = db.Column(
        db.BigInteger,
        db.ForeignKey("training_question.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    value = db.Column(db.Boolean)
    answer = db.Column(db.Text, nullable=True)


class ProjectTraining(CRUDMixin, SurrogatePK, db.Model):
    """Association between projects and required training."""

    __tablename__ = "project_training"

    training_id = db.Column(
        db.Integer,
        db.ForeignKey("training.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    project_id = db.Column(
        db.BigInteger,
        db.ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )


class TrainingCompleted(CRUDMixin, SurrogatePK, db.Model):
    """Record of user completing a training."""

    __tablename__ = "training_completed"

    user_id = db.Column(
        db.String(255),  # Changed to String for Auth0
        nullable=True,
        index=True,
    )
    training_id = db.Column(
        db.BigInteger,
        db.ForeignKey("training.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )


class ProjectUser(CRUDMixin, SurrogatePK, db.Model):
    """Association between users and projects."""

    __tablename__ = "project_users"

    user_id = db.Column(
        db.String(255),  # Changed to String for Auth0
        nullable=True,
        index=True,
    )
    project_id = db.Column(
        db.BigInteger,
        db.ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )


class UserTasks(CRUDMixin, SurrogatePK, db.Model):
    """Association between users and tasks."""

    __tablename__ = "user_tasks"

    user_id = db.Column(
        db.String(255),  # Changed to String for Auth0
        nullable=False,
        index=True,
    )
    task_id = db.Column(
        db.BigInteger,
        db.ForeignKey("tasks.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    timestamp = db.Column(db.TIMESTAMP, nullable=False, default=func.now())


class PayRequests(CRUDMixin, SurrogatePK, db.Model):
    """Payment request from a user."""

    __tablename__ = "requests"

    id = db.Column(db.BigInteger, primary_key=True, nullable=False)
    org_id = db.Column(db.String(255), nullable=True)
    amount_requested = db.Column(db.Float, nullable=True)
    user_id = db.Column(db.String(255), nullable=True, index=True)  # Changed to String
    user_name = db.Column(db.String(200), nullable=True)
    osm_username = db.Column(db.String(100), nullable=True)
    payment_email = db.Column(db.String(255), nullable=True)
    task_ids = Column(MutableList.as_mutable(ARRAY(Integer)))
    date_requested = Column(DateTime, default=func.now())
    notes = db.Column(db.Text, nullable=True)


class Payments(CRUDMixin, SurrogatePK, db.Model):
    """Completed payment record."""

    __tablename__ = "payments"

    id = db.Column(db.BigInteger, primary_key=True, nullable=False)
    org_id = db.Column(db.String(255), nullable=True)
    payoneer_id = db.Column(db.String(100), nullable=True)
    amount_paid = db.Column(db.Float, nullable=True)
    user_name = db.Column(db.String(200), nullable=True)
    osm_username = db.Column(db.String(100), nullable=True)
    user_id = db.Column(db.String(255), nullable=True, index=True)  # Changed to String
    payment_email = db.Column(db.String(255), nullable=True)
    task_ids = Column(MutableList.as_mutable(ARRAY(Integer)))
    date_paid = Column(DateTime, default=func.now())
    notes = db.Column(db.Text, nullable=True)


class Team(ModelWithSoftDeleteAndCRUD, SurrogatePK):
    """Team model for grouping users."""

    __tablename__ = "teams"

    name = db.Column(db.String(255), nullable=False)
    description = db.Column(db.Text, nullable=True)
    org_id = db.Column(db.String(255), nullable=True)
    lead_id = db.Column(db.String(255), nullable=True)
    created_at = db.Column(db.DateTime, default=func.now())
    updated_at = db.Column(db.DateTime, default=func.now(), onupdate=func.now())

    def __repr__(self):
        return f"<Team {self.id}: {self.name}>"


class TeamUser(CRUDMixin, SurrogatePK, db.Model):
    """Association between users and teams."""

    __tablename__ = "team_users"

    user_id = db.Column(db.String(255), nullable=False, index=True)
    team_id = db.Column(
        db.Integer,
        db.ForeignKey("teams.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )


class TeamLead(CRUDMixin, SurrogatePK, db.Model):
    """Association table — users who lead (act as team_admin for) a team.

    Replaces the single ``Team.lead_id`` pointer for the team-admin scoping
    check. ``Team.lead_id`` is retained as a denormalized "primary lead"
    pointer used only for legacy display; all gating goes through this
    table via ``managed_team_ids_for()``.
    """

    __tablename__ = "team_leads"

    team_id = db.Column(
        db.Integer,
        db.ForeignKey("teams.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = db.Column(db.String(255), nullable=False, index=True)
    created_at = db.Column(db.DateTime, default=func.now(), nullable=False)

    __table_args__ = (
        db.UniqueConstraint("team_id", "user_id", name="uq_team_leads_team_user"),
    )


class ProjectTeam(CRUDMixin, SurrogatePK, db.Model):
    """Association between teams and projects."""

    __tablename__ = "project_teams"

    team_id = db.Column(
        db.Integer,
        db.ForeignKey("teams.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    project_id = db.Column(
        db.BigInteger,
        db.ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )


class TeamTraining(CRUDMixin, SurrogatePK, db.Model):
    """Association between teams and trainings."""

    __tablename__ = "team_trainings"

    team_id = db.Column(
        db.Integer,
        db.ForeignKey("teams.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    training_id = db.Column(
        db.Integer,
        db.ForeignKey("training.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )


class TeamChecklist(CRUDMixin, SurrogatePK, db.Model):
    """Association between teams and checklists."""

    __tablename__ = "team_checklists"

    team_id = db.Column(
        db.Integer,
        db.ForeignKey("teams.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    checklist_id = db.Column(
        db.BigInteger,
        db.ForeignKey("checklists.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )


class Region(CRUDMixin, SurrogatePK, db.Model):
    """Geographic region grouping (e.g., Latin America, East Africa)."""

    __tablename__ = "regions"

    name = db.Column(db.String(100), nullable=False, unique=True)
    org_id = db.Column(db.String(255), nullable=True)
    created_at = db.Column(db.DateTime, default=func.now())

    def __repr__(self):
        return f"<Region {self.id}: {self.name}>"


class Country(CRUDMixin, SurrogatePK, db.Model):
    """Country belonging to a region, with default timezone."""

    __tablename__ = "countries"

    name = db.Column(db.String(100), nullable=False)
    iso_code = db.Column(db.String(3), nullable=True, unique=True)
    region_id = db.Column(
        db.Integer,
        db.ForeignKey("regions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    default_timezone = db.Column(db.String(50), nullable=True)
    org_id = db.Column(db.String(255), nullable=True)
    created_at = db.Column(db.DateTime, default=func.now())

    def __repr__(self):
        return f"<Country {self.id}: {self.name}>"


class UserCountry(CRUDMixin, SurrogatePK, db.Model):
    """Association between users and countries (supports multiple countries per user)."""

    __tablename__ = "user_countries"

    user_id = db.Column(db.String(255), nullable=False, index=True)
    country_id = db.Column(
        db.Integer,
        db.ForeignKey("countries.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    is_primary = db.Column(db.Boolean, default=True, server_default="True")


class ProjectCountry(CRUDMixin, SurrogatePK, db.Model):
    """Association between projects and countries for location-based visibility."""

    __tablename__ = "project_countries"

    project_id = db.Column(
        db.BigInteger,
        db.ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    country_id = db.Column(
        db.Integer,
        db.ForeignKey("countries.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )


class TrainingCountry(CRUDMixin, SurrogatePK, db.Model):
    """Association between trainings and countries for location-based visibility."""

    __tablename__ = "training_countries"

    training_id = db.Column(
        db.Integer,
        db.ForeignKey("training.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    country_id = db.Column(
        db.Integer,
        db.ForeignKey("countries.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )


class ChecklistCountry(CRUDMixin, SurrogatePK, db.Model):
    """Association between checklists and countries for location-based visibility."""

    __tablename__ = "checklist_countries"

    checklist_id = db.Column(
        db.BigInteger,
        db.ForeignKey("checklists.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    country_id = db.Column(
        db.Integer,
        db.ForeignKey("countries.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )


class PendingInvite(CRUDMixin, SurrogatePK, db.Model):
    """
    A team-targeted Auth0 invitation that hasn't been accepted yet.

    When a team_admin (or org admin) invites a user with a specific
    target team, a row is written here. On the new user's first login
    (Login.py user-create path), we look up by (email, org_id), create
    the matching TeamUser association, and mark the row consumed.

    Org Admin / super_admin invites without a target team don't write
    here — only invitations carrying a team context need persistence.
    """

    __tablename__ = "pending_invites"

    email = db.Column(db.String(255), nullable=False, index=True)
    org_id = db.Column(db.String(255), nullable=False, index=True)
    target_team_id = db.Column(
        db.Integer,
        db.ForeignKey("teams.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    invited_by_user_id = db.Column(db.String(255), nullable=True)
    auth0_invitation_id = db.Column(db.String(255), nullable=True, index=True)
    consumed_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=func.now(), nullable=False)


class TimeEntry(CRUDMixin, db.Model):
    """Time tracking entry for contractor clock in/out."""

    __tablename__ = "time_entries"

    id = db.Column(db.BigInteger, primary_key=True, autoincrement=True)
    user_id = db.Column(
        db.String(255),
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    project_id = db.Column(
        db.Integer,
        db.ForeignKey("projects.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    org_id = db.Column(db.String(255), nullable=True, index=True)
    category = db.Column(db.String(50), nullable=False)  # mapping|validation|review|training|other
    task_name = db.Column(db.String(255), nullable=True)       # display name of the selected task
    task_ref_type = db.Column(db.String(50), nullable=True)     # "project", "training", "checklist", or null
    task_ref_id = db.Column(db.Integer, nullable=True)          # FK to the referenced entity, or null
    clock_in = db.Column(DateTime, nullable=False, default=func.now())
    clock_out = db.Column(DateTime, nullable=True)
    duration_seconds = db.Column(db.Integer, nullable=True)
    status = db.Column(
        db.String(20), nullable=False, default="active", server_default="active"
    )  # active|completed|voided
    changeset_count = db.Column(db.Integer, nullable=True, default=0)
    changes_count = db.Column(db.Integer, nullable=True, default=0)
    voided_by = db.Column(db.String(255), nullable=True)
    voided_at = db.Column(DateTime, nullable=True)
    edited_by = db.Column(db.String(255), nullable=True)
    edited_at = db.Column(DateTime, nullable=True)
    force_clocked_out_by = db.Column(db.String(255), nullable=True)
    notes = db.Column(db.Text, nullable=True)
    user_notes = db.Column(db.Text, nullable=True)

    # Relationships
    # passive_deletes — let the DB's ON DELETE CASCADE clean these up
    # when a User is hard-deleted, instead of ORM trying to NULL user_id.
    user = db.relationship("User", backref=db.backref("time_entries", passive_deletes=True))
    project = db.relationship("Project", backref="time_entries")

    __table_args__ = (
        db.Index("ix_time_entries_user_status", "user_id", "status"),
        db.Index("ix_time_entries_org_status", "org_id", "status"),
    )

    def __repr__(self):
        return f"<TimeEntry {self.id} user={self.user_id} status={self.status}>"


class CustomTopic(CRUDMixin, db.Model):
    """User-created custom topic for time tracking 'Other' category."""
    __tablename__ = "custom_topics"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    name = db.Column(db.String(100), nullable=False)
    org_id = db.Column(db.String(255), nullable=True)
    created_by = db.Column(db.String(255), nullable=True)
    created_at = db.Column(db.DateTime, default=func.now())

    __table_args__ = (
        db.UniqueConstraint("name", "org_id", name="uq_custom_topics_name_org"),
    )

    def __repr__(self):
        return f"<CustomTopic {self.id}: {self.name}>"


class HourlyPayment(CRUDMixin, db.Model):
    """Tracks hourly contractor payment status per month."""
    __tablename__ = "hourly_payments"

    id = db.Column(db.BigInteger, primary_key=True, autoincrement=True)
    user_id = db.Column(db.String(255), db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    org_id = db.Column(db.String(255), nullable=True, index=True)
    year = db.Column(db.Integer, nullable=False)
    month = db.Column(db.Integer, nullable=False)  # 1-12
    total_seconds = db.Column(db.Integer, nullable=False, default=0)
    hourly_rate = db.Column(db.Float, nullable=False)  # snapshot of rate at payment time
    amount_due = db.Column(db.Float, nullable=False, default=0)
    paid = db.Column(db.Boolean, nullable=False, default=False, server_default="False")
    paid_at = db.Column(db.DateTime, nullable=True)
    paid_by = db.Column(db.String(255), nullable=True)
    notes = db.Column(db.Text, nullable=True)

    # passive_deletes — DB cascade handles removal on User hard-delete.
    user = db.relationship("User", backref=db.backref("hourly_payments", passive_deletes=True))

    __table_args__ = (
        db.UniqueConstraint("user_id", "year", "month", name="uq_hourly_payment_user_month"),
        db.Index("ix_hourly_payments_year_month", "year", "month"),
    )

    def __repr__(self):
        return f"<HourlyPayment user={self.user_id} {self.year}-{self.month} paid={self.paid}>"


class SyncJob(CRUDMixin, db.Model):
    """Background sync job tracking for task synchronization."""

    __tablename__ = "sync_jobs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    org_id = Column(String(255), nullable=True, index=True)
    status = Column(String(50), nullable=False, default="queued")
    job_type = Column(String(50), nullable=False, default="task_sync", server_default="task_sync")
    target_id = Column(BigInteger, nullable=True)  # e.g. project_id for project_sync jobs
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    progress = Column(String(500), nullable=True)
    error = db.Column(db.Text, nullable=True)
    created_at = Column(DateTime, default=func.now())

    def __repr__(self):
        return f"<SyncJob {self.id} org={self.org_id} type={self.job_type} status={self.status}>"


class ElementAnalysisCache(CRUDMixin, db.Model):
    """Cached element type analysis results from OSM changeset data."""

    __tablename__ = "element_analysis_cache"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    org_id = Column(String(255), nullable=True, index=True)
    day = Column(db.Date, nullable=False)
    category = Column(String(50), nullable=False)
    added = Column(Integer, nullable=False, default=0)
    modified = Column(Integer, nullable=False, default=0)
    deleted = Column(Integer, nullable=False, default=0)
    updated_at = Column(DateTime, default=func.now())

    def __repr__(self):
        return f"<ElementAnalysisCache org={self.org_id} day={self.day} cat={self.category}>"


class Punk(ModelWithSoftDeleteAndCRUD, SurrogatePK):
    """Watchlist entry for a problematic OSM editor."""

    __tablename__ = "punks"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    osm_username = db.Column(db.String(255), nullable=False, unique=True, index=True)
    osm_uid = db.Column(db.BigInteger, nullable=True)
    notes = db.Column(db.Text, nullable=True)
    tags = Column(MutableList.as_mutable(ARRAY(String(50))), nullable=True)
    added_by = db.Column(db.String(255), nullable=False)
    added_by_name = db.Column(db.String(200), nullable=True)
    org_id = db.Column(db.String(255), nullable=True)
    created_at = db.Column(db.DateTime, default=func.now())
    cached_total_changesets = db.Column(db.Integer, nullable=True)
    cached_last_active = db.Column(db.DateTime, nullable=True)
    cached_account_created = db.Column(db.DateTime, nullable=True)
    cache_updated_at = db.Column(db.DateTime, nullable=True)
    cached_discussions = db.Column(db.Text, nullable=True)  # JSON blob of discussion entries
    flagged_discussions = db.Column(db.Text, nullable=True)  # JSON array of flagged discussion links


class PunkChangeset(CRUDMixin, SurrogatePK, db.Model):
    """Cached changeset data for a watched punk."""

    __tablename__ = "punk_changesets"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    punk_id = db.Column(
        db.Integer,
        db.ForeignKey("punks.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    changeset_id = db.Column(db.BigInteger, nullable=False, unique=True)
    created_at = db.Column(db.DateTime, nullable=False)
    closed_at = db.Column(db.DateTime, nullable=True)
    changes_count = db.Column(db.Integer, default=0)
    comment = db.Column(db.Text, nullable=True)
    editor = db.Column(db.String(255), nullable=True)
    source = db.Column(db.String(255), nullable=True)
    centroid_lat = db.Column(db.Float, nullable=True)
    centroid_lon = db.Column(db.Float, nullable=True)
    hashtags = Column(MutableList.as_mutable(ARRAY(String(255))), nullable=True)


class Friend(ModelWithSoftDeleteAndCRUD, SurrogatePK):
    """Tracked OSM editor on the friends watchlist."""

    __tablename__ = "friends"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    osm_username = db.Column(db.String(255), nullable=False, unique=True, index=True)
    osm_uid = db.Column(db.BigInteger, nullable=True)
    notes = db.Column(db.Text, nullable=True)
    tags = Column(MutableList.as_mutable(ARRAY(String(50))), nullable=True)
    added_by = db.Column(db.String(255), nullable=False)
    added_by_name = db.Column(db.String(200), nullable=True)
    org_id = db.Column(db.String(255), nullable=True)
    created_at = db.Column(db.DateTime, default=func.now())
    cached_total_changesets = db.Column(db.Integer, nullable=True)
    cached_last_active = db.Column(db.DateTime, nullable=True)
    cached_account_created = db.Column(db.DateTime, nullable=True)
    cache_updated_at = db.Column(db.DateTime, nullable=True)
    cached_discussions = db.Column(db.Text, nullable=True)
    flagged_discussions = db.Column(db.Text, nullable=True)


class FriendChangeset(CRUDMixin, SurrogatePK, db.Model):
    """Cached changeset data for a tracked friend."""

    __tablename__ = "friend_changesets"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    friend_id = db.Column(
        db.Integer,
        db.ForeignKey("friends.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    changeset_id = db.Column(db.BigInteger, nullable=False, unique=True)
    created_at = db.Column(db.DateTime, nullable=False)
    closed_at = db.Column(db.DateTime, nullable=True)
    changes_count = db.Column(db.Integer, default=0)
    comment = db.Column(db.Text, nullable=True)
    editor = db.Column(db.String(255), nullable=True)
    source = db.Column(db.String(255), nullable=True)
    centroid_lat = db.Column(db.Float, nullable=True)
    centroid_lon = db.Column(db.Float, nullable=True)
    hashtags = Column(MutableList.as_mutable(ARRAY(String(255))), nullable=True)


class WeeklyReport(CRUDMixin, db.Model):
    """Weekly report draft for client-facing PDF generation."""

    __tablename__ = "weekly_reports"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    org_id = db.Column(db.String(255), nullable=True, index=True)
    title = db.Column(db.String(255), nullable=False)
    report_date = db.Column(db.Date, nullable=False)
    start_date = db.Column(db.Date, nullable=False)
    end_date = db.Column(db.Date, nullable=False)
    sections = db.Column(db.Text, nullable=False)  # JSON blob of all section data
    status = db.Column(db.String(20), default="draft", server_default="draft")
    created_by = db.Column(db.String(255), nullable=True)
    created_at = db.Column(db.DateTime, default=func.now())
    updated_at = db.Column(db.DateTime, default=func.now(), onupdate=func.now())

    def __repr__(self):
        return f"<WeeklyReport {self.id} title={self.title} status={self.status}>"


class CommunityEntry(CRUDMixin, db.Model):
    """Community update entry synced from Google Sheets or entered manually."""

    __tablename__ = "community_entries"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    org_id = db.Column(db.String(255), nullable=True, index=True)
    sheet_row_index = db.Column(db.Integer, nullable=True)
    entry_type = db.Column(
        db.String(50), nullable=False, default="outreach", server_default="outreach"
    )
    submitted_at = db.Column(db.DateTime, nullable=True)
    original_data = db.Column(db.Text, nullable=True)
    edited_data = db.Column(db.Text, nullable=True)
    is_edited = db.Column(db.Boolean, default=False, server_default="False")
    submitted_by = db.Column(db.String(255), nullable=True)
    created_at = db.Column(db.DateTime, default=func.now())
    updated_at = db.Column(db.DateTime, default=func.now(), onupdate=func.now())

    def __repr__(self):
        return f"<CommunityEntry {self.id} type={self.entry_type}>"


class MonitoredChannel(CRUDMixin, db.Model):
    """Configured OSM communication channel to monitor and summarize."""

    __tablename__ = "monitored_channels"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    org_id = db.Column(db.String(255), nullable=True, index=True)
    name = db.Column(db.String(255), nullable=False)
    url = db.Column(db.String(512), nullable=False)
    channel_type = db.Column(db.String(50), default="rss", server_default="rss")
    active = db.Column(db.Boolean, default=True, server_default="True")
    last_fetched_at = db.Column(db.DateTime, nullable=True)
    last_summary = db.Column(db.Text, nullable=True)
    last_summary_at = db.Column(db.DateTime, nullable=True)
    post_count = db.Column(db.Integer, default=0)
    created_by = db.Column(db.String(255), nullable=True)
    created_at = db.Column(db.DateTime, default=func.now())

    def __repr__(self):
        return f"<MonitoredChannel {self.id} name={self.name}>"


class ChannelPost(CRUDMixin, db.Model):
    """Cached post from a monitored OSM channel."""

    __tablename__ = "channel_posts"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    channel_id = db.Column(
        db.Integer,
        db.ForeignKey("monitored_channels.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    external_id = db.Column(db.String(512), nullable=True)
    title = db.Column(db.String(512), nullable=True)
    content = db.Column(db.Text, nullable=True)
    author = db.Column(db.String(255), nullable=True)
    published_at = db.Column(db.DateTime, nullable=True)
    fetched_at = db.Column(db.DateTime, default=func.now())

    def __repr__(self):
        return f"<ChannelPost {self.id} channel={self.channel_id}>"


class TranscriptionJob(CRUDMixin, db.Model):
    """Audio transcription job tracking."""

    __tablename__ = "transcription_jobs"

    id = Column(String(8), primary_key=True)
    user_id = Column(String(255), nullable=False, index=True)
    org_id = Column(String(255), nullable=True, index=True)
    status = Column(String(50), nullable=False, default="queued")
    file_name = Column(String(500), nullable=True)
    file_url = Column(String(1000), nullable=True)
    segments = Column(Text, nullable=True)
    text = Column(Text, nullable=True)
    duration = Column(Float, nullable=True)
    error = Column(Text, nullable=True)
    progress = Column(Integer, default=0)
    title = Column(String(500), nullable=True)
    tags = Column(Text, nullable=True)
    created_at = Column(DateTime, default=func.now())
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)

    def __repr__(self):
        return f"<TranscriptionJob {self.id} user={self.user_id} status={self.status}>"
