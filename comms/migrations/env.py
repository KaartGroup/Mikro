"""Alembic environment for the Kaart Comms service.

Comms is a self-contained Flask app with its OWN database and its OWN
migration chain (rooted here, NOT chained off Mikro's backend/migrations/).

This env builds the comms app, pushes an app context, and points Alembic at
the comms SQLAlchemy metadata. The DB URL is resolved at runtime from the
COMMS_DATABASE_URL env var, falling back to the app's configured
SQLALCHEMY_DATABASE_URI — never hardcoded in alembic.ini.
"""

import os
import sys
from logging.config import fileConfig

from alembic import context

# Make the repo root importable so `import comms` works regardless of CWD.
_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

from comms import create_app  # noqa: E402
from comms.extensions import db  # noqa: E402

# Alembic Config object, providing access to values within alembic.ini.
config = context.config

# Set up loggers from the ini file (if present).
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Build the app + push a context so models register on db.metadata.
app = create_app()
app.app_context().push()

target_metadata = db.metadata


def _database_url() -> str:
    """COMMS_DATABASE_URL wins; otherwise the app's configured URI."""
    return os.environ.get("COMMS_DATABASE_URL") or app.config["SQLALCHEMY_DATABASE_URI"]


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode (emit SQL, no DB connection)."""
    context.configure(
        url=_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode (against a live connection)."""
    from sqlalchemy import engine_from_config, pool

    section = config.get_section(config.config_ini_section) or {}
    section["sqlalchemy.url"] = _database_url()

    connectable = engine_from_config(
        section,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            # batch mode keeps ALTERs working on SQLite (test DB).
            render_as_batch=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
