"""
Tests for which projects a sync job picks up, and in what order.

These cover the two behaviours that decide whether a project ever gets
synced at all:

  * job_type="mr_sync" narrows to MapRoulette projects, so the minutes-long
    MR pass is not queued behind the hours-long TM4 fan-out.
  * projects are ordered least-recently-synced first (never-synced ahead of
    everything), so a run that hits its wall-clock budget resumes on the
    stale tail next time instead of re-syncing the same head forever.

``sync_project`` is monkeypatched throughout — nothing here touches the
MapRoulette or TM4 APIs.
"""

from datetime import datetime, timedelta, timezone

from api.database import Project, SyncJob
from api.worker.jobs import sync as sync_mod
from api.worker.jobs.sync import MAX_SYNC_JOB_DURATION, run_sync_job

ORG = "sync-selection-org"
OTHER_ORG = "sync-selection-other-org"

NOW = datetime(2026, 9, 8, 12, 0, 0, tzinfo=timezone.utc)


def _project(db_session, pid, source, synced_days_ago=None, status=True, org=ORG):
    """Add one project whose last_sync_cursor is N days old (None = never)."""
    cursor = None
    if synced_days_ago is not None:
        cursor = NOW - timedelta(days=synced_days_ago)
    project = Project(
        id=pid,
        org_id=org,
        source=source,
        status=status,
        url=f"https://example.test/{source}/{pid}",
        last_sync_cursor=cursor,
    )
    db_session.add(project)
    return project


def _run(db_session, monkeypatch, job_type):
    """Run a sync job and return the project ids sync_project saw, in order."""
    seen = []
    monkeypatch.setattr(
        sync_mod,
        "sync_project",
        lambda project, org_id, target_user_id=None: seen.append(project.id),
    )
    job = SyncJob(org_id=ORG, status="queued", job_type=job_type)
    db_session.add(job)
    db_session.flush()
    run_sync_job(job)
    return seen, job


def test_mr_sync_selects_only_maproulette_projects(db_session, monkeypatch):
    _project(db_session, 9001, "mr", synced_days_ago=1)
    _project(db_session, 9002, "tm4", synced_days_ago=1)
    _project(db_session, 9003, "mr", synced_days_ago=2)
    db_session.flush()

    seen, job = _run(db_session, monkeypatch, "mr_sync")

    assert 9002 not in seen, "mr_sync must not touch TM4 projects"
    assert set(seen) == {9001, 9003}
    assert job.status == "completed"


def test_task_sync_still_covers_both_sources(db_session, monkeypatch):
    _project(db_session, 9101, "mr", synced_days_ago=1)
    _project(db_session, 9102, "tm4", synced_days_ago=1)
    db_session.flush()

    seen, _ = _run(db_session, monkeypatch, "task_sync")

    assert set(seen) == {9101, 9102}


def test_never_synced_first_then_least_recently_synced(db_session, monkeypatch):
    # Inserted newest-first so insertion order cannot produce the expectation.
    _project(db_session, 9201, "mr", synced_days_ago=1)
    _project(db_session, 9202, "mr", synced_days_ago=30)
    _project(db_session, 9203, "mr", synced_days_ago=None)
    _project(db_session, 9204, "mr", synced_days_ago=7)
    db_session.flush()

    seen, _ = _run(db_session, monkeypatch, "mr_sync")

    assert seen == [9203, 9202, 9204, 9201]


def test_inactive_and_other_org_projects_are_skipped(db_session, monkeypatch):
    _project(db_session, 9301, "mr", synced_days_ago=None)
    _project(db_session, 9302, "mr", synced_days_ago=None, status=False)
    _project(db_session, 9303, "mr", synced_days_ago=None, org=OTHER_ORG)
    db_session.flush()

    seen, _ = _run(db_session, monkeypatch, "mr_sync")

    assert seen == [9301]


def test_stale_job_timeout_exceeds_the_job_budget():
    """
    The poller's stale check must fire AFTER a sync job's own wall-clock
    abort, so the job records how far it got ("completed k/N projects")
    rather than the poller killing it with a bare "stale after 1 hour".

    Inverting these two is what failed the nightly task_sync 14 nights
    running, so it is worth a regression guard.
    """
    from api.worker.main import _STALE_JOB_TIMEOUT

    assert _STALE_JOB_TIMEOUT > MAX_SYNC_JOB_DURATION
