"""Fix punks table: replace deleted boolean with deleted_date timestamp.

The original migration incorrectly created a 'deleted' boolean column.
ModelWithSoftDeleteAndCRUD expects 'deleted_date' (DateTime, nullable).

Revision ID: l2a3b4c5d6e7
Revises: k1f2a3b4c5d6
"""
from alembic import op
import sqlalchemy as sa

revision = "l2a3b4c5d6e7"
down_revision = "k1f2a3b4c5d6"
branch_labels = None
depends_on = None


def upgrade():
    # Drop the wrong column if it exists. ``IF EXISTS`` keeps the
    # statement safe on fresh DBs where the broken column never
    # landed (e.g. local dev) — try/except can't recover because
    # PG aborts the whole tx on a failed DDL.
    op.execute('ALTER TABLE punks DROP COLUMN IF EXISTS deleted')
    # Add the correct column (no-op if a previous run already added it)
    op.execute(
        'ALTER TABLE punks ADD COLUMN IF NOT EXISTS deleted_date '
        'TIMESTAMP WITHOUT TIME ZONE'
    )


def downgrade():
    op.drop_column("punks", "deleted_date")
