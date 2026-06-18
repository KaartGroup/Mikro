import logging

logger = logging.getLogger(__name__)


class SyncJobQueue:
    """Centralizes SyncJob creation with deduplication against queued jobs."""

    @classmethod
    def enqueue(cls, org_id, job_type, target_id=None, progress=None):
        """
        Queue a sync job. Returns (job, created: bool).

        created=False means an identical queued job already existed and was
        returned instead of creating a duplicate. Dedup key is
        (org_id, job_type, target_id, progress) across status="queued" rows.
        """
        from ..database import SyncJob

        existing = SyncJob.query.filter(
            SyncJob.org_id == org_id,
            SyncJob.job_type == job_type,
            SyncJob.target_id == target_id,
            SyncJob.progress == progress,
            SyncJob.status == "queued",
        ).first()

        if existing:
            logger.debug(
                f"SyncJobQueue: deduped {job_type} org={org_id} "
                f"target={target_id} -> job {existing.id}"
            )
            return existing, False

        job = SyncJob.create(
            org_id=org_id,
            status="queued",
            job_type=job_type,
            target_id=target_id,
            progress=progress,
        )
        logger.info(
            f"SyncJobQueue: queued {job_type} org={org_id} "
            f"target={target_id} -> job {job.id}"
        )
        return job, True

    @classmethod
    def enqueue_project_sync(cls, org_id, project_id, user_id=None):
        progress = f"user:{user_id}" if user_id else None
        return cls.enqueue(
            org_id, "project_sync", target_id=project_id, progress=progress
        )

    @classmethod
    def enqueue_task_sync(cls, org_id):
        return cls.enqueue(org_id, "task_sync")

    @classmethod
    def enqueue_element_analysis(cls, org_id):
        return cls.enqueue(org_id, "element_analysis")

    @classmethod
    def enqueue_element_analysis_backfill(cls, org_id):
        return cls.enqueue(org_id, "element_analysis_backfill")

    @classmethod
    def enqueue_mr_backfill(cls, org_id, project_id):
        return cls.enqueue(org_id, "mr_metadata_backfill", target_id=project_id)
