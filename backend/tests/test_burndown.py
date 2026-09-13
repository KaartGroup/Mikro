"""
Tests for the Reports v2 burndown-chart feature (rate math + view invariants).

Uses the shared db_session fixture (PostgreSQL, rolled back per test). An
org_admin viewer is used throughout so role scoping returns the whole org and
tests focus on the burndown rate/series logic itself, per the pattern in
test_project_query.py.
"""

from datetime import datetime, timedelta

from flask import g

from api.database import Project, Task, BurndownConfig
from api.services import burndown_service as svc
from api.views.Burndown import BurndownAPI

ORG = "burndown-test-org"


class _User:
    def __init__(self, uid="auth0|burndown-admin", role="admin", org_id=ORG):
        self.id = uid
        self.role = role
        self.org_id = org_id


ADMIN = _User()


def _project(pid, priority="High", **kwargs):
    defaults = dict(
        id=pid,
        url=f"https://example.com/{pid}",
        org_id=ORG,
        status=True,
        source="tm4",
        priority=priority,
        total_tasks=0,
    )
    defaults.update(kwargs)
    return Project(**defaults)


def _task(tid, project_id, mapped=False, validated=False, completed_at=None, **kwargs):
    defaults = dict(
        id=tid,
        task_id=tid,
        org_id=ORG,
        project_id=project_id,
        source="tm4",
        mapped=mapped,
        validated=validated,
        mapped_by="mapper1",
        date_mapped=completed_at if mapped else None,
        date_validated=completed_at if validated else None,
    )
    defaults.update(kwargs)
    return Task(**defaults)


# ── compute_calculated_rate ────────────────────────────────────────────────


def test_calculated_rate_is_none_with_no_completions(db_session):
    db_session.add(_project(1))
    db_session.flush()

    assert svc.compute_calculated_rate(ORG, "High", ADMIN) is None


def test_calculated_rate_averages_completions_over_the_trailing_month(db_session):
    db_session.add(_project(2))
    db_session.flush()

    now = datetime.utcnow()
    # 28 completions inside the trailing 28-day window -> 7/week.
    db_session.add_all(
        [
            _task(100 + i, 2, mapped=True, completed_at=now - timedelta(days=i))
            for i in range(28)
        ]
    )
    # One old completion outside the window that must not be counted.
    db_session.add(_task(999, 2, mapped=True, completed_at=now - timedelta(days=90)))
    db_session.flush()

    rate = svc.compute_calculated_rate(ORG, "High", ADMIN)
    assert rate == 7.0


def test_calculated_rate_is_scoped_by_project_priority(db_session):
    db_session.add_all([_project(3, priority="High"), _project(4, priority="Low")])
    db_session.flush()

    now = datetime.utcnow()
    db_session.add(_task(200, 4, mapped=True, completed_at=now))  # Low priority
    db_session.flush()

    assert svc.compute_calculated_rate(ORG, "High", ADMIN) is None
    assert svc.compute_calculated_rate(ORG, "Low", ADMIN) is not None


# ── remaining_task_count ────────────────────────────────────────────────────


def test_remaining_counts_untouched_tasks_that_have_no_local_task_row(db_session):
    """Regression: a sync only creates a local Task row once someone has
    worked it (see sync_tm4_project / sync_challenge_tasks) — an untouched
    task never gets one. Remaining must come from Project.total_tasks, not
    from counting incomplete local Task rows (which would undercount to 0)."""
    db_session.add(_project(20, total_tasks=1000, tasks_overlap=40))
    db_session.flush()

    now = datetime.utcnow()
    # Only 860 completions have local rows; the other ~100 untouched tasks
    # never got one at all.
    db_session.add_all(
        [_task(800 + i, 20, mapped=True, completed_at=now) for i in range(860)]
    )
    db_session.flush()

    # effective_total = 1000 - 40 = 960; remaining = 960 - 860 = 100.
    assert svc.remaining_task_count(ORG, "High", ADMIN) == 100


def test_remaining_is_zero_not_negative_when_completed_exceeds_total(db_session):
    db_session.add(_project(21, total_tasks=5))
    db_session.flush()

    now = datetime.utcnow()
    db_session.add_all(
        [_task(900 + i, 21, mapped=True, completed_at=now) for i in range(8)]
    )
    db_session.flush()

    assert svc.remaining_task_count(ORG, "High", ADMIN) == 0


# ── get_or_create_config ───────────────────────────────────────────────────


def test_get_or_create_config_uses_the_300_default_when_data_is_insufficient(
    db_session,
):
    db_session.add(_project(5, total_tasks=12))
    db_session.flush()

    cfg = svc.get_or_create_config(ORG, "High", ADMIN)

    assert cfg.calculated_rate is None
    assert cfg.manual_rate == 300.0
    assert cfg.applied_rate_source == "default"
    assert cfg.starting_task_count == 12
    assert svc.applied_rate(cfg) == 300.0


def test_get_or_create_config_picks_up_existing_history_immediately(db_session):
    db_session.add(_project(14))
    db_session.flush()

    now = datetime.utcnow()
    db_session.add_all(
        [_task(700 + i, 14, mapped=True, completed_at=now) for i in range(14)]
    )
    db_session.flush()

    cfg = svc.get_or_create_config(ORG, "High", ADMIN)

    assert cfg.calculated_rate == 3.5  # 14 completions / 4 weeks
    assert cfg.applied_rate_source == "historical_average"
    assert svc.applied_rate(cfg) == 3.5


def test_get_or_create_config_is_idempotent(db_session):
    db_session.add(_project(6))
    db_session.flush()

    first = svc.get_or_create_config(ORG, "Medium", ADMIN)
    first_id = first.id
    second = svc.get_or_create_config(ORG, "Medium", ADMIN)

    assert second.id == first_id
    assert BurndownConfig.query.filter_by(org_id=ORG, priority="Medium").count() == 1


# ── planned/actual series math ─────────────────────────────────────────────


def test_planned_series_follows_the_max_zero_formula(db_session):
    db_session.add(_project(7, total_tasks=100))
    db_session.flush()

    cfg = svc.get_or_create_config(ORG, "High", ADMIN)
    cfg.applied_rate_source = "manual"
    cfg.manual_rate = 25.0
    cfg.save()

    series = svc.planned_series(cfg, ADMIN)

    assert series[0]["remaining"] == 100
    assert series[4]["remaining"] == 0  # 100 - 4*25 == 0
    assert all(point["remaining"] >= 0 for point in series)
    assert series[-1]["remaining"] == 0


def test_actual_series_never_changes_when_the_rate_changes(db_session):
    db_session.add(_project(8, total_tasks=10))
    db_session.flush()

    cfg = svc.get_or_create_config(ORG, "High", ADMIN)
    before = svc.actual_series(cfg, ADMIN)

    cfg.applied_rate_source = "manual"
    cfg.manual_rate = 999.0
    cfg.save()
    after = svc.actual_series(cfg, ADMIN)

    assert before == after


# ── view-level invariants (spec §5/§6/§7) ──────────────────────────────────


def test_recalculate_does_not_change_the_applied_rate_or_manual_rate(app, db_session):
    db_session.add(_project(9))
    db_session.flush()

    cfg = svc.get_or_create_config(ORG, "High", ADMIN)
    cfg.applied_rate_source = "manual"
    cfg.manual_rate = 225.0
    cfg.calculated_rate = 180.0
    cfg.save()

    now = datetime.utcnow()
    db_session.add_all(
        [_task(600 + i, 9, mapped=True, completed_at=now) for i in range(20)]
    )
    db_session.flush()

    with app.test_request_context(json={"priority": "High"}):
        g.user = ADMIN
        resp = BurndownAPI().recalculate_rate()

    assert resp["chart"]["calculatedRate"] == 5.0  # 20 completions / 4 weeks
    assert resp["chart"]["manualRate"] == 225.0
    assert resp["chart"]["appliedRateSource"] == "manual"
    assert resp["chart"]["appliedRate"] == 225.0


def test_apply_manual_rate_does_not_clear_the_calculated_rate(app, db_session):
    db_session.add(_project(10))
    db_session.flush()

    cfg = svc.get_or_create_config(ORG, "High", ADMIN)
    cfg.calculated_rate = 210.0
    cfg.applied_rate_source = "historical_average"
    cfg.save()

    with app.test_request_context(
        json={"priority": "High", "source": "manual", "manualRate": 250}
    ):
        g.user = ADMIN
        resp = BurndownAPI().apply_rate()

    assert resp["chart"]["appliedRateSource"] == "manual"
    assert resp["chart"]["manualRate"] == 250.0
    assert resp["chart"]["calculatedRate"] == 210.0  # untouched


def test_apply_calculated_rate_does_not_delete_the_manual_rate(app, db_session):
    db_session.add(_project(11))
    db_session.flush()

    cfg = svc.get_or_create_config(ORG, "High", ADMIN)
    cfg.calculated_rate = 210.0
    cfg.manual_rate = 225.0
    cfg.applied_rate_source = "manual"
    cfg.save()

    with app.test_request_context(
        json={"priority": "High", "source": "historical_average"}
    ):
        g.user = ADMIN
        resp = BurndownAPI().apply_rate()

    assert resp["chart"]["appliedRateSource"] == "historical_average"
    assert resp["chart"]["appliedRate"] == 210.0
    assert resp["chart"]["manualRate"] == 225.0  # untouched


def test_apply_rate_rejects_an_invalid_source(app, db_session):
    db_session.add(_project(12))
    db_session.flush()

    with app.test_request_context(json={"priority": "High", "source": "nonsense"}):
        g.user = ADMIN
        resp, status = BurndownAPI().apply_rate()

    assert status == 400


def test_apply_manual_rate_rejects_a_negative_value(app, db_session):
    db_session.add(_project(13))
    db_session.flush()

    with app.test_request_context(
        json={"priority": "High", "source": "manual", "manualRate": -5}
    ):
        g.user = ADMIN
        resp, status = BurndownAPI().apply_rate()

    assert status == 400
