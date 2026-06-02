"""
Shared pytest fixtures.

Requires a local PostgreSQL database named mikro_test (or set TESTING_DB).
Create it once with: createdb mikro_test

Tables are created at the start of the test session and dropped at the end.
Each test gets its own app context whose session is rolled back on teardown,
so no data leaks between tests.
"""

import os
import pytest
from app import create_app
from api.config import TestingConfig
from api.database import db as _db, User

USER_ID = "auth0|timekeeping-test"
OTHER_USER_ID = "auth0|other-timekeeping-test"
ORG = "test-org"


def _test_db_url():
    pg_user = os.getenv("POSTGRES_USER", "postgres")
    pg_password = os.getenv("POSTGRES_PASSWORD", "")
    pg_host = os.getenv("POSTGRES_ENDPOINT", "localhost")
    pg_port = os.getenv("POSTGRES_PORT", "5432")
    pg_db = os.getenv("TESTING_DB", "mikro_test")
    if pg_password:
        return f"postgresql://{pg_user}:{pg_password}@{pg_host}:{pg_port}/{pg_db}"
    return f"postgresql://{pg_user}@{pg_host}:{pg_port}/{pg_db}"


class _PostgresTestConfig(TestingConfig):
    """Overrides the SQLite URI from TestingConfig with the real test PostgreSQL DB.

    Inheriting from TestingConfig (rather than DevelopmentConfig) guarantees
    SQLALCHEMY_DATABASE_URI is a plain string attribute — not the @property
    defined on BaseConfig — so the value is locked in before db.init_app()
    runs inside create_app() and cannot be shadowed by the property later.
    """
    SQLALCHEMY_DATABASE_URI = _test_db_url()


@pytest.fixture(scope="session")
def app():
    url = _PostgresTestConfig.SQLALCHEMY_DATABASE_URI
    # Hard stop if the URL doesn't look like a test DB. This prevents
    # create_all from ever running against a dev or prod database.
    assert "test" in url, (
        f"Refusing to run against {url!r}. "
        "Set TESTING_DB to a database whose name contains 'test'."
    )
    _app = create_app(_PostgresTestConfig)
    with _app.app_context():
        _db.create_all()
    yield _app
    # No drop_all here — too dangerous if the URL ever points at the wrong DB.
    # Per-test isolation is handled by db_session rollback.
    # To fully reset: dropdb mikro_test && createdb mikro_test


@pytest.fixture
def db_session(app):
    """
    Opens a fresh app context per test.  Two fixture users are flushed so
    TimeEntry FK constraints are satisfied.  Everything is rolled back on exit.
    """
    with app.app_context():
        for uid, email in [
            (USER_ID, "test@mikro.test"),
            (OTHER_USER_ID, "other@mikro.test"),
        ]:
            _db.session.add(User(id=uid, email=email))
        _db.session.flush()
        yield _db.session
        _db.session.rollback()
