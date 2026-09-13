"""Burndown-chart rate calculation and persistence.

Backs the Reports v2 burndown blocks: one ``BurndownConfig`` row per
(org_id, priority), tracking a trailing-month calculated completion rate, an
optional manual override, and which of the two is currently applied.

Priority is read off each task's parent ``Project.priority`` — Mikro has no
per-task priority column (see ``a7f8a9b0c1d2`` for the only priority-related
migration, which just enforces ``Project.priority`` is NOT NULL). Mikro also
has no historical point-in-time task-count snapshot table, so a burndown's
"starting task count" can only ever be captured as of the moment the
``BurndownConfig`` row is created — this is the spec's own documented
fallback ("if sufficient historical data is unavailable ... the burndown may
instead begin on the date it is created"), not a shortcut: that condition is
always true for every org today.
"""

from datetime import date, datetime, timedelta

from sqlalchemy import func, or_

from ..database import db, Task, Project, BurndownConfig
from .project_service import ProjectService

PRIORITIES = ("High", "Medium", "Low")
DEFAULT_RATE = 300.0
RATE_HISTORY_WINDOW_DAYS = 28  # trailing "month" of completions, weekly-aligned
PROJECTION_HORIZON_WEEKS = 104  # cap the planned line so a ~0 rate can't run forever


def _completed_filter():
    return or_(Task.mapped == True, Task.validated == True)  # noqa: E712


def _completed_at():
    """The later of a task's mapped/validated timestamps (postgres GREATEST
    ignores NULLs, so this is the actual completion event date whichever
    stage a task finished at)."""
    return func.greatest(Task.date_mapped, Task.date_validated)


def _week_start(dt):
    """Align to this app's Sun-Sat calendar week (matches editing_stats.py)."""
    return func.date_trunc("week", dt + timedelta(days=1)) - timedelta(days=1)


def _priority_projects(org_id, priority, viewer):
    """Project rows at this priority, scoped to what `viewer` may see."""
    query = ProjectService.role_scope_projects_query(Project.query, viewer)
    return query.filter(Project.org_id == org_id, Project.priority == priority).all()


def _priority_project_ids(org_id, priority, viewer):
    """Project ids at this priority, scoped to what `viewer` may see."""
    return [p.id for p in _priority_projects(org_id, priority, viewer)]


def remaining_task_count(org_id, priority, viewer):
    """Live count of not-yet-completed tasks for projects at this priority.

    A sync only ever creates a local ``Task`` row once a mapper/validator has
    touched it (see ``sync_tm4_project`` in views/Tasks.py and
    ``sync_challenge_tasks`` in views/MapRoulette.py) — an untouched task has
    no local row at all. So remaining can't be "count incomplete Task rows";
    it has to be the project's real remote total minus what's completed,
    same as the percent-complete math in reports/editing_stats.py.
    """
    projects = _priority_projects(org_id, priority, viewer)
    if not projects:
        return 0

    project_ids = [p.id for p in projects]
    completed_by_project = dict(
        db.session.query(Task.project_id, func.count(func.distinct(Task.id)))
        .filter(Task.project_id.in_(project_ids), _completed_filter())
        .group_by(Task.project_id)
        .all()
    )

    remaining = 0
    for p in projects:
        effective_total = (p.total_tasks or 0) - (p.tasks_overlap or 0)
        completed = completed_by_project.get(p.id, 0)
        remaining += max(0, effective_total - completed)
    return remaining


def compute_calculated_rate(org_id, priority, viewer):
    """Average weekly task completions over the trailing month.

    Returns None when there's no completion data in the window at all, so the
    caller can distinguish "insufficient data" from a genuine 0/week rate.
    """
    project_ids = _priority_project_ids(org_id, priority, viewer)
    if not project_ids:
        return None

    window_start = datetime.utcnow() - timedelta(days=RATE_HISTORY_WINDOW_DAYS)
    completed_at = _completed_at()
    completions = (
        db.session.query(func.count(func.distinct(Task.id)))
        .filter(
            Task.project_id.in_(project_ids),
            _completed_filter(),
            completed_at >= window_start,
        )
        .scalar()
        or 0
    )
    if completions == 0:
        return None
    weeks = RATE_HISTORY_WINDOW_DAYS / 7.0
    return round(completions / weeks, 1)


def get_or_create_config(org_id, priority, viewer):
    """Fetch the org's BurndownConfig for this priority, creating it on first access.

    An org that already has a trailing month of history when this feature is
    first used should see it immediately rather than a "Not available"
    placeholder until someone happens to click Recalculate — so creation
    attempts the calculated rate up front. Only when there's genuinely no
    data yet (spec §8) does it fall back to the 300/week default.
    """
    cfg = BurndownConfig.query.filter_by(org_id=org_id, priority=priority).first()
    if cfg:
        return cfg

    calculated = compute_calculated_rate(org_id, priority, viewer)
    cfg = BurndownConfig(
        org_id=org_id,
        priority=priority,
        burndown_start_date=date.today(),
        starting_task_count=remaining_task_count(org_id, priority, viewer),
        calculated_rate=calculated,
        manual_rate=None if calculated is not None else DEFAULT_RATE,
        applied_rate_source=(
            "historical_average" if calculated is not None else "default"
        ),
    )
    cfg.save()
    return cfg


def applied_rate(cfg):
    if cfg.applied_rate_source == "historical_average":
        return cfg.calculated_rate or 0.0
    return cfg.manual_rate or 0.0


def _weekly_completion_counts(project_ids, start_date, end_date):
    """[(week_start, completed_count), ...] between start_date and end_date."""
    if not project_ids:
        return []
    completed_at = _completed_at()
    rows = (
        db.session.query(
            _week_start(completed_at).label("week"),
            func.count(func.distinct(Task.id)).label("count"),
        )
        .filter(
            Task.project_id.in_(project_ids),
            _completed_filter(),
            completed_at >= start_date,
            completed_at < end_date,
        )
        .group_by("week")
        .all()
    )
    return sorted(
        [(r.week.date() if hasattr(r.week, "date") else r.week, r.count) for r in rows],
        key=lambda r: r[0],
    )


def actual_series(cfg, viewer):
    """Weekly actual remaining-task counts since burndown_start_date.

    Derived from cumulative completions since the burndown started, not a
    stored snapshot — see module docstring. This assumes the priority's task
    pool doesn't grow after the burndown starts, which is also an implicit
    assumption of the spec's own planned-burndown formula (no "tasks added"
    term).
    """
    project_ids = _priority_project_ids(cfg.org_id, cfg.priority, viewer)
    today = date.today()
    weekly = _weekly_completion_counts(
        project_ids, cfg.burndown_start_date, today + timedelta(days=1)
    )

    remaining = cfg.starting_task_count
    series = [{"date": cfg.burndown_start_date.isoformat(), "remaining": remaining}]
    for week_start, count in weekly:
        remaining = max(0, remaining - count)
        series.append({"date": week_start.isoformat(), "remaining": remaining})
    return series


def planned_series(cfg, viewer):
    """Planned burndown from now forward, per spec §11/§12.

    Historical planned points are never recomputed. The forward-looking line
    always restarts from the current *actual* remaining count using whatever
    rate is presently applied, per spec §12 ("reconfigured from the
    appropriate current projection point using the newly applied rate").
    """
    rate = applied_rate(cfg)
    remaining = remaining_task_count(cfg.org_id, cfg.priority, viewer)
    today = date.today()

    series = [{"date": today.isoformat(), "remaining": remaining}]
    if rate <= 0:
        return series

    week = 0
    while remaining > 0 and week < PROJECTION_HORIZON_WEEKS:
        week += 1
        remaining = max(0, round(remaining - rate))
        series.append(
            {
                "date": (today + timedelta(weeks=week)).isoformat(),
                "remaining": remaining,
            }
        )
    return series


def projected_completion_date(cfg, viewer):
    """Date the planned line reaches 0, or None if the applied rate is 0."""
    rate = applied_rate(cfg)
    if rate <= 0:
        return None
    remaining = remaining_task_count(cfg.org_id, cfg.priority, viewer)
    if remaining <= 0:
        return date.today().isoformat()
    weeks_needed = remaining / rate
    if weeks_needed > PROJECTION_HORIZON_WEEKS:
        return None
    return (date.today() + timedelta(weeks=weeks_needed)).isoformat()
