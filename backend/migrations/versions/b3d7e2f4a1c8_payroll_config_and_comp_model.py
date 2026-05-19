"""Payroll cadence config + per-user compensation model.

Revision ID: b3d7e2f4a1c8
Revises: d8e9f0a1b2c3
Create Date: 2026-05-18

Additive only. Two pieces:

- ``payroll_config`` — per-org payroll cadence (monthly / semi_monthly /
  bi_weekly) + anchor. One row per org_id. Org-admin configures it from
  the payments page; the cycle picker uses it for default/preset periods
  while custom ranges remain allowed. Fail-open: no row → monthly/day-1.

- ``users.compensation_model`` (nullable) — per_task | hourly | salaried
  | project_based | hybrid. NULL = legacy/unspecified → behaves exactly
  as today (per-task core + optional hourly_rate). Existing rows
  untouched; no backfill.

- ``users.monthly_salary`` (nullable) — salaried base; prorated to the
  cycle by the payments computation.

No changes to existing tables beyond the two additive User columns.
Chain-checked 2026-05-18: down_revision = current single head
d8e9f0a1b2c3; revision b3d7e2f4a1c8 verified absent from all 40 existing
revision ids.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector


# revision identifiers, used by Alembic.
revision = "b3d7e2f4a1c8"
down_revision = "d8e9f0a1b2c3"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)

    existing_tables = set(inspector.get_table_names())
    if "payroll_config" not in existing_tables:
        op.create_table(
            "payroll_config",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("org_id", sa.String(length=255), nullable=False),
            sa.Column(
                "cadence",
                sa.String(length=20),
                nullable=False,
                server_default="monthly",
            ),  # monthly | semi_monthly | bi_weekly
            sa.Column("anchor_day", sa.Integer(), nullable=True),  # monthly day-of-month
            sa.Column("anchor_date", sa.Date(), nullable=True),  # bi_weekly origin
            sa.Column("timezone", sa.String(length=50), nullable=True),
            sa.Column("updated_by", sa.String(length=255), nullable=True),
            sa.Column(
                "updated_at",
                sa.DateTime(),
                nullable=False,
                server_default=sa.func.now(),
            ),
        )
        op.create_index(
            "ix_payroll_config_org_id",
            "payroll_config",
            ["org_id"],
            unique=True,
        )

    user_cols = {c["name"] for c in inspector.get_columns("users")}
    if "compensation_model" not in user_cols:
        op.add_column(
            "users",
            sa.Column("compensation_model", sa.String(length=20), nullable=True),
        )
    if "monthly_salary" not in user_cols:
        op.add_column(
            "users",
            sa.Column("monthly_salary", sa.Numeric(10, 2), nullable=True),
        )


def downgrade():
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)

    user_cols = {c["name"] for c in inspector.get_columns("users")}
    if "monthly_salary" in user_cols:
        op.drop_column("users", "monthly_salary")
    if "compensation_model" in user_cols:
        op.drop_column("users", "compensation_model")

    existing_tables = set(inspector.get_table_names())
    if "payroll_config" in existing_tables:
        op.drop_index("ix_payroll_config_org_id", table_name="payroll_config")
        op.drop_table("payroll_config")
