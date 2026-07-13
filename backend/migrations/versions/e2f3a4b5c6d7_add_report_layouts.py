"""Add report_layouts table (Reports v2 configurable layouts).

Revision ID: e2f3a4b5c6d7
Revises: d1e2f3a4b5c6
Create Date: 2026-07-13

Stores per-team saved layouts for the configurable Reports v2 page. One row
per (org_id, team_id, name); team_id NULL = the org-level default. ``config``
holds the Puck layout JSON; ``version`` allows forward-migrating the config
shape. Additive only — no changes to existing tables.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "e2f3a4b5c6d7"
down_revision = "d1e2f3a4b5c6"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "report_layouts",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("org_id", sa.String(length=255), nullable=False),
        sa.Column("team_id", sa.Integer(), nullable=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("config", JSONB(), server_default="{}", nullable=False),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("created_by", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_by", sa.String(length=255), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["team_id"], ["teams.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "org_id", "team_id", "name", name="uq_report_layout_org_team_name"
        ),
    )
    op.create_index(
        "ix_report_layouts_org_id", "report_layouts", ["org_id"], unique=False
    )
    op.create_index(
        "ix_report_layouts_team_id", "report_layouts", ["team_id"], unique=False
    )


def downgrade():
    op.drop_index("ix_report_layouts_team_id", table_name="report_layouts")
    op.drop_index("ix_report_layouts_org_id", table_name="report_layouts")
    op.drop_table("report_layouts")
