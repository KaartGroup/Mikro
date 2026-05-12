"""Payments page v1 — overtime cols on users + payment_adjustments + payment_cycle_status.

Revision ID: d8e9f0a1b2c3
Revises: ea65a712a628
Create Date: 2026-05-12

Additive only. Backs the Mona-Kea-end-of-month payments cutover (Trello
DWAbQFlL). Logan's MVP needs:

- ``users.overtime_rate`` and ``users.overtime_threshold_hours`` —
  placeholder columns so we don't have to migrate again when overtime
  comes into play. Both nullable; threshold defaults to 40 (US standard)
  when populated.

- ``payment_adjustments`` — admin-entered or request-approved per-user
  per-cycle adjustments (reimbursements, corrections). Audited via
  ``added_by`` + ``created_at``.

- ``payment_cycle_status`` — per-user × per-cycle status (pending /
  approved / held / paid). Unique constraint on (user, cycle range)
  enforces one row per cycle.

No changes to existing tables beyond the two additive User columns.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "d8e9f0a1b2c3"
down_revision = "ea65a712a628"
branch_labels = None
depends_on = None


def upgrade():
    # 1. Overtime placeholder columns on users
    op.add_column(
        "users",
        sa.Column("overtime_rate", sa.Numeric(10, 2), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column(
            "overtime_threshold_hours",
            sa.Integer(),
            nullable=True,
            server_default=None,
        ),
    )

    # 2. payment_adjustments — admin-entered or request-approved
    op.create_table(
        "payment_adjustments",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column(
            "user_id",
            sa.String(length=255),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("cycle_start", sa.Date(), nullable=False),
        sa.Column("cycle_end", sa.Date(), nullable=False),
        sa.Column("amount", sa.Numeric(10, 2), nullable=False),
        sa.Column(
            "type",
            sa.String(length=50),
            nullable=False,
            server_default="reimbursement",
        ),  # "reimbursement" | "correction" | "other"
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "source",
            sa.String(length=50),
            nullable=False,
            server_default="admin_entry",
        ),  # "admin_entry" | "approved_request"
        sa.Column("request_id", sa.Integer(), nullable=True),
        sa.Column("added_by", sa.String(length=255), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "is_deleted",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.Column("deleted_by", sa.String(length=255), nullable=True),
    )
    op.create_index(
        "ix_payment_adjustments_user_id", "payment_adjustments", ["user_id"]
    )
    op.create_index(
        "ix_payment_adjustments_cycle_start",
        "payment_adjustments",
        ["cycle_start"],
    )
    op.create_index(
        "ix_payment_adjustments_cycle_end",
        "payment_adjustments",
        ["cycle_end"],
    )
    op.create_index(
        "ix_payment_adjustments_user_cycle",
        "payment_adjustments",
        ["user_id", "cycle_start", "cycle_end"],
    )

    # 3. payment_cycle_status — per-user × per-cycle status
    op.create_table(
        "payment_cycle_status",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column(
            "user_id",
            sa.String(length=255),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("cycle_start", sa.Date(), nullable=False),
        sa.Column("cycle_end", sa.Date(), nullable=False),
        sa.Column(
            "status",
            sa.String(length=20),
            nullable=False,
            server_default="pending",
        ),  # "pending" | "approved" | "held" | "paid"
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("actor_id", sa.String(length=255), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "user_id",
            "cycle_start",
            "cycle_end",
            name="uq_payment_cycle_status_user_cycle",
        ),
    )
    op.create_index(
        "ix_payment_cycle_status_user_id", "payment_cycle_status", ["user_id"]
    )
    op.create_index(
        "ix_payment_cycle_status_cycle_start",
        "payment_cycle_status",
        ["cycle_start"],
    )
    op.create_index(
        "ix_payment_cycle_status_cycle_end",
        "payment_cycle_status",
        ["cycle_end"],
    )


def downgrade():
    op.drop_index(
        "ix_payment_cycle_status_cycle_end", table_name="payment_cycle_status"
    )
    op.drop_index(
        "ix_payment_cycle_status_cycle_start",
        table_name="payment_cycle_status",
    )
    op.drop_index(
        "ix_payment_cycle_status_user_id", table_name="payment_cycle_status"
    )
    op.drop_table("payment_cycle_status")

    op.drop_index(
        "ix_payment_adjustments_user_cycle", table_name="payment_adjustments"
    )
    op.drop_index(
        "ix_payment_adjustments_cycle_end", table_name="payment_adjustments"
    )
    op.drop_index(
        "ix_payment_adjustments_cycle_start", table_name="payment_adjustments"
    )
    op.drop_index(
        "ix_payment_adjustments_user_id", table_name="payment_adjustments"
    )
    op.drop_table("payment_adjustments")

    op.drop_column("users", "overtime_threshold_hours")
    op.drop_column("users", "overtime_rate")
