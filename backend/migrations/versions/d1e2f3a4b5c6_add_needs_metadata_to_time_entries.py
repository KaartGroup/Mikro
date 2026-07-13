"""Add needs_metadata flag to time_entries + make activity nullable.

Revision ID: d1e2f3a4b5c6
Revises: 57676a0783da
Create Date: 2026-07-13

Supports the "Switch Task — deferred metadata" workflow: a session may now
START without a category (tier-1 ``activity``) and be finalized later. Such a
session carries ``needs_metadata=True`` and ``activity IS NULL`` while running;
the metadata gate on the frontend forces the category (and a project when the
chosen activity/subcategory requires one) before the session is closed or the
user switches again.

Two changes, both metadata-only / fast on Postgres 11+ (no table rewrite):
  - add ``needs_metadata BOOLEAN NOT NULL DEFAULT FALSE`` (constant default)
  - drop the NOT NULL constraint on ``activity`` so a pending session can
    exist with a NULL category.

Reporting is unaffected: every aggregation/history read is completed-only
(see queries.py STATUS_SET), so an ``active`` + ``needs_metadata`` row with a
NULL activity never reaches a GROUP BY activity.
"""

from alembic import op
import sqlalchemy as sa

revision = "d1e2f3a4b5c6"
down_revision = "57676a0783da"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("time_entries", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "needs_metadata",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )
        batch_op.alter_column(
            "activity",
            existing_type=sa.String(length=50),
            nullable=True,
        )


def downgrade():
    # Backfill so the NOT NULL restore can't fail on any pending rows that
    # were still metadata-less at downgrade time.
    op.execute("UPDATE time_entries SET activity = 'other' " "WHERE activity IS NULL")
    with op.batch_alter_table("time_entries", schema=None) as batch_op:
        batch_op.alter_column(
            "activity",
            existing_type=sa.String(length=50),
            nullable=False,
        )
        batch_op.drop_column("needs_metadata")
