"""drop users.monthly_salary column

Revision ID: c6d7e8f9a0b1
Revises: b5c6d7e8f9a0
Create Date: 2026-06-05 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'c6d7e8f9a0b1'
down_revision = '607cbb189b9a'
branch_labels = None
depends_on = None


def upgrade():
    # Remap legacy values that are no longer in VALID_COMP_MODELS. NULL lets
    # effective_comp_model fall back to the rate-based heuristic (hourly if a
    # rate exists, otherwise per_task), which is the correct behavior for these
    # users after the salaried/hybrid models are removed.
    op.execute(
        "UPDATE users SET compensation_model = NULL "
        "WHERE compensation_model IN ('salaried', 'hybrid')"
    )
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_column('monthly_salary')


def downgrade():
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('monthly_salary', sa.Numeric(10, 2), nullable=True))
