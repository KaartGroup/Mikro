"""
Tests for the MapRoulette / Tasking Manager source filter.

These compile the query rather than executing it, so they need no database --
only that a URI is configured, which importing ``app`` already arranges.

The behaviour worth pinning down is the "tm4" branch: it must match
``source != 'mr'`` rather than ``source == 'tm4'``, because the column carries
a server_default of "tm4" that older rows predate. An equality test would
silently hide them from the filter.
"""

import pytest

from app import app as flask_app
from api.database import Project
from api.services.project_service import ProjectService


def _where(source):
    """Return just the WHERE clause of the filtered query, as SQL text.

    The SELECT list names every column (``projects.source`` included), so
    assertions have to look at the predicate alone.
    """
    with flask_app.app_context():
        query = ProjectService.get_project_by_source(Project.query, source)
        sql = str(query.statement.compile(compile_kwargs={"literal_binds": True}))
    _, _, where = sql.partition("WHERE")
    return where


def test_mr_narrows_to_maproulette():
    assert "projects.source = 'mr'" in _where("mr")


def test_tm4_matches_anything_that_is_not_mr():
    """Not source == 'tm4' -- rows predating the column default must match."""
    where = _where("tm4")
    assert "projects.source != 'mr'" in where
    assert "projects.source = 'tm4'" not in where


@pytest.mark.parametrize("source", [None, "", "TM4", "maproulette", "bogus"])
def test_unknown_values_add_no_source_predicate(source):
    """An unrecognised source must not narrow the query at all."""
    assert "projects.source" not in _where(source)


def test_the_two_sources_are_complementary():
    """Between them, mr and tm4 must cover every row exactly once."""
    assert "projects.source = 'mr'" in _where("mr")
    assert "projects.source != 'mr'" in _where("tm4")
