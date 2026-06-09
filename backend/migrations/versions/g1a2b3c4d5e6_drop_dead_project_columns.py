"""drop dead project columns: completed, tasks_mapped, tasks_validated, tasks_invalidated, total_validators

Revision ID: g1a2b3c4d5e6
Revises: fa48bec1dfa5
Create Date: 2026-06-09

"""
from alembic import op
import sqlalchemy as sa


revision = 'g1a2b3c4d5e6'
down_revision = 'fa48bec1dfa5'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('projects', schema=None) as batch_op:
        batch_op.drop_column('completed')
        batch_op.drop_column('tasks_mapped')
        batch_op.drop_column('tasks_validated')
        batch_op.drop_column('tasks_invalidated')
        batch_op.drop_column('total_validators')


def downgrade():
    with op.batch_alter_table('projects', schema=None) as batch_op:
        batch_op.add_column(sa.Column('total_validators', sa.BigInteger(), nullable=True))
        batch_op.add_column(sa.Column('tasks_invalidated', sa.BigInteger(), nullable=True))
        batch_op.add_column(sa.Column('tasks_validated', sa.BigInteger(), nullable=True))
        batch_op.add_column(sa.Column('tasks_mapped', sa.BigInteger(), nullable=True))
        batch_op.add_column(sa.Column('completed', sa.Boolean(), server_default='false', nullable=True))
