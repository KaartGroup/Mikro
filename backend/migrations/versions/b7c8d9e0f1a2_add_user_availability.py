"""Add user_availability and user_availability_exceptions tables.

Revision ID: b7c8d9e0f1a2
Revises: e2f3a4b5c6d7
Create Date: 2026-08-20

Phase 1 of the scheduling & availability feature. Each user declares recurring
weekly working hours; date-specific exceptions override them (PTO, travel, an
unusual Saturday).

Times are stored as LOCAL WALL-CLOCK — day_of_week plus minute offsets from
local midnight — and interpreted in the user's own ``users.timezone``. They are
deliberately NOT UTC instants: "09:00-17:00" must remain 09:00-17:00 across DST
transitions.

Additive only — no existing table is altered.
"""

from alembic import op
import sqlalchemy as sa

revision = "b7c8d9e0f1a2"
down_revision = "e2f3a4b5c6d7"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "user_availability",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "user_id",
            sa.String(255),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("org_id", sa.String(255), nullable=True, index=True),
        # 0 = Monday … 6 = Sunday (matches datetime.weekday()).
        sa.Column("day_of_week", sa.SmallInteger, nullable=False),
        # Minutes from local midnight; 0 <= start < end <= 1440.
        sa.Column("start_minute", sa.SmallInteger, nullable=False),
        sa.Column("end_minute", sa.SmallInteger, nullable=False),
        # 'available' | 'preferred'
        sa.Column("kind", sa.String(20), nullable=False, server_default="available"),
        sa.Column(
            "created_at", sa.DateTime, nullable=False, server_default=sa.func.now()
        ),
        sa.Column("updated_at", sa.DateTime, nullable=True),
        sa.CheckConstraint(
            "day_of_week >= 0 AND day_of_week <= 6",
            name="ck_user_availability_day_of_week",
        ),
        sa.CheckConstraint(
            "start_minute >= 0 AND end_minute <= 1440 AND start_minute < end_minute",
            name="ck_user_availability_minutes",
        ),
    )
    op.create_index(
        "ix_user_availability_user_day",
        "user_availability",
        ["user_id", "day_of_week"],
    )

    op.create_table(
        "user_availability_exceptions",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "user_id",
            sa.String(255),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("org_id", sa.String(255), nullable=True, index=True),
        sa.Column("date", sa.Date, nullable=False),
        # 'unavailable' | 'available'
        sa.Column("kind", sa.String(20), nullable=False),
        # NULL/NULL = the entire day.
        sa.Column("start_minute", sa.SmallInteger, nullable=True),
        sa.Column("end_minute", sa.SmallInteger, nullable=True),
        sa.Column("note", sa.String(255), nullable=True),
        sa.Column(
            "created_at", sa.DateTime, nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            "(start_minute IS NULL AND end_minute IS NULL) OR "
            "(start_minute >= 0 AND end_minute <= 1440 AND start_minute < end_minute)",
            name="ck_user_availability_exc_minutes",
        ),
    )
    op.create_index(
        "ix_user_availability_exc_user_date",
        "user_availability_exceptions",
        ["user_id", "date"],
    )
    op.create_index(
        "ix_user_availability_exc_org_date",
        "user_availability_exceptions",
        ["org_id", "date"],
    )


def downgrade():
    op.drop_index(
        "ix_user_availability_exc_org_date",
        table_name="user_availability_exceptions",
    )
    op.drop_index(
        "ix_user_availability_exc_user_date",
        table_name="user_availability_exceptions",
    )
    op.drop_table("user_availability_exceptions")
    op.drop_index("ix_user_availability_user_day", table_name="user_availability")
    op.drop_table("user_availability")
