"""
Integration tests for the server-side projects search / sort / pagination
added to ProjectService (_build_query, get_page, get_status_counts).

Uses the shared db_session fixture (PostgreSQL, rolled back per test).
An org_admin viewer is used throughout so role scoping returns the whole
org and the tests isolate the search/sort/pagination behavior.
"""

from api.database import Project
from api.services.project_service import ProjectService

ORG = "pq-test-org"

svc = ProjectService()


class _User:
    def __init__(self, uid="auth0|pq-admin", role="admin", org_id=ORG):
        self.id = uid
        self.role = role
        self.org_id = org_id


ADMIN = _User()


def _project(pid, **kwargs):
    defaults = dict(
        id=pid,
        url=f"https://example.com/{pid}",
        org_id=ORG,
        status=True,
        source="tm4",
    )
    defaults.update(kwargs)
    return Project(**defaults)


# ── search ────────────────────────────────────────────────────────────────


def test_search_matches_name_case_insensitive(db_session):
    db_session.add_all([
        _project(101, name="Highway Mapping"),
        _project(102, name="Building Audit"),
    ])
    db_session.flush()

    items, total = svc.get_page(ORG, ADMIN, {"search": "highway"})

    assert total == 1
    assert [p.id for p in items] == [101]


def test_search_matches_short_name(db_session):
    db_session.add_all([
        _project(103, name="Project A", short_name="HWY-01"),
        _project(104, name="Project B", short_name="BLD-02"),
    ])
    db_session.flush()

    items, total = svc.get_page(ORG, ADMIN, {"search": "hwy"})

    assert [p.id for p in items] == [103]


def test_search_matches_url(db_session):
    db_session.add_all([
        _project(105, url="https://tasks.kaart.com/projects/55"),
        _project(106, url="https://maproulette.org/browse/99"),
    ])
    db_session.flush()

    items, total = svc.get_page(ORG, ADMIN, {"search": "maproulette"})

    assert [p.id for p in items] == [106]


def test_search_matches_numeric_id(db_session):
    db_session.add_all([_project(12345), _project(67890)])
    db_session.flush()

    items, total = svc.get_page(ORG, ADMIN, {"search": "1234"})

    assert [p.id for p in items] == [12345]


def test_blank_search_is_noop(db_session):
    db_session.add_all([_project(107), _project(108)])
    db_session.flush()

    _, total = svc.get_page(ORG, ADMIN, {"search": "   "})

    assert total == 2


# ── community / priority filters ────────────────────────────────────────────


def test_community_filter(db_session):
    db_session.add_all([
        _project(201, community=True),
        _project(202, community=False),
    ])
    db_session.flush()

    items, total = svc.get_page(ORG, ADMIN, {"community": True})

    assert [p.id for p in items] == [201]


def test_priority_filter(db_session):
    db_session.add_all([
        _project(203, priority="High"),
        _project(204, priority="Low"),
    ])
    db_session.flush()

    items, total = svc.get_page(ORG, ADMIN, {"priority": "High"})

    assert [p.id for p in items] == [203]


def test_search_and_priority_compose(db_session):
    db_session.add_all([
        _project(205, name="Road Survey", priority="High"),
        _project(206, name="Road Audit", priority="Low"),
        _project(207, name="Bridge Survey", priority="High"),
    ])
    db_session.flush()

    items, total = svc.get_page(
        ORG, ADMIN, {"search": "road", "priority": "High"}
    )

    assert total == 1
    assert [p.id for p in items] == [205]


# ── sorting ─────────────────────────────────────────────────────────────────


def test_sort_by_name_uses_short_name_then_name(db_session):
    db_session.add_all([
        _project(301, name="Zeta", short_name="Alpha"),
        _project(302, name="Beta", short_name=None),
    ])
    db_session.flush()

    items, _ = svc.get_page(ORG, ADMIN, {}, sort_key="name", sort_dir="asc")

    # "Alpha" (short_name of 301) sorts before "Beta" (name of 302).
    assert [p.id for p in items] == [301, 302]


def test_sort_by_total_tasks_desc(db_session):
    db_session.add_all([
        _project(303, total_tasks=10),
        _project(304, total_tasks=99),
        _project(305, total_tasks=50),
    ])
    db_session.flush()

    items, _ = svc.get_page(
        ORG, ADMIN, {}, sort_key="total_tasks", sort_dir="desc"
    )

    assert [p.id for p in items] == [304, 305, 303]


def test_sort_by_difficulty_custom_order(db_session):
    db_session.add_all([
        _project(306, difficulty="Hard"),
        _project(307, difficulty="Easy"),
        _project(308, difficulty="Medium"),
    ])
    db_session.flush()

    items, _ = svc.get_page(
        ORG, ADMIN, {}, sort_key="difficulty", sort_dir="asc"
    )

    assert [p.id for p in items] == [307, 308, 306]


def test_sort_tiebreaker_is_stable_by_id(db_session):
    # Same total_tasks → id tiebreaker (asc) keeps a deterministic order.
    db_session.add_all([
        _project(311, total_tasks=5),
        _project(309, total_tasks=5),
        _project(310, total_tasks=5),
    ])
    db_session.flush()

    items, _ = svc.get_page(
        ORG, ADMIN, {}, sort_key="total_tasks", sort_dir="asc"
    )

    assert [p.id for p in items] == [309, 310, 311]


# ── pagination ──────────────────────────────────────────────────────────────


def test_pagination_returns_page_and_total(db_session):
    for pid in range(401, 406):  # 5 projects
        db_session.add(_project(pid, total_tasks=pid))
    db_session.flush()

    page1, total = svc.get_page(
        ORG, ADMIN, {}, sort_key="total_tasks", sort_dir="asc",
        page=1, page_size=2,
    )
    page2, _ = svc.get_page(
        ORG, ADMIN, {}, sort_key="total_tasks", sort_dir="asc",
        page=2, page_size=2,
    )
    page3, _ = svc.get_page(
        ORG, ADMIN, {}, sort_key="total_tasks", sort_dir="asc",
        page=3, page_size=2,
    )

    assert total == 5
    assert [p.id for p in page1] == [401, 402]
    assert [p.id for p in page2] == [403, 404]
    assert [p.id for p in page3] == [405]


def test_pagination_respects_filters_in_total(db_session):
    db_session.add_all([
        _project(407, priority="High"),
        _project(408, priority="High"),
        _project(409, priority="Low"),
    ])
    db_session.flush()

    items, total = svc.get_page(
        ORG, ADMIN, {"priority": "High"}, page=1, page_size=10
    )

    assert total == 2
    assert {p.id for p in items} == {407, 408}


# ── get_status_counts ───────────────────────────────────────────────────────


def test_status_counts_aggregate(db_session):
    db_session.add_all([
        _project(501, status=True, source="tm4", total_tasks=10),
        _project(502, status=True, source="mr", total_tasks=5),
        _project(503, status=False, source="tm4", total_tasks=20),
    ])
    db_session.flush()

    counts = svc.get_status_counts(ORG, ADMIN, {})

    assert counts["active_count"] == 2
    assert counts["inactive_count"] == 1
    assert counts["total_tasks"] == 35
    assert counts["tm4_count"] == 2
    assert counts["mr_count"] == 1


def test_status_counts_ignores_status_filter_but_honors_others(db_session):
    db_session.add_all([
        _project(504, status=True, priority="High", total_tasks=1),
        _project(505, status=False, priority="High", total_tasks=2),
        _project(506, status=True, priority="Low", total_tasks=99),
    ])
    db_session.flush()

    # status passed in is dropped; priority is honored.
    counts = svc.get_status_counts(
        ORG, ADMIN, {"status": True, "priority": "High"}
    )

    assert counts["active_count"] == 1
    assert counts["inactive_count"] == 1
    assert counts["total_tasks"] == 3


# ── backward compatibility ──────────────────────────────────────────────────


def test_get_without_new_keys_returns_all(db_session):
    db_session.add_all([_project(601), _project(602)])
    db_session.flush()

    ids = {p.id for p in svc.get(ORG, ADMIN, {})}

    assert {601, 602}.issubset(ids)
