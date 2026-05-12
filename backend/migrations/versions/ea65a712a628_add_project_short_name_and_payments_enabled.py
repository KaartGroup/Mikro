"""Add short_name and payments_enabled to projects.

Revision ID: ea65a712a628
Revises: 9768b4bdbd62
Create Date: 2026-05-12

These two columns landed on prod before the file existed in the repo:
prod's ``alembic_version`` was stamped to ``ea65a712a628`` but the
companion migration file never made it to git. The columns ARE in the
Project model (``core.py``) — they were just unbacked by a tracked
migration until now.

Re-creating the file under the same revision restores chain integrity
without manual stamping. upgrade() is idempotent so it's a no-op on
prod (where the columns already exist) and works first-try on fresh
dev DBs.

Additive only — no destructive change to existing data.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector


# revision identifiers, used by Alembic.
revision = "ea65a712a628"
down_revision = "9768b4bdbd62"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)
    existing = {c["name"] for c in inspector.get_columns("projects")}

    if "short_name" not in existing:
        op.add_column(
            "projects",
            sa.Column("short_name", sa.String(length=100), nullable=True),
        )

    if "payments_enabled" not in existing:
        op.add_column(
            "projects",
            sa.Column(
                "payments_enabled",
                sa.Boolean(),
                nullable=False,
                server_default=sa.true(),
            ),
        )


def downgrade():
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)
    existing = {c["name"] for c in inspector.get_columns("projects")}

    if "payments_enabled" in existing:
        op.drop_column("projects", "payments_enabled")
    if "short_name" in existing:
        op.drop_column("projects", "short_name")
