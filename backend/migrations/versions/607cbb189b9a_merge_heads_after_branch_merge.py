"""merge heads after branch merge

Revision ID: 607cbb189b9a
Revises: b5c6d7e8f9a0, f8e1d2c3b4a5
Create Date: 2026-06-05 10:37:48.392623

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '607cbb189b9a'
down_revision = ('b5c6d7e8f9a0', 'f8e1d2c3b4a5')
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
