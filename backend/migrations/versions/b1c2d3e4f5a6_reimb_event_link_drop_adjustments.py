"""Link reimbursements to event proposals, drop payment_adjustments.

Revision ID: b1c2d3e4f5a6
Revises: 7ae012f39e40
Create Date: 2026-06-11

Changes:
  - reimbursement_requests: drop adjustment_id FK + column
  - reimbursement_requests: add event_proposal_id FK (nullable)
  - payment_adjustments table: dropped entirely
"""

from alembic import op
import sqlalchemy as sa

revision = 'b1c2d3e4f5a6'
down_revision = '7ae012f39e40'
branch_labels = None
depends_on = None


def upgrade():
    # 1. Remove adjustment_id FK constraint + index + column.
    op.drop_constraint(
        'reimbursement_requests_adjustment_id_fkey',
        'reimbursement_requests',
        type_='foreignkey',
    )
    op.drop_index('ix_reimbursement_requests_adjustment_id',
                  table_name='reimbursement_requests')
    op.drop_column('reimbursement_requests', 'adjustment_id')

    # 2. Add event_proposal_id FK (nullable — existing rows are preserved).
    op.add_column(
        'reimbursement_requests',
        sa.Column('event_proposal_id', sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        'fk_reimbursement_requests_event_proposal_id',
        'reimbursement_requests',
        'event_proposals',
        ['event_proposal_id'], ['id'],
        ondelete='SET NULL',
    )
    op.create_index(
        'ix_reimbursement_requests_event_proposal_id',
        'reimbursement_requests',
        ['event_proposal_id'],
    )

    # 3. Drop payment_adjustments (all data discarded).
    op.drop_table('payment_adjustments')


def downgrade():
    # Recreate payment_adjustments.
    op.create_table(
        'payment_adjustments',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.String(length=255), nullable=False),
        sa.Column('cycle_start', sa.Date(), nullable=False),
        sa.Column('cycle_end', sa.Date(), nullable=False),
        sa.Column('amount', sa.Numeric(10, 2), nullable=False),
        sa.Column('type', sa.String(length=50), server_default='reimbursement', nullable=False),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('source', sa.String(length=50), server_default='admin_entry', nullable=False),
        sa.Column('request_id', sa.Integer(), nullable=True),
        sa.Column('added_by', sa.String(length=255), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('is_deleted', sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column('deleted_at', sa.DateTime(), nullable=True),
        sa.Column('deleted_by', sa.String(length=255), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_payment_adjustments_user_id', 'payment_adjustments', ['user_id'])
    op.create_index('ix_payment_adjustments_cycle_start', 'payment_adjustments', ['cycle_start'])
    op.create_index('ix_payment_adjustments_cycle_end', 'payment_adjustments', ['cycle_end'])

    # Restore adjustment_id on reimbursement_requests.
    op.drop_constraint(
        'fk_reimbursement_requests_event_proposal_id',
        'reimbursement_requests',
        type_='foreignkey',
    )
    op.drop_index('ix_reimbursement_requests_event_proposal_id',
                  table_name='reimbursement_requests')
    op.drop_column('reimbursement_requests', 'event_proposal_id')
    op.add_column(
        'reimbursement_requests',
        sa.Column('adjustment_id', sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        'reimbursement_requests_adjustment_id_fkey',
        'reimbursement_requests',
        'payment_adjustments',
        ['adjustment_id'], ['id'],
        ondelete='SET NULL',
    )
    op.create_index(
        'ix_reimbursement_requests_adjustment_id',
        'reimbursement_requests',
        ['adjustment_id'],
    )
