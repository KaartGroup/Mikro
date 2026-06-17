"""Add long-session-alert review columns to time_entries.

Revision ID: a7b1c2d3e4f5
Revises: 43760543fd98
Create Date: 2026-06-17

Lets an admin dismiss ("mark as reviewed") a long-running session from
the dashboard/admin-time queue without touching the underlying time
data. ``long_session_reviewed_at`` being non-NULL hides the entry from
the long_sessions endpoint; ``long_session_reviewed_by`` records who
dismissed it for the audit trail.
"""

from alembic import op
import sqlalchemy as sa

revision = "a7b1c2d3e4f5"
down_revision = "43760543fd98"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("time_entries", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("long_session_reviewed_by", sa.String(length=255), nullable=True)
        )
        batch_op.add_column(
            sa.Column("long_session_reviewed_at", sa.DateTime(), nullable=True)
        )


def downgrade():
    with op.batch_alter_table("time_entries", schema=None) as batch_op:
        batch_op.drop_column("long_session_reviewed_at")
        batch_op.drop_column("long_session_reviewed_by")
