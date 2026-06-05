"""drop users.hourly_rate column

Revision ID: b5c6d7e8f9a0
Revises: 04771194b7c0
Create Date: 2026-06-04 17:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'b5c6d7e8f9a0'
down_revision = '04771194b7c0'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_column('hourly_rate')


def downgrade():
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('hourly_rate', sa.Float(), nullable=True))
