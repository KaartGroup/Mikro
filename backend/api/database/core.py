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

    # Mapper stats
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
    payable_total = db.Column(db.Float, nullable=True, default=0, server_default="0")
    requested_total = db.Column(db.Float, nullable=True, default=0, server_default="0")
    paid_total = db.Column(db.Float, nullable=True, default=0, server_default="0")

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

    # Compensation model (added 2026-05-18). NULL = legacy/unspecified →
    # resolver treats as per_task (core). Active hourly rate from
    # user_hourly_rates table determines whether a user is hourly.
    # Explicit values: per_task | hourly | project_based
    compensation_model = db.Column(db.String(20), nullable=True, default=None)

    def __repr__(self):
        return f"<User {self.email}>"

    @property
    def full_name(self):
        """Return the user's full name."""
        return f"{self.first_name or ''} {self.last_name or ''}".strip()


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
    total_editors = db.Column(db.BigInteger, default=0)

    # Task stats
    total_tasks = db.Column(db.BigInteger, default=0)
    tasks_overlap = db.Column(db.Integer, default=0)

    # Metadata
    difficulty = db.Column(db.String(50), nullable=True, default="Intermediate")
    community = db.Column(db.Boolean, nullable=False, default=False, server_default="false")
    priority = db.Column(db.String(50), nullable=False, default="Medium", server_default="Medium")
    visibility = db.Column(db.Boolean, nullable=True, server_default="False")
    status = db.Column(db.Boolean, nullable=True, server_default="False")

    # Reactivation request (set when a non-admin asks an admin to unarchive
    # a soft-deleted/"archived" project; cleared on reactivate/dismiss/purge)
    reactivation_requested_at = db.Column(db.DateTime, nullable=True)
    reactivation_requested_by = db.Column(db.String(255), nullable=True)
    reactivation_reason = db.Column(db.Text, nullable=True)

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


class ReimbursementRequest(CRUDMixin, SurrogatePK, db.Model):
    """Editor-submitted reimbursement request against an approved event proposal.

    Editors submit -> rows land here as ``pending``. Admins approve or
    reject. Withdraw is editor-only and only valid while ``pending``.
    Approved / rejected / withdrawn are terminal states.

    Each request must reference an approved :class:`EventProposal` and
    the amount must not exceed the event's total proposed budget.
    """

    __tablename__ = "reimbursement_requests"

    user_id = db.Column(
        db.String(255),
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    org_id = db.Column(db.String(255), nullable=True)
    # FK to the approved EventProposal this reimbursement is against.
    # Nullable to preserve existing rows created before this constraint.
    event_proposal_id = db.Column(
        db.Integer,
        db.ForeignKey("event_proposals.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    amount = db.Column(db.Numeric(10, 2), nullable=False)
    description = db.Column(db.Text, nullable=False)
    # DO Spaces object key (e.g. "reimbursements/<user_id>/<uuid>/<file>").
    # NOT a signed URL — backend signs on demand at fetch time.
    attachment_url = db.Column(db.String(500), nullable=True)
    # pending | approved | rejected | withdrawn
    status = db.Column(
        db.String(20), nullable=False, default="pending", server_default="pending"
    )
    submitted_at = db.Column(
        db.DateTime, nullable=False, default=func.now(), server_default=func.now()
    )
    reviewed_by = db.Column(db.String(255), nullable=True)
    reviewed_at = db.Column(db.DateTime, nullable=True)
    reviewer_note = db.Column(db.Text, nullable=True)

    user = db.relationship(
        "User",
        backref=db.backref("reimbursement_requests", passive_deletes=True),
    )
    event_proposal = db.relationship("EventProposal")

    __table_args__ = (
        db.CheckConstraint(
            "amount > 0",
            name="ck_reimbursement_requests_amount_positive",
        ),
        db.Index(
            "ix_reimbursement_requests_org_status", "org_id", "status",
        ),
        db.Index(
            "ix_reimbursement_requests_user_submitted",
            "user_id", "submitted_at",
        ),
    )

    def __repr__(self):
        return (
            f"<ReimbursementRequest {self.id} user={self.user_id} "
            f"amount={self.amount} status={self.status}>"
        )


class PaymentCycleStatus(CRUDMixin, SurrogatePK, db.Model):
    """Per-user × per-cycle payment status for the Payments v1 page.

    Rows are created lazily on first state transition — a missing row is
    treated as the default ``"pending"`` state. State machine:
    Pending → Approved → Paid (forward), with Pending|Approved → Held
    (off-ramp; recoverable back to Pending). Audited via actor_id +
    updated_at.
    """

    __tablename__ = "payment_cycle_status"

    user_id = db.Column(
        db.String(255),
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    cycle_start = db.Column(db.Date, nullable=False, index=True)
    cycle_end = db.Column(db.Date, nullable=False, index=True)
    # "pending" | "approved" | "held" | "paid"
    status = db.Column(
        db.String(20), nullable=False, server_default="pending"
    )
    note = db.Column(db.Text, nullable=True)
    actor_id = db.Column(db.String(255), nullable=True)
    updated_at = db.Column(
        db.DateTime,
        default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    __table_args__ = (
        db.UniqueConstraint(
            "user_id",
            "cycle_start",
            "cycle_end",
            name="uq_payment_cycle_status_user_cycle",
        ),
    )


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
    # Tier 1 of the time-tracking taxonomy. The set of activity slugs is a
    # hardcoded app-side enum (pan-org primitives) — see ACTIVITY_SLUGS in
    # api/views/TimeTracking.py and TOPIC_OPTIONS in lib/timeTracking.ts.
    # (Renamed from `category` in migration c4f8a9b0d1e2; old `category`
    # values map 1:1 to the new activity slugs without backfill.)
    activity = db.Column(db.String(50), nullable=False)
    # Tier 2 (configurable, optional): the chosen ActivitySubcategory row.
    # NULL on legacy entries (pre-rework) and on any activity that has no
    # subs configured for the user's scope. Displayed as "—" in tables
    # and aggregated under "Unspecified" in reports.
    subcategory_id = db.Column(
        db.Integer,
        db.ForeignKey("activity_subcategories.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Snapshot of subcategory.name at write time. Reports/tables read
    # this column directly (no join) so soft-deletes and renames of the
    # underlying subcategory row never fragment historical aggregations.
    subcategory_name = db.Column(db.String(100), nullable=True)
    # Event-attendance counts. Populated only when the chosen subcategory
    # has allow_event_fields=true (e.g. Community -> Events). NULL
    # otherwise — the UI hides the inputs and the backend rejects values
    # for subcategories that don't allow them.
    retained_participants = db.Column(db.Integer, nullable=True)
    new_participants = db.Column(db.Integer, nullable=True)
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
    subcategory = db.relationship("ActivitySubcategory")

    __table_args__ = (
        db.Index("ix_time_entries_user_status", "user_id", "status"),
        db.Index("ix_time_entries_org_status", "org_id", "status"),
        # Aggregation index for the timekeeping report's
        # GROUP BY (activity, subcategory_name).
        db.Index(
            "ix_time_entries_org_activity_sub",
            "org_id", "activity", "subcategory_name",
        ),
    )

    def __repr__(self):
        return f"<TimeEntry {self.id} user={self.user_id} status={self.status}>"


class CustomTopic(CRUDMixin, db.Model):
    """User-created custom topic for time tracking 'Other' category.

    DEPRECATED: superseded by ActivitySubcategory rows with
    ``activity='other'``. The d5a0b1c2e3f4 seed migration copies these
    rows into activity_subcategories. The table is kept temporarily so
    rollback stays trivial; a follow-up migration drops it once we're
    satisfied with backfill quality on prod.
    """
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


class ActivitySubcategory(CRUDMixin, db.Model):
    """Configurable tier-2 subcategory for time tracking.

    Parent ``activity`` is a hardcoded app-side enum (see
    ``ACTIVITY_SLUGS`` in api/views/TimeTracking.py). Subcategories live
    here in three visibility scopes via ``(org_id, team_id)``:

    - ``org_id IS NULL AND team_id IS NULL`` -> **global**: visible to
      every user in every org.
    - ``org_id`` set, ``team_id IS NULL`` -> **org**: visible to every
      user in that org.
    - ``org_id`` set, ``team_id`` set -> **team**: visible only to
      members of that team + admins above team_admin in the same org.

    Specificity rule on label collisions: team > org > global.

    Soft-delete only (``is_active=false``). The FK from
    ``time_entries.subcategory_id`` is ``ON DELETE SET NULL`` so even a
    hard delete is non-destructive to history; the snapshot in
    ``time_entries.subcategory_name`` preserves the label.

    Two per-row behavior flags drive UI without code changes:

    - ``requires_project``: when true, the clock-in form must have a
      project picked before submit is allowed.
    - ``allow_event_fields``: when true, the form exposes the
      ``# Retained Participants`` / ``# New Participants`` inputs (e.g.
      Community -> Events).
    """
    __tablename__ = "activity_subcategories"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    activity = db.Column(db.String(50), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    slug = db.Column(db.String(100), nullable=False)
    org_id = db.Column(db.String(255), nullable=True)
    team_id = db.Column(
        db.Integer,
        db.ForeignKey("teams.id", ondelete="SET NULL"),
        nullable=True,
    )
    is_active = db.Column(
        db.Boolean, nullable=False, default=True, server_default=db.true()
    )
    sort_order = db.Column(
        db.Integer, nullable=False, default=0, server_default="0"
    )
    requires_project = db.Column(
        db.Boolean, nullable=False, default=False, server_default=db.false()
    )
    allow_event_fields = db.Column(
        db.Boolean, nullable=False, default=False, server_default=db.false()
    )
    created_by = db.Column(db.String(255), nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=func.now())
    updated_at = db.Column(
        db.DateTime,
        nullable=False,
        default=func.now(),
        onupdate=func.now(),
    )

    team = db.relationship("Team")

    __table_args__ = (
        db.CheckConstraint(
            "team_id IS NULL OR org_id IS NOT NULL",
            name="ck_activity_subcategories_team_requires_org",
        ),
        db.UniqueConstraint(
            "activity", "slug", "org_id", "team_id",
            name="uq_activity_subcategories_scope",
        ),
        db.Index("ix_activity_subcategories_dropdown", "activity", "is_active"),
        db.Index("ix_activity_subcategories_org", "org_id"),
        db.Index("ix_activity_subcategories_team", "team_id"),
    )

    def __repr__(self):
        scope = (
            f"team={self.team_id}" if self.team_id is not None
            else f"org={self.org_id}" if self.org_id is not None
            else "global"
        )
        return f"<ActivitySubcategory {self.activity}/{self.slug} {scope}>"


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


class UserHourlyRate(CRUDMixin, db.Model):
    """Time-bounded hourly rate for a user.

    Only one rate may be active at any given date for a user; the service
    layer enforces this — no DB-level exclusion constraint is used because
    NULLable end_date makes that constraint awkward in standard SQL.
    """

    __tablename__ = "user_hourly_rates"

    id = db.Column(db.BigInteger, primary_key=True, autoincrement=True)
    user_id = db.Column(
        db.String(255),
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    org_id = db.Column(db.String(255), nullable=True, index=True)
    rate = db.Column(db.Numeric(10, 4), nullable=False)
    start_date = db.Column(db.Date, nullable=False)
    end_date = db.Column(db.Date, nullable=True)  # NULL = currently active / open-ended
    created_by = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, server_default=func.now(), nullable=False)
    notes = db.Column(db.Text, nullable=True)

    user = db.relationship("User", backref=db.backref("hourly_rates", passive_deletes=True))

    __table_args__ = (
        db.Index("ix_user_hourly_rates_user_start", "user_id", "start_date"),
    )

    def __repr__(self):
        return (
            f"<UserHourlyRate user={self.user_id} "
            f"rate={self.rate} {self.start_date}–{self.end_date or 'open'}>"
        )


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



class ChangesetAdiff(CRUDMixin, db.Model):
    """Per-changeset raw adiff XML from osmcha.

    Stores the full XML blob so it can be reprocessed with any future logic
    without re-fetching from osmcha.
    """

    __tablename__ = "changeset_adiffs"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    org_id = Column(String(255), nullable=False, index=True)
    changeset_id = Column(BigInteger, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, index=True)  # when the changeset occurred (UTC)
    user_id = Column(String(255), nullable=True, index=True)
    team_id = Column(db.Integer, nullable=True, index=True)
    osm_user = Column(String(255), nullable=True)
    adiff_xml = Column(db.Text, nullable=True)  # raw osmcha adiff XML; null when no diff exists

    __table_args__ = (
        db.UniqueConstraint("org_id", "changeset_id", name="uq_changeset_adiff_org"),
    )

    def __repr__(self):
        return f"<ChangesetAdiff org={self.org_id} cs={self.changeset_id}>"


class PayrollConfig(CRUDMixin, db.Model):
    """Per-org payroll cadence config (one row per org_id).

    Drives the payments-page cycle picker's default + preset periods.
    Custom date ranges remain allowed regardless. Fail-open: absence of a
    row means monthly / anchor day 1.
    """

    __tablename__ = "payroll_config"

    id = Column(Integer, primary_key=True, autoincrement=True)
    org_id = Column(String(255), nullable=False, unique=True, index=True)
    # "monthly" | "semi_monthly" | "bi_weekly"
    cadence = Column(String(20), nullable=False, default="monthly")
    anchor_day = Column(Integer, nullable=True)   # monthly day-of-month (1–28)
    anchor_date = Column(db.Date, nullable=True)  # bi_weekly period origin
    timezone = Column(String(50), nullable=True)
    updated_by = Column(String(255), nullable=True)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    def __repr__(self):
        return f"<PayrollConfig org={self.org_id} cadence={self.cadence}>"


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


class Organization(CRUDMixin, db.Model):
    """
    A tenant organization provisioned through Mikro (super_admin-managed).

    The primary key IS the Auth0 Organization id (e.g. ``org_abc123``) — the
    same value stored on ``User.org_id`` — so this table is the single source
    of truth for which orgs exist in Mikro and whether they may log in.

    "Delete" is a soft state (``status='disabled'``), never a row removal, so a
    super_admin can restore a disabled org and the data/audit trail survives.
    Disabled orgs stay visible in the admin list (this model deliberately does
    NOT use the soft-delete query filter, which would hide them).
    """

    __tablename__ = "organizations"

    # Auth0 Organization id (org_...). Mirrors User.org_id — the join key for
    # every per-org scoped query in the app.
    id = db.Column(db.String(255), primary_key=True, nullable=False)
    # Auth0 org `name` slug (unique, lowercase). Distinct from display_name.
    name = db.Column(db.String(255), nullable=False, unique=True)
    display_name = db.Column(db.String(255), nullable=True)
    # active | disabled. 'disabled' blocks login but retains all data.
    # Indexed: both the admin list and the future login-validation lookup
    # filter on status. SQLAlchemy auto-names this ix_organizations_status,
    # matching the index created in migration f8e1d2c3b4a5.
    status = db.Column(
        db.String(20),
        nullable=False,
        default="active",
        server_default="active",
        index=True,
    )
    # Audit: the super_admin who provisioned it. Stored as a user-id string,
    # matching the codebase's audit-column convention (no FK).
    created_by_user_id = db.Column(db.String(255), nullable=True)
    contact_name = db.Column(db.String(255), nullable=True)
    contact_email = db.Column(db.String(255), nullable=True)
    notes = db.Column(db.Text, nullable=True)
    # Reserved for future per-org Auth0 branding — a JSON blob stored as text
    # so adding branding later needs no migration. Null = Mikro defaults.
    branding = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=func.now())
    updated_at = db.Column(db.DateTime, default=func.now(), onupdate=func.now())
    disabled_at = db.Column(db.DateTime, nullable=True)

    def __repr__(self):
        return f"<Organization {self.id}: {self.name} ({self.status})>"


class EventProposal(CRUDMixin, SurrogatePK, db.Model):
    """
    Event proposal submitted by a mapper for funding/approval.

    Workflow: submitted (pending) → approved | rejected.
    Admins review and update status; submitter can withdraw while pending.
    Supporting file object keys are stored as a JSON array in
    ``attachment_keys`` and are populated via a separate upload-URL flow.
    """

    __tablename__ = "event_proposals"

    user_id = db.Column(
        db.String(255),
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    org_id = db.Column(db.String(255), nullable=True, index=True)
    title = db.Column(db.String(255), nullable=False)
    co_organizers = db.Column(db.String(500), nullable=True)
    event_type = db.Column(db.String(50), nullable=False)
    event_format = db.Column(db.String(50), nullable=False)
    start_date = db.Column(db.Date, nullable=False)
    end_date = db.Column(db.Date, nullable=False)
    country_id = db.Column(
        db.Integer, db.ForeignKey("countries.id"), nullable=True, index=True
    )
    city_region = db.Column(db.String(255), nullable=False)
    venue_name = db.Column(db.String(255), nullable=False)
    description = db.Column(db.Text, nullable=False)
    attendees = db.Column(db.Integer, nullable=False)
    external_orgs = db.Column(db.String(500), nullable=True)
    expected_outcomes = db.Column(db.Text, nullable=False)
    needs_travel = db.Column(db.Boolean, nullable=False, default=False)
    num_travelers = db.Column(db.Integer, nullable=True)
    transport_method = db.Column(db.String(50), nullable=True)
    origin_city = db.Column(db.String(255), nullable=True)
    origin_country_id = db.Column(
        db.Integer, db.ForeignKey("countries.id"), nullable=True
    )
    destination_city = db.Column(db.String(255), nullable=True)
    destination_country_id = db.Column(
        db.Integer, db.ForeignKey("countries.id"), nullable=True
    )
    estimated_transport_cost = db.Column(db.Numeric(10, 2), nullable=True)
    # JSON array of additional expense type strings (e.g. ["parking", "tolls"])
    additional_travel_expenses = db.Column(db.Text, nullable=True)
    currency = db.Column(db.String(255), nullable=False)
    # JSON array of selected budget category keys
    budget_categories = db.Column(db.Text, nullable=True)
    # JSON object mapping category key → amount string
    budget_amounts = db.Column(db.Text, nullable=True)
    other_expense_amount = db.Column(db.Numeric(10, 2), nullable=True)
    other_expense_explanation = db.Column(db.Text, nullable=True)
    cost_justification = db.Column(db.Text, nullable=False)
    agrees_to_report = db.Column(db.Boolean, nullable=False, default=False)
    attachment_keys = db.Column(db.Text, nullable=True)
    additional_notes = db.Column(db.Text, nullable=True)

    # ── Workflow ─────────────────────────────────────────────────────
    # pending | approved | rejected | withdrawn
    status = db.Column(
        db.String(20), nullable=False, default="pending", server_default="pending"
    )
    submitted_at = db.Column(
        db.DateTime, nullable=False, default=func.now(), server_default=func.now()
    )
    reviewed_by = db.Column(db.String(255), nullable=True)
    reviewed_at = db.Column(db.DateTime, nullable=True)
    reviewer_note = db.Column(db.Text, nullable=True)

    user = db.relationship(
        "User",
        backref=db.backref("event_proposals", passive_deletes=True),
    )

    __table_args__ = (
        db.Index("ix_event_proposals_org_status", "org_id", "status"),
        db.Index("ix_event_proposals_user_submitted", "user_id", "submitted_at"),
    )

    def __repr__(self):
        return (
            f"<EventProposal {self.id} user={self.user_id} "
            f"title={self.title!r} status={self.status}>"
        )
