import logging
import os
import signal
import sys
import threading
import traceback
from datetime import datetime, timezone, timedelta

logger = logging.getLogger(__name__)

from .jobs.sync import run_sync_job
from .sync_queue import SyncJobQueue
from .jobs.element_analysis import run_element_analysis_job, run_element_analysis_backfill_job
from .jobs.mr_backfill import run_mr_metadata_backfill
from .jobs.transcription import (
    run_transcription_job,
    abandon_orphan_transcriptions,
)
from ..database import db, SyncJob, TranscriptionJob, User

_STALE_JOB_TIMEOUT = timedelta(hours=1)
_SHUTDOWN_MARKER = "/tmp/mikro_worker_clean_shutdown"

# Tracks threads actively running sync jobs so orphan detection works after restart.
_running_sync_threads: dict[int, threading.Thread] = {}


def configure_logging():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )
    try:
        fh = logging.FileHandler("/tmp/worker.log", mode="w")
        fh.setFormatter(
            logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
        )
        logger.addHandler(fh)
        logging.getLogger().addHandler(fh)
    except Exception as e:
        print(f"[worker] could not attach /tmp/worker.log handler: {e}", file=sys.stderr)


def _check_shutdown_marker():
    if os.path.exists(_SHUTDOWN_MARKER):
        logger.info(
            "[LIFECYCLE] Previous worker exited cleanly (shutdown marker present). "
            "Removing marker for this lifetime."
        )
        try:
            os.remove(_SHUTDOWN_MARKER)
        except OSError:
            pass
    else:
        logger.warning(
            "[LIFECYCLE] No clean-shutdown marker found — previous worker lifetime ended "
            "UNGRACEFULLY (OOM, crash, or platform restart). "
            "Any orphan transcriptions requeued below are a consequence of that ungraceful exit."
        )


def _write_shutdown_marker(signum):
    try:
        with open(_SHUTDOWN_MARKER, "w") as f:
            f.write(str(signum))
    except OSError as e:
        logger.warning(f"[LIFECYCLE] Could not write shutdown marker: {e}")


def _expire_stale_sync_job(db, job):
    """Mark a running sync job failed if it has been running >1 hour. Returns True if expired."""
    if not job.started_at:
        return False
    age = datetime.now(timezone.utc) - job.started_at.replace(tzinfo=timezone.utc)
    if age <= _STALE_JOB_TIMEOUT:
        return False
    db.session.refresh(job)
    if job.status != "running":
        return True  # Already finished — no need to expire
    logger.warning(f"Marking stale job {job.id} as failed (running for {age})")
    job.status = "failed"
    job.error = "Timed out (stale after 1 hour)"
    job.completed_at = datetime.now(timezone.utc)
    db.session.commit()
    return True


def schedule_nightly_jobs(app):
    """Queue task_sync and element_analysis for every org that doesn't already have one pending."""
    with app.app_context():
        orgs = (
            db.session.query(User.org_id)
            .filter(User.org_id != None)
            .distinct()
            .all()
        )
        for (org_id,) in orgs:
            for job_type in ("task_sync", "element_analysis"):
                _, created = SyncJobQueue.enqueue(org_id, job_type)
                if created:
                    logger.info(f"Auto-scheduled nightly {job_type} for org {org_id}")


def _dispatch_sync_job(app, job):
    """Start a sync job in a daemon thread and return it.

    Running jobs in a thread keeps the polling loop free so the stale-job
    timeout can fire even while a job is in progress.
    """
    job_id = job.id
    job_type = job.job_type

    def _run():
        try:
            with app.app_context():
                j = SyncJob.query.get(job_id)
                if not j:
                    logger.error(f"Job {job_id} not found in dispatch thread")
                    return
                try:
                    if job_type == "element_analysis":
                        run_element_analysis_job(j)
                    elif job_type == "element_analysis_backfill":
                        run_element_analysis_backfill_job(j)
                    elif job_type == "mr_metadata_backfill":
                        run_mr_metadata_backfill(app, j)
                    else:
                        run_sync_job(j)
                except Exception as e:
                    logger.error(f"Job {job_id} thread fatal error: {e}\n{traceback.format_exc()}")
        finally:
            _running_sync_threads.pop(job_id, None)

    t = threading.Thread(target=_run, daemon=True, name=f"sync-job-{job_id}")
    _running_sync_threads[job_id] = t
    t.start()
    return t


def poll_for_jobs(app):
    """Check for a queued sync job and dispatch it if no job is already running for that org."""
    with app.app_context():
        try:
            job = SyncJob.query.filter_by(status="queued").order_by(SyncJob.id.asc()).first()
            if not job:
                return

            running = SyncJob.query.filter_by(org_id=job.org_id, status="running").first()
            if running:
                thread = _running_sync_threads.get(running.id)
                if thread and thread.is_alive():
                    # Job is actively running in a thread — enforce the stale timeout.
                    if not _expire_stale_sync_job(db, running):
                        logger.debug(
                            f"Job {job.id} waiting — job {running.id} still running for org {job.org_id}"
                        )
                        return
                    # Stale check expired it — fall through and start the queued job.
                else:
                    # DB shows running but no live thread — orphan from a prior worker crash.
                    logger.warning(
                        f"Job {running.id} stuck in running state with no live thread — expiring as orphan"
                    )
                    running.status = "failed"
                    running.error = "Orphaned (worker restarted mid-job)"
                    running.completed_at = datetime.now(timezone.utc)
                    db.session.commit()

            job.status = "running"
            job.started_at = datetime.now(timezone.utc)
            db.session.commit()
            logger.info(f"Dispatching job {job.id} (type={job.job_type}) for org {job.org_id}")
            _dispatch_sync_job(app, job)

        except Exception as e:
            logger.error(f"Error polling for jobs: {e}")
            db.session.rollback()


def poll_for_transcription_jobs(app):
    """Check for a queued transcription job and dispatch it if none is already transcribing."""
    with app.app_context():
        try:
            running = TranscriptionJob.query.filter_by(status="transcribing").first()
            if running:
                if not running.started_at:
                    logger.warning(
                        f"[TRANSCRIBE-POLL] Job {running.id} has status=transcribing but no started_at"
                    )
                    return

                age = datetime.now(timezone.utc) - running.started_at.replace(tzinfo=timezone.utc)
                progress = running.progress or 0
                is_stale = (progress == 0 and age > timedelta(minutes=60)) or age > timedelta(hours=6)
                if not is_stale:
                    return

                reason = (
                    "Stuck at progress=0 after 60 minutes"
                    if progress == 0
                    else "Exceeded 6 hours wall time"
                )
                logger.warning(
                    f"[TRANSCRIBE-POLL] Marking stale job {running.id} as failed "
                    f"(running for {age}, progress={progress}) — {reason}"
                )
                running.status = "error"
                running.error = f"Timed out ({reason})"
                running.completed_at = datetime.now(timezone.utc)
                db.session.commit()

            job = (
                TranscriptionJob.query.filter_by(status="queued")
                .order_by(TranscriptionJob.created_at.asc())
                .first()
            )
            if job:
                logger.info(
                    f"[TRANSCRIBE-POLL] Found queued job {job.id} ({job.file_name}), starting..."
                )
                run_transcription_job(app, job)

        except Exception as e:
            logger.error(f"[TRANSCRIBE-POLL] Error polling: {e}\n{traceback.format_exc()}")
            db.session.rollback()


def _polling_loop(label, poll_fn, stop_event, interval=5):
    """Generic polling loop: calls poll_fn every interval seconds until stop_event is set."""
    logger.info(f"[{label}] polling thread started")
    poll_count = 0
    while not stop_event.wait(interval):
        try:
            poll_fn()
            poll_count += 1
            if poll_count % 60 == 0:
                logger.info(f"[{label}] heartbeat — {poll_count} polls completed")
        except Exception as e:
            logger.error(f"[{label}] uncaught error: {e}\n{traceback.format_exc()}")
    logger.info(f"[{label}] polling thread stopped")


def main():
    configure_logging()

    logger.info("=" * 60)
    logger.info("MIKRO BACKGROUND WORKER STARTING")
    logger.info("Handles task sync, element analysis, and transcription")
    logger.info("NOT bound by Gunicorn timeout")
    logger.info("=" * 60)

    from app import create_app
    app = create_app()

    _check_shutdown_marker()

    stop_event = threading.Event()

    def shutdown_handler(signum, frame):
        logger.info(f"[LIFECYCLE] Shutdown signal {signum} received — worker exiting cleanly")
        _write_shutdown_marker(signum)
        stop_event.set()

    signal.signal(signal.SIGTERM, shutdown_handler)
    signal.signal(signal.SIGINT, shutdown_handler)

    logger.info("Worker running — polling for jobs every 5 seconds")
    logger.info("Nightly task sync + element analysis scheduled at midnight MST (07:00 UTC)")

    abandon_orphan_transcriptions(app)

    # threading.Thread(target=preload_whisper_model, daemon=True).start()

    for label, poll_fn in [
        ("SYNC-THREAD", lambda: poll_for_jobs(app)),
        ("TRANSCRIBE-THREAD", lambda: poll_for_transcription_jobs(app)),
    ]:
        threading.Thread(
            target=_polling_loop,
            args=(label, poll_fn, stop_event),
            daemon=True,
        ).start()

    heartbeat_counter = 0
    last_nightly_date = None

    while not stop_event.wait(5):
        now_utc = datetime.now(timezone.utc)
        if (now_utc.hour - 7) % 24 == 0 and now_utc.minute < 5 and last_nightly_date != now_utc.date():
            last_nightly_date = now_utc.date()
            try:
                schedule_nightly_jobs(app)
            except Exception as e:
                logger.error(f"Failed to auto-schedule nightly jobs: {e}")

        heartbeat_counter += 1
        if heartbeat_counter >= 120:
            heartbeat_counter = 0
            logger.info("Worker heartbeat — still running")

    logger.info("Worker process stopped")
