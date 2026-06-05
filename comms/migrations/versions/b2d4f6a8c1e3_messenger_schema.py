"""messenger schema

Adds the two messenger tables — messages and message_reads — chained off the
initial comms schema. App-agnostic: no foreign keys, targeting is by opaque
group_key string the calling app defines.

Revision ID: b2d4f6a8c1e3
Revises: c0115ec7100
Create Date: 2026-06-04

"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "b2d4f6a8c1e3"
down_revision = "c0115ec7100"
branch_labels = None
depends_on = None


def upgrade():
    # ── messages ──────────────────────────────────────────────────
    op.create_table(
        "messages",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("org_id", sa.String(length=255), nullable=False),
        sa.Column("sender_id", sa.String(length=255), nullable=False),
        sa.Column("target_type", sa.String(length=10), nullable=False),
        sa.Column("target_user_id", sa.String(length=255), nullable=True),
        sa.Column("target_group_key", sa.String(length=100), nullable=True),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_messages_org_id"), "messages", ["org_id"], unique=False)
    op.create_index(
        op.f("ix_messages_sender_id"), "messages", ["sender_id"], unique=False
    )
    op.create_index(
        op.f("ix_messages_target_user_id"),
        "messages",
        ["target_user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_messages_target_group_key"),
        "messages",
        ["target_group_key"],
        unique=False,
    )
    op.create_index(
        op.f("ix_messages_created_at"),
        "messages",
        ["created_at"],
        unique=False,
    )

    # ── message_reads ─────────────────────────────────────────────
    op.create_table(
        "message_reads",
        sa.Column("user_id", sa.String(length=255), nullable=False),
        sa.Column("scope_type", sa.String(length=10), nullable=False),
        sa.Column("scope_key", sa.String(length=100), nullable=False),
        sa.Column(
            "last_read_at",
            sa.DateTime(),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("user_id", "scope_type", "scope_key"),
    )


def downgrade():
    op.drop_table("message_reads")

    op.drop_index(op.f("ix_messages_created_at"), table_name="messages")
    op.drop_index(op.f("ix_messages_target_group_key"), table_name="messages")
    op.drop_index(op.f("ix_messages_target_user_id"), table_name="messages")
    op.drop_index(op.f("ix_messages_sender_id"), table_name="messages")
    op.drop_index(op.f("ix_messages_org_id"), table_name="messages")
    op.drop_table("messages")
