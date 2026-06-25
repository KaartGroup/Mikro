"""add geo_layers and geo_features tables

Revision ID: 57676a0783da
Revises: a2d5f8b3c6e1
Create Date: 2026-06-24 10:20:05.579321

"""
from alembic import op
import sqlalchemy as sa
from geoalchemy2 import Geometry
from sqlalchemy.dialects.postgresql import JSONB


# revision identifiers, used by Alembic.
revision = '57676a0783da'
down_revision = 'a2d5f8b3c6e1'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    from sqlalchemy import inspect
    inspector = inspect(bind)
    existing = inspector.get_table_names()

    if 'geo_layers' not in existing:
        op.create_table('geo_layers',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('deleted_date', sa.DateTime(), nullable=True),
            sa.Column('name', sa.String(length=255), nullable=False),
            sa.Column('org_id', sa.String(length=255), nullable=True),
            sa.Column('created_by', sa.String(length=255), nullable=True),
            sa.Column('feature_count', sa.Integer(), server_default='0', nullable=False),
            sa.Column('create_time', sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('name', 'org_id', name='uq_geo_layers_name_org'),
        )
        op.create_index('ix_geo_layers_org_id', 'geo_layers', ['org_id'])

    if 'geo_features' not in existing:
        op.create_table('geo_features',
            sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column('layer_id', sa.Integer(), nullable=False),
            sa.Column('properties', JSONB(), server_default='{}', nullable=False),
            sa.Column('geom', Geometry('GEOMETRY', srid=4326), nullable=False),
            sa.ForeignKeyConstraint(['layer_id'], ['geo_layers.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_geo_features_geom', 'geo_features', ['geom'], postgresql_using='gist')
        op.create_index('ix_geo_features_layer_id', 'geo_features', ['layer_id'])


def downgrade():
    op.drop_table('geo_features')
    op.drop_table('geo_layers')
