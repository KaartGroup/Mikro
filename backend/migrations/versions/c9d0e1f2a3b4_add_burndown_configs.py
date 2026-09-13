"""Add burndown_configs table.

Revision ID: c9d0e1f2a3b4
Revises: b7c8d9e0f1a2
Create Date: 2026-09-11

One row per (org_id, priority) tracking the Reports v2 burndown-chart rate
configuration: the trailing-month calculated rate, an optional manual
override, and which of the two is currently applied. Additive only — no
existing table is altered.
"""

from alembic import op
import sqlalchemy as sa

revision = "c9d0e1f2a3b4"
down_revision = "b7c8d9e0f1a2"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "burndown_configs",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("org_id", sa.String(255), nullable=False, index=True),
        # "High" | "Medium" | "Low"
        sa.Column("priority", sa.String(20), nullable=False),
        sa.Column("burndown_start_date", sa.Date, nullable=False),
        sa.Column("starting_task_count", sa.Integer, nullable=False),
        sa.Column("calculated_rate", sa.Float, nullable=True),
        sa.Column("manual_rate", sa.Float, nullable=True),
        # "historical_average" | "manual" | "default"
        sa.Column(
            "applied_rate_source",
            sa.String(20),
            nullable=False,
            server_default="default",
        ),
        sa.Column("last_recalculated_at", sa.DateTime, nullable=True),
        sa.Column("created_by", sa.String(255), nullable=True),
        sa.Column(
            "created_at", sa.DateTime, nullable=False, server_default=sa.func.now()
        ),
        sa.Column("updated_by", sa.String(255), nullable=True),
        sa.Column("updated_at", sa.DateTime, nullable=True),
        sa.UniqueConstraint("org_id", "priority", name="uq_burndown_org_priority"),
    )


def downgrade():
    op.drop_table("burndown_configs")
