"""Add pending_invites table for team-targeted Auth0 invitations.

Revision ID: ac9d0e1f2b3c
Revises: ab8c9d0e1f2a
Create Date: 2026-05-08

When a team_admin (or org admin) invites a user with a specific
target team, a row is written here. On the new user's first login,
the matching TeamUser association is created and the row is marked
consumed via `consumed_at`.

Additive — no destructive changes. Safe to upgrade live, but per
project policy this still rolls during the off-hours window.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "ac9d0e1f2b3c"
down_revision = "ab8c9d0e1f2a"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "pending_invites",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("org_id", sa.String(length=255), nullable=False),
        sa.Column(
            "target_team_id",
            sa.Integer(),
            sa.ForeignKey("teams.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("invited_by_user_id", sa.String(length=255), nullable=True),
        sa.Column("auth0_invitation_id", sa.String(length=255), nullable=True),
        sa.Column("consumed_at", sa.DateTime(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_pending_invites_email",
        "pending_invites",
        ["email"],
    )
    op.create_index(
        "ix_pending_invites_org_id",
        "pending_invites",
        ["org_id"],
    )
    op.create_index(
        "ix_pending_invites_target_team_id",
        "pending_invites",
        ["target_team_id"],
    )
    op.create_index(
        "ix_pending_invites_auth0_invitation_id",
        "pending_invites",
        ["auth0_invitation_id"],
    )


def downgrade():
    op.drop_index("ix_pending_invites_auth0_invitation_id", table_name="pending_invites")
    op.drop_index("ix_pending_invites_target_team_id", table_name="pending_invites")
    op.drop_index("ix_pending_invites_org_id", table_name="pending_invites")
    op.drop_index("ix_pending_invites_email", table_name="pending_invites")
    op.drop_table("pending_invites")
