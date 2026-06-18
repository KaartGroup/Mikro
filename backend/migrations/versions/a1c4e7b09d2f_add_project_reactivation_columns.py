"""add project reactivation request columns

Adds the three nullable columns that back the "request reactivation" flow
for archived (soft-deleted) projects:
  - reactivation_requested_at  (DateTime) — null = no pending request
  - reactivation_requested_by  (String)   — Auth0 sub of the requester
  - reactivation_reason        (Text)     — why they want it reactivated

Revision ID: a1c4e7b09d2f
Revises: a7b1c2d3e4f5
Create Date: 2026-06-17
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "a1c4e7b09d2f"
down_revision = "a7b1c2d3e4f5"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "projects",
        sa.Column("reactivation_requested_at", sa.DateTime(), nullable=True),
    )
    op.add_column(
        "projects",
        sa.Column("reactivation_requested_by", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "projects",
        sa.Column("reactivation_reason", sa.Text(), nullable=True),
    )


def downgrade():
    op.drop_column("projects", "reactivation_reason")
    op.drop_column("projects", "reactivation_requested_by")
    op.drop_column("projects", "reactivation_requested_at")
