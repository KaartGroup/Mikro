"""
Unit tests for worker graceful-shutdown and orphan-requeue logic.

DB-free: all database access is mocked against api.worker.main's imported names.

Covers:
  - _drain_running_jobs: exits immediately with no threads registered
  - _drain_running_jobs: exits cleanly when threads finish before the timeout
  - _drain_running_jobs: requeues jobs whose threads outlive the drain timeout
  - _drain_running_jobs: leaves jobs alone when their DB status is already done
  - poll_for_jobs: resets a stuck-running orphan back to 'queued' (not 'failed')
"""

import threading
from contextlib import nullcontext
from unittest.mock import MagicMock, patch

import pytest

import api.worker.main as worker_main
from api.worker.main import _drain_running_jobs, poll_for_jobs


ORG_A = "org_aaa"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _mock_job(id=1, org_id=ORG_A, job_type="task_sync", status="running"):
    job = MagicMock()
    job.id = id
    job.org_id = org_id
    job.job_type = job_type
    job.status = status
    job.started_at = None
    return job


def _make_app():
    """Mock Flask app whose app_context() is a no-op context manager."""
    app = MagicMock()
    app.app_context.return_value = nullcontext()
    return app


@pytest.fixture(autouse=True)
def clear_running_threads():
    """Isolate _running_sync_threads between tests."""
    worker_main._running_sync_threads.clear()
    yield
    worker_main._running_sync_threads.clear()


# ---------------------------------------------------------------------------
# _drain_running_jobs
# ---------------------------------------------------------------------------

def test_drain_no_in_flight_jobs():
    """With no threads registered, drain exits without entering the app context."""
    app = _make_app()

    with patch("api.worker.main.SyncJob") as MockJob, \
         patch("api.worker.main.db") as mock_db:
        _drain_running_jobs(app, timeout=1)

    app.app_context.assert_not_called()
    MockJob.query.get.assert_not_called()
    mock_db.session.commit.assert_not_called()


def test_drain_clean_when_threads_already_done():
    """Threads that finish before drain is called trigger no requeue."""
    app = _make_app()

    t = threading.Thread(target=lambda: None)
    t.start()
    t.join()  # Already dead before drain runs
    worker_main._running_sync_threads[99] = t

    with patch("api.worker.main.SyncJob") as MockJob, \
         patch("api.worker.main.db") as mock_db:
        _drain_running_jobs(app, timeout=5)

    MockJob.query.get.assert_not_called()
    mock_db.session.commit.assert_not_called()


def test_drain_requeues_job_when_thread_outlives_timeout():
    """Jobs whose threads are still alive after the timeout are reset to 'queued'."""
    app = _make_app()

    stop = threading.Event()
    t = threading.Thread(target=lambda: stop.wait(10))
    t.daemon = True
    t.start()
    worker_main._running_sync_threads[42] = t

    job = _mock_job(id=42, status="running")

    try:
        with patch("api.worker.main.SyncJob") as MockJob, \
             patch("api.worker.main.db") as mock_db:
            MockJob.query.get.return_value = job
            _drain_running_jobs(app, timeout=0)

        assert job.status == "queued"
        assert job.started_at is None
        mock_db.session.commit.assert_called_once()
    finally:
        stop.set()
        t.join(timeout=1)


def test_drain_skips_requeue_if_job_already_finished():
    """If the DB status is no longer 'running', drain leaves the job untouched."""
    app = _make_app()

    stop = threading.Event()
    t = threading.Thread(target=lambda: stop.wait(10))
    t.daemon = True
    t.start()
    worker_main._running_sync_threads[7] = t

    job = _mock_job(id=7, status="completed")

    try:
        with patch("api.worker.main.SyncJob") as MockJob, \
             patch("api.worker.main.db") as mock_db:
            MockJob.query.get.return_value = job
            _drain_running_jobs(app, timeout=0)

        assert job.status == "completed"
        mock_db.session.commit.assert_not_called()
    finally:
        stop.set()
        t.join(timeout=1)


# ---------------------------------------------------------------------------
# poll_for_jobs — orphan requeue
# ---------------------------------------------------------------------------

def test_poll_requeues_orphan_instead_of_failing():
    """
    A job stuck in 'running' with no live thread must be reset to 'queued'
    so the next worker picks it up. Regression: it used to be marked 'failed'.
    """
    app = _make_app()

    queued_job = _mock_job(id=10, org_id=ORG_A, status="queued")
    orphan_job = _mock_job(id=5, org_id=ORG_A, status="running")

    # _running_sync_threads is empty — no live thread for orphan_job

    def filter_by_side_effect(**kwargs):
        m = MagicMock()
        if kwargs.get("status") == "queued":
            m.order_by.return_value.first.return_value = queued_job
        elif kwargs.get("status") == "running":
            m.first.return_value = orphan_job
        else:
            m.order_by.return_value.first.return_value = None
            m.first.return_value = None
        return m

    with patch("api.worker.main.SyncJob") as MockJob, \
         patch("api.worker.main.db"), \
         patch("api.worker.main._dispatch_sync_job"):
        MockJob.query.filter_by.side_effect = filter_by_side_effect
        poll_for_jobs(app)

    assert orphan_job.status == "queued"
    assert orphan_job.started_at is None
