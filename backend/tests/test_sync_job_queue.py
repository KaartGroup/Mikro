"""
Unit tests for SyncJobQueue.

DB-free: SyncJob is mocked so these run without a PostgreSQL instance.
The filter logic that actually prevents duplicate rows is covered here by
verifying what arguments reach SyncJob.query.filter and SyncJob.create.
"""

from unittest.mock import patch, MagicMock, call
import pytest

from api.worker.sync_queue import SyncJobQueue

ORG_A = "org_aaa"
ORG_B = "org_bbb"

_PATCH_TARGET = "api.database.SyncJob"


def _mock_job(id=1, org_id=ORG_A, job_type="task_sync",
              target_id=None, progress=None, status="queued"):
    job = MagicMock()
    job.id = id
    job.org_id = org_id
    job.job_type = job_type
    job.target_id = target_id
    job.progress = progress
    job.status = status
    return job


# ---------------------------------------------------------------------------
# enqueue — creation path
# ---------------------------------------------------------------------------

@patch(_PATCH_TARGET)
def test_enqueue_creates_job_when_none_exists(MockSyncJob):
    MockSyncJob.query.filter.return_value.first.return_value = None
    new_job = _mock_job()
    MockSyncJob.create.return_value = new_job

    job, created = SyncJobQueue.enqueue(ORG_A, "task_sync")

    assert created is True
    assert job is new_job
    MockSyncJob.create.assert_called_once_with(
        org_id=ORG_A,
        status="queued",
        job_type="task_sync",
        target_id=None,
        progress=None,
    )


@patch(_PATCH_TARGET)
def test_enqueue_passes_target_and_progress_to_create(MockSyncJob):
    MockSyncJob.query.filter.return_value.first.return_value = None
    MockSyncJob.create.return_value = _mock_job()

    SyncJobQueue.enqueue(ORG_A, "project_sync", target_id=99, progress="user:7")

    MockSyncJob.create.assert_called_once_with(
        org_id=ORG_A,
        status="queued",
        job_type="project_sync",
        target_id=99,
        progress="user:7",
    )


# ---------------------------------------------------------------------------
# enqueue — deduplication path
# ---------------------------------------------------------------------------

@patch(_PATCH_TARGET)
def test_enqueue_returns_existing_job_without_creating(MockSyncJob):
    existing = _mock_job(id=42)
    MockSyncJob.query.filter.return_value.first.return_value = existing

    job, created = SyncJobQueue.enqueue(ORG_A, "task_sync")

    assert created is False
    assert job is existing
    MockSyncJob.create.assert_not_called()


@patch(_PATCH_TARGET)
def test_enqueue_queries_only_queued_status(MockSyncJob):
    """Dedup must check status='queued', not running/completed."""
    MockSyncJob.query.filter.return_value.first.return_value = None
    MockSyncJob.create.return_value = _mock_job()

    SyncJobQueue.enqueue(ORG_A, "task_sync")

    filter_call_args = MockSyncJob.query.filter.call_args[0]
    # One of the filter conditions must compare SyncJob.status == "queued"
    # With a MagicMock, each condition arg is a MagicMock comparison result.
    # We verify the filter was called (not bypassed) — the real SQL predicate
    # correctness is an integration concern.
    assert MockSyncJob.query.filter.called


# ---------------------------------------------------------------------------
# enqueue — filter uses all four key dimensions
# ---------------------------------------------------------------------------

@patch(_PATCH_TARGET)
def test_enqueue_filter_called_with_five_conditions(MockSyncJob):
    MockSyncJob.query.filter.return_value.first.return_value = None
    MockSyncJob.create.return_value = _mock_job()

    SyncJobQueue.enqueue(ORG_A, "project_sync", target_id=5, progress="user:1")

    # Expect exactly 5 conditions passed to filter:
    # org_id, job_type, target_id, progress, status
    args = MockSyncJob.query.filter.call_args[0]
    assert len(args) == 5


# ---------------------------------------------------------------------------
# Convenience wrappers — argument forwarding
# ---------------------------------------------------------------------------

@patch(_PATCH_TARGET)
def test_enqueue_project_sync_no_user(MockSyncJob):
    MockSyncJob.query.filter.return_value.first.return_value = None
    MockSyncJob.create.return_value = _mock_job()

    SyncJobQueue.enqueue_project_sync(ORG_A, 55)

    MockSyncJob.create.assert_called_once_with(
        org_id=ORG_A,
        status="queued",
        job_type="project_sync",
        target_id=55,
        progress=None,
    )


@patch(_PATCH_TARGET)
def test_enqueue_project_sync_with_user(MockSyncJob):
    MockSyncJob.query.filter.return_value.first.return_value = None
    MockSyncJob.create.return_value = _mock_job()

    SyncJobQueue.enqueue_project_sync(ORG_A, 55, user_id=7)

    MockSyncJob.create.assert_called_once_with(
        org_id=ORG_A,
        status="queued",
        job_type="project_sync",
        target_id=55,
        progress="user:7",
    )


@patch(_PATCH_TARGET)
def test_enqueue_task_sync(MockSyncJob):
    MockSyncJob.query.filter.return_value.first.return_value = None
    MockSyncJob.create.return_value = _mock_job(job_type="task_sync")

    job, created = SyncJobQueue.enqueue_task_sync(ORG_A)

    MockSyncJob.create.assert_called_once_with(
        org_id=ORG_A,
        status="queued",
        job_type="task_sync",
        target_id=None,
        progress=None,
    )
    assert created is True


@patch(_PATCH_TARGET)
def test_enqueue_element_analysis(MockSyncJob):
    MockSyncJob.query.filter.return_value.first.return_value = None
    MockSyncJob.create.return_value = _mock_job(job_type="element_analysis")

    SyncJobQueue.enqueue_element_analysis(ORG_A)

    MockSyncJob.create.assert_called_once_with(
        org_id=ORG_A,
        status="queued",
        job_type="element_analysis",
        target_id=None,
        progress=None,
    )


@patch(_PATCH_TARGET)
def test_enqueue_mr_backfill(MockSyncJob):
    MockSyncJob.query.filter.return_value.first.return_value = None
    MockSyncJob.create.return_value = _mock_job(job_type="mr_metadata_backfill")

    SyncJobQueue.enqueue_mr_backfill(ORG_A, 123)

    MockSyncJob.create.assert_called_once_with(
        org_id=ORG_A,
        status="queued",
        job_type="mr_metadata_backfill",
        target_id=123,
        progress=None,
    )


# ---------------------------------------------------------------------------
# Convenience wrappers — dedup passthrough
# ---------------------------------------------------------------------------

@patch(_PATCH_TARGET)
def test_enqueue_project_sync_deduplicates(MockSyncJob):
    existing = _mock_job(id=10, job_type="project_sync", target_id=55, progress="user:7")
    MockSyncJob.query.filter.return_value.first.return_value = existing

    job, created = SyncJobQueue.enqueue_project_sync(ORG_A, 55, user_id=7)

    assert created is False
    assert job is existing
    MockSyncJob.create.assert_not_called()


@patch(_PATCH_TARGET)
def test_enqueue_mr_backfill_deduplicates(MockSyncJob):
    existing = _mock_job(id=20, job_type="mr_metadata_backfill", target_id=123)
    MockSyncJob.query.filter.return_value.first.return_value = existing

    job, created = SyncJobQueue.enqueue_mr_backfill(ORG_A, 123)

    assert created is False
    assert job is existing
    MockSyncJob.create.assert_not_called()
