"""Add project_proposals table for the project proposal & provisioning queue.

Revision ID: a2d5f8b3c6e1
Revises: a1c4e7b09d2f
Create Date: 2026-06-23

Users submit project proposals (with or without a TM4/MR link) into a review
queue.  Admins approve, defer, request changes, or deny.  Approved proposals
with a link are provisioned automatically; approved proposals without a link
enter an intermediate "approved" state until an admin supplies a URL via the
separate Provision action.
"""
from alembic import op
import sqlalchemy as sa

revision = "a2d5f8b3c6e1"
down_revision = "a1c4e7b09d2f"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "project_proposals",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "user_id",
            sa.String(255),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("org_id", sa.String(255), nullable=True, index=True),
        # Optional TM4 / MapRoulette link — null when requester describes an
        # area that still needs to be set up in TM4/MR before provisioning.
        sa.Column("url", sa.String(500), nullable=True),
        # 'tm4' | 'mr' derived from url at submission; null when no url.
        sa.Column("source", sa.String(20), nullable=True),
        sa.Column("proposed_name", sa.String(255), nullable=True),
        sa.Column("short_name", sa.String(100), nullable=True),
        # Required when no url — captures area description + justification.
        sa.Column("area_description", sa.Text, nullable=True),
        sa.Column("mapping_rate", sa.Float, nullable=True),
        sa.Column("validation_rate", sa.Float, nullable=True),
        # Visibility default True; community / payments_enabled default False.
        sa.Column(
            "visibility",
            sa.Boolean,
            nullable=False,
            server_default=sa.true(),
        ),
        sa.Column(
            "community",
            sa.Boolean,
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column(
            "payments_enabled",
            sa.Boolean,
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column("priority", sa.String(50), nullable=False, server_default="Medium"),
        # pending | changes_requested | deferred | denied | approved | provisioned | withdrawn
        sa.Column(
            "status",
            sa.String(20),
            nullable=False,
            server_default="pending",
        ),
        sa.Column(
            "submitted_at",
            sa.DateTime,
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("reviewed_by", sa.String(255), nullable=True),
        sa.Column("reviewed_at", sa.DateTime, nullable=True),
        sa.Column("reviewer_note", sa.Text, nullable=True),
        # Set to the created Project.id once provisioned.
        sa.Column("created_project_id", sa.Integer, nullable=True),
    )
    op.create_index(
        "ix_project_proposals_org_status",
        "project_proposals",
        ["org_id", "status"],
    )
    op.create_index(
        "ix_project_proposals_user_submitted",
        "project_proposals",
        ["user_id", "submitted_at"],
    )


def downgrade():
    op.drop_index("ix_project_proposals_user_submitted", table_name="project_proposals")
    op.drop_index("ix_project_proposals_org_status", table_name="project_proposals")
    op.drop_table("project_proposals")
