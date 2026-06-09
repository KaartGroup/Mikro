"""Require project priority: backfill NULLs to Medium, then set NOT NULL.

Revision ID: a7f8a9b0c1d2
Revises: z6e7f8a9b0c1
Create Date: 2026-06-09

"""
from alembic import op
import sqlalchemy as sa

revision = "a7f8a9b0c1d2"
down_revision = ("z6e7f8a9b0c1", "g1a2b3c4d5e6")
branch_labels = None
depends_on = None


def upgrade():
    op.execute("UPDATE projects SET priority = 'Medium' WHERE priority IS NULL")
    op.alter_column(
        "projects",
        "priority",
        existing_type=sa.String(50),
        nullable=False,
        server_default="Medium",
    )


def downgrade():
    op.alter_column(
        "projects",
        "priority",
        existing_type=sa.String(50),
        nullable=True,
        server_default=None,
    )
