#!/usr/bin/env python3
"""
MapRoulette sync module for Mikro.

Supplemental integration that syncs MapRoulette challenge tasks alongside
the primary TM4 (Tasking Manager 4) integration. Uses the official
`maproulette` API wrapper (https://pypi.org/project/maproulette/).

Sync data source
-----------------
A single CSV "extract" per challenge gives every task's status plus the OSM
usernames of its mapper and reviewer in one request:

    GET /challenge/{id}/tasks/extract   (Challenge.extract_task_summaries)

This replaces the previous approach of paginating /challenge/{id}/tasks and
then making a /task/{id}/history request per task to recover the mapper and
reviewer -- the extract already contains both, so no per-task fan-out.
Total task count comes from the summary stats endpoint:

    GET /data/challenge/{id}            (Challenge.get_challenge_statistics_by_id)

GOTCHAS (see maproulette_api_gotchas memory):
- extract's default (empty) status filter is NOT "all"; it omits completed
  statuses. We always pass an explicit status filter.
- /tasks/extract and /data/challenge are user-scoped: MR_API_KEY must be a
  real account key in "userId|token" form, not a bare token, or they 401.
- extract reports status/review as LABEL STRINGS (e.g. "Not_An_Issue",
  "Approved With Fixes"), not integer codes; we map them back below.

MR Task Status codes:
    0 = Created
    1 = Fixed
    2 = FalsePositive   (extract label "Not_An_Issue")
    3 = Skipped
    4 = Deleted
    5 = AlreadyFixed    (extract label "Already_Fixed")
    6 = CantComplete    (extract label "Too_Hard")

MR Review Status codes:
    0 = Requested
    1 = Approved
    2 = Rejected
    3 = Assisted        (extract label "Approved With Fixes")
    4 = Disputed
    5 = Unnecessary
    6 = ApprovedWithRevisions
    7 = ApprovedWithFixesAfterRevisions
"""

import csv
import io
from datetime import datetime, timezone
from urllib.parse import urlparse

from flask import current_app
from sqlalchemy import func

import maproulette
from maproulette.api.errors import MapRouletteBaseException

from ..database import Task, User, UserTasks, db

# MR task status constants
MR_STATUS_CREATED = 0
MR_STATUS_FIXED = 1
MR_STATUS_FALSE_POSITIVE = 2
MR_STATUS_SKIPPED = 3
MR_STATUS_DELETED = 4
MR_STATUS_ALREADY_FIXED = 5
MR_STATUS_CANT_COMPLETE = 6

# MR review status constants
MR_REVIEW_REQUESTED = 0
MR_REVIEW_APPROVED = 1
MR_REVIEW_REJECTED = 2
MR_REVIEW_ASSISTED = 3
MR_REVIEW_DISPUTED = 4
MR_REVIEW_UNNECESSARY = 5
MR_REVIEW_APPROVED_WITH_REVISIONS = 6
MR_REVIEW_APPROVED_WITH_FIXES_AFTER_REVISIONS = 7

# All MR statuses that represent real user work (excludes Created=0, Deleted=4)
MR_TRACKABLE_STATUSES = {
    MR_STATUS_FIXED,  # 1
    MR_STATUS_FALSE_POSITIVE,  # 2
    MR_STATUS_SKIPPED,  # 3
    MR_STATUS_ALREADY_FIXED,  # 5
    MR_STATUS_CANT_COMPLETE,  # 6
}

# Comma-separated status filter passed to the extract endpoint so it returns
# exactly the trackable tasks (the empty default would drop completed ones).
MR_TRACKABLE_STATUS_FILTER = ",".join(str(s) for s in sorted(MR_TRACKABLE_STATUSES))

# Upper bound on rows requested from a single extract call.
MR_EXTRACT_LIMIT = 1_000_000

# Review statuses that mark a task validated (mapper paid). This preserves the
# prior behavior (Approved + Assisted). Codes 6/7 are additional approval
# variants currently treated as no-op -- see maproulette_review_codes_gap.
MR_REVIEW_VALIDATES = {MR_REVIEW_APPROVED, MR_REVIEW_ASSISTED}
MR_REVIEW_INVALIDATES = {MR_REVIEW_REJECTED}

# extract CSV "TaskStatus" label -> integer code. Labels are the authoritative
# STATUS_*_NAME values from the MapRoulette backend (Task.scala).
MR_STATUS_LABEL_TO_CODE = {
    "Created": MR_STATUS_CREATED,
    "Fixed": MR_STATUS_FIXED,
    "Not_An_Issue": MR_STATUS_FALSE_POSITIVE,
    "Skipped": MR_STATUS_SKIPPED,
    "Deleted": MR_STATUS_DELETED,
    "Already_Fixed": MR_STATUS_ALREADY_FIXED,
    "Too_Hard": MR_STATUS_CANT_COMPLETE,
}

# extract CSV "ReviewStatus" label -> integer code (or None for no review).
MR_REVIEW_LABEL_TO_CODE = {
    "": None,
    "Requested": MR_REVIEW_REQUESTED,
    "Approved": MR_REVIEW_APPROVED,
    "Rejected": MR_REVIEW_REJECTED,
    "Approved With Fixes": MR_REVIEW_ASSISTED,
    "Disputed": MR_REVIEW_DISPUTED,
    "Unnecessary": MR_REVIEW_UNNECESSARY,
    "Approved With Revisions": MR_REVIEW_APPROVED_WITH_REVISIONS,
    "Approved With Fixes After Revisions": (
        MR_REVIEW_APPROVED_WITH_FIXES_AFTER_REVISIONS
    ),
}

# Sentinel for an unrecognized review label (distinct from "no review" = None).
_UNKNOWN_REVIEW = object()


class MapRouletteSync:
    """
    Syncs MapRoulette challenge tasks into Mikro's task tracking system.

    Mirrors the TM4 sync pattern in Tasks.py but calls MapRoulette API v2
    endpoints. Payment logic is identical to TM4: mapper gets paid when
    their task is validated (not self-validated), validator gets paid for
    each validation.

    This is a SUPPLEMENTAL integration -- TM4 remains the primary source.
    """

    def _get_mr_headers(self):
        api_key = current_app.config.get("MR_API_KEY")
        return {"apiKey": api_key}

    def _get_mr_base_url(self):
        return current_app.config.get("MR_API_URL", "https://maproulette.org/api/v2")

    def _challenge_client(self):
        """Build a maproulette.Challenge client from app config."""
        api_url = self._get_mr_base_url()
        parsed = urlparse(api_url)
        config = maproulette.Configuration(
            api_key=current_app.config.get("MR_API_KEY"),
            hostname=parsed.hostname or "maproulette.org",
            protocol=parsed.scheme or "https",
            api_version=parsed.path.rstrip("/") or "/api/v2",
        )
        return maproulette.Challenge(config)

    def _preload_caches(self, project, parsed_rows):
        """
        Load everything the per-task loop needs up front so the loop hits
        in-memory dicts instead of issuing a query (and commit) per task.

        Returns (existing_tasks, users_by_osm, existing_links):
          existing_tasks : {mr task_id: Task}
          users_by_osm   : {osm_username: User} for usernames seen in rows
          existing_links : set of (user_id, task.id) links that already exist
        """
        existing_tasks = {
            t.task_id: t for t in Task.query.filter_by(project_id=project.id).all()
        }

        # Only resolve usernames that can produce a UserTasks link: every
        # mapper, and reviewers on validating reviews.
        usernames = set()
        for p in parsed_rows:
            if p["mapper"]:
                usernames.add(p["mapper"])
            if p["reviewer"] and p["review_status"] in MR_REVIEW_VALIDATES:
                usernames.add(p["reviewer"])

        users_by_osm = {}
        if usernames:
            users = User.query.filter(User.osm_username.in_(usernames)).all()
            users_by_osm = {u.osm_username: u for u in users}

        existing_links = set()
        if existing_tasks:
            links = (
                UserTasks.query.join(Task, UserTasks.task_id == Task.id)
                .filter(Task.project_id == project.id)
                .all()
            )
            existing_links = {(ut.user_id, ut.task_id) for ut in links}

        return existing_tasks, users_by_osm, existing_links

    def _create_links(self, pending_links, existing_links, preexisting_obj_ids, stats):
        """
        Bulk-create the UserTasks links collected during the loop, skipping
        any that already exist. New tasks must be flushed first so .id is set.
        """
        for user, task in pending_links:
            key = (user.id, task.id)
            if key in existing_links:
                continue
            existing_links.add(key)
            db.session.add(UserTasks(user_id=user.id, task_id=task.id))
            if id(task) in preexisting_obj_ids:
                stats.setdefault("links_repaired", 0)
                stats["links_repaired"] += 1
                current_app.logger.info(
                    f"[LINK] REPAIR: created missing UserTasks link "
                    f"user={user.id} -> task={task.id} (task_id={task.task_id})"
                )
            else:
                current_app.logger.info(
                    f"[LINK] Created UserTasks link: user={user.id} "
                    f"({user.osm_username}) -> task={task.id}"
                )

    # ------------------------------------------------------------------
    # API fetch helpers
    # ------------------------------------------------------------------

    def _fetch_task_summaries(self, challenge_client, challenge_id):
        """
        Fetch the extract CSV for a challenge and return a list of row dicts.

        Requests only the trackable statuses. Raises MapRouletteBaseException
        on API/auth failure so the caller can avoid masking it as "no tasks".
        """
        resp = challenge_client.extract_task_summaries(
            challenge_id,
            limit=MR_EXTRACT_LIMIT,
            status=MR_TRACKABLE_STATUS_FILTER,
        )
        data = resp.get("data")
        if not isinstance(data, str):
            current_app.logger.error(
                f"MR extract for challenge {challenge_id} returned "
                f"non-CSV payload: {type(data).__name__}"
            )
            return []

        rows = list(csv.DictReader(io.StringIO(data)))
        if len(rows) >= MR_EXTRACT_LIMIT:
            current_app.logger.warning(
                f"MR extract for challenge {challenge_id} hit the row limit "
                f"({MR_EXTRACT_LIMIT}); results may be truncated."
            )
        return rows

    def _refresh_total_tasks(self, project, challenge_client):
        """
        Update project.total_tasks from the challenge summary stats endpoint.
        """
        challenge_id = project.id
        try:
            resp = challenge_client.get_challenge_statistics_by_id(challenge_id)
            data = resp.get("data")
            if isinstance(data, list):
                data = data[0] if data else {}
            total = (data or {}).get("actions", {}).get("total", 0)
            if total > 0:
                project.total_tasks = total
                current_app.logger.info(
                    f"MR challenge {challenge_id}: updated total_tasks to {total}"
                )
        except (MapRouletteBaseException, KeyError, TypeError) as e:
            current_app.logger.warning(
                f"Could not refresh total_tasks for MR challenge {challenge_id}: {e}"
            )

    # ------------------------------------------------------------------
    # Row parsing
    # ------------------------------------------------------------------

    def _parse_row(self, row):
        """
        Convert an extract CSV row into normalized fields, or None if the row
        is unusable (missing/unknown task id or status).

        Returns dict: task_id, status, mapper, reviewer, review_status.
        """
        raw_id = (row.get("TaskID") or "").strip()
        if not raw_id:
            return None
        try:
            task_id = int(raw_id)
        except (TypeError, ValueError):
            return None

        status_label = (row.get("TaskStatus") or "").strip()
        status = MR_STATUS_LABEL_TO_CODE.get(status_label)
        if status is None:
            current_app.logger.warning(
                f"[EXTRACT] Unknown task status label '{status_label}' "
                f"for MR task {task_id}; skipping."
            )
            return None

        review_label = (row.get("ReviewStatus") or "").strip()
        review_status = MR_REVIEW_LABEL_TO_CODE.get(review_label, _UNKNOWN_REVIEW)
        if review_status is _UNKNOWN_REVIEW:
            current_app.logger.warning(
                f"[EXTRACT] Unknown review status label '{review_label}' "
                f"for MR task {task_id}; treating as no review."
            )
            review_status = None

        return {
            "task_id": task_id,
            "status": status,
            "mapper": (row.get("Mapper") or "").strip() or None,
            "reviewer": (row.get("Reviewer") or "").strip() or None,
            "review_status": review_status,
        }

    # ------------------------------------------------------------------
    # Task upsert
    # ------------------------------------------------------------------

    def _upsert_task(
        self, parsed, project, existing_tasks, users_by_osm, pending_links, stats
    ):
        """
        Create or update a single Task record from a parsed extract row using
        the preloaded caches. Does not commit; new tasks are added to the
        session and desired UserTasks links are appended to ``pending_links``
        for bulk creation after a single flush.

        Returns the Task record (new or existing).
        """
        task_id = parsed["task_id"]
        status = parsed["status"]
        mapper_username = parsed["mapper"]

        task_record = existing_tasks.get(task_id)

        if task_record is None:
            is_skipped = status == MR_STATUS_SKIPPED
            task_record = Task(
                task_id=task_id,
                project_id=project.id,
                org_id=project.org_id,
                source="mr",
                mr_status=status,
                mapping_rate=0 if is_skipped else project.mapping_rate_per_task,
                validation_rate=0 if is_skipped else project.validation_rate_per_task,
                paid_out=False,
                mapped=True,
                mapped_by=mapper_username or "unknown",
                validated_by="",
                validated=False,
                date_mapped=func.now(),
            )
            db.session.add(task_record)
            existing_tasks[task_id] = task_record
            stats["tasks_created"] += 1

            mapper = users_by_osm.get(mapper_username) if mapper_username else None
            if mapper:
                pending_links.append((mapper, task_record))
            elif mapper_username:
                current_app.logger.warning(
                    f"[LINK] NO UserTasks link for task {task_id} — "
                    f"mapper '{mapper_username}' not found in Mikro"
                )

            current_app.logger.info(
                f"Created MR task {task_id} (status={status}) "
                f"for challenge {project.id}, mapper={mapper_username}"
            )

        else:
            if mapper_username and task_record.mapped_by in (None, "", "unknown"):
                task_record.mapped_by = mapper_username
                mapper = users_by_osm.get(mapper_username)
                if mapper:
                    pending_links.append((mapper, task_record))
                else:
                    current_app.logger.warning(
                        f"[LINK] Update path: mapper '{mapper_username}' NOT FOUND — "
                        f"no UserTasks link for task {task_id}"
                    )
                current_app.logger.info(
                    f"Updated MR task {task_id} mapper: unknown -> {mapper_username}"
                )

            elif mapper_username and task_record.mapped_by == mapper_username:
                mapper = users_by_osm.get(mapper_username)
                if mapper:
                    pending_links.append((mapper, task_record))

        return task_record

    # ------------------------------------------------------------------
    # Public sync entry point
    # ------------------------------------------------------------------

    def sync_challenge_tasks(self, project):
        """
        Sync all actionable tasks from a MapRoulette challenge into Mikro.

        Fetches one extract CSV (status + mapper + reviewer per task), then
        creates or updates Task records and UserTasks links. Review status
        drives validation/invalidation logic identical to TM4.
        """
        challenge_id = project.id

        stats = {
            "tasks_processed": 0,
            "tasks_created": 0,
            "tasks_validated": 0,
            "tasks_invalidated": 0,
            "errors": 0,
        }

        current_app.logger.info(
            f"Starting MR sync for challenge {challenge_id} (project: {project.name})"
        )

        try:
            challenge_client = self._challenge_client()
            rows = self._fetch_task_summaries(challenge_client, challenge_id)
        except MapRouletteBaseException as e:
            current_app.logger.error(
                f"MR extract fetch failed for challenge {challenge_id}: {e}"
            )
            stats["errors"] += 1
            return {"message": f"MR extract failed: {e}", **stats}

        current_app.logger.info(
            f"MR challenge {challenge_id}: found {len(rows)} actionable task summaries"
        )

        if not rows:
            project.update(last_sync_cursor=datetime.now(timezone.utc))
            return {"message": "No actionable tasks found", **stats}

        parsed_rows = [p for p in (self._parse_row(r) for r in rows) if p]

        # Preload existing tasks, the relevant users, and existing links so the
        # loop below issues zero per-task queries.
        existing_tasks, users_by_osm, existing_links = self._preload_caches(
            project, parsed_rows
        )
        preexisting_obj_ids = {id(t) for t in existing_tasks.values()}
        pending_links = []

        for parsed in parsed_rows:
            try:
                stats["tasks_processed"] += 1
                task_record = self._upsert_task(
                    parsed,
                    project,
                    existing_tasks,
                    users_by_osm,
                    pending_links,
                    stats,
                )
                if parsed["review_status"] is not None:
                    self._process_review(
                        task_record, parsed, users_by_osm, pending_links, stats
                    )
            except Exception as e:
                current_app.logger.error(
                    f"Error processing MR task {parsed['task_id']} "
                    f"in challenge {challenge_id}: {e}"
                )
                stats["errors"] += 1

        # Persist the whole batch in one transaction: flush to assign ids to
        # new tasks, create the collected links, then a single commit.
        try:
            db.session.flush()
            self._create_links(
                pending_links, existing_links, preexisting_obj_ids, stats
            )
            self._refresh_total_tasks(project, challenge_client)
            project.last_sync_cursor = datetime.now(timezone.utc)
            db.session.add(project)
            db.session.commit()
        except Exception as e:
            db.session.rollback()
            current_app.logger.error(
                f"MR sync commit failed for challenge {challenge_id}: {e}"
            )
            stats["errors"] += 1
            return {"message": f"MR sync commit failed: {e}", **stats}

        current_app.logger.info(
            f"MR sync complete for challenge {challenge_id}: "
            f"processed={stats['tasks_processed']}, "
            f"created={stats['tasks_created']}, "
            f"validated={stats['tasks_validated']}, "
            f"invalidated={stats['tasks_invalidated']}, "
            f"errors={stats['errors']}"
        )
        return {"message": "sync complete", **stats}

    # ------------------------------------------------------------------
    # Review processing
    # ------------------------------------------------------------------

    def _process_review(self, task_record, parsed, users_by_osm, pending_links, stats):
        """
        Apply validation or invalidation to a task based on MR review status.
        Mutates the (session-tracked) task in place; does not commit.

        Approved/Assisted => validated; Rejected => invalidated.
        Self-validated tasks are marked but not paid.
        """
        review_status = parsed["review_status"]
        mapper_username = parsed["mapper"]
        reviewer_username = parsed["reviewer"]

        if review_status in MR_REVIEW_VALIDATES:
            if task_record.validated:
                return

            is_self_validated = bool(
                mapper_username
                and reviewer_username
                and mapper_username == reviewer_username
            )

            task_record.validated_by = reviewer_username or ""
            task_record.unknown_validator = False
            task_record.validated = True
            task_record.invalidated = False
            task_record.self_validated = is_self_validated
            task_record.date_validated = func.now()

            validator = (
                users_by_osm.get(reviewer_username) if reviewer_username else None
            )
            if validator:
                pending_links.append((validator, task_record))

            if is_self_validated:
                current_app.logger.warning(
                    f"Self-validation detected: {mapper_username} validated "
                    f"their own MR task {task_record.task_id}"
                )

            stats["tasks_validated"] += 1
            current_app.logger.info(
                f"MR task {task_record.task_id} validated by "
                f"{reviewer_username} (mapper: {mapper_username})"
            )

        elif review_status in MR_REVIEW_INVALIDATES:
            if task_record.invalidated:
                return

            task_record.validated_by = reviewer_username or ""
            task_record.invalidated = True
            task_record.validated = False
            task_record.date_validated = func.now()

            stats["tasks_invalidated"] += 1
            current_app.logger.info(
                f"MR task {task_record.task_id} invalidated by "
                f"{reviewer_username} (mapper: {mapper_username})"
            )

    # ------------------------------------------------------------------
    # Metadata (used when adding a new MR project)
    # ------------------------------------------------------------------

    def fetch_challenge_metadata(self, challenge_id):
        """
        Fetch name, description, and task count for a MapRoulette challenge.

        Used when adding a new MR project to Mikro so that metadata can
        be backfilled without blocking the request.
        """
        try:
            challenge_client = self._challenge_client()
            meta_resp = challenge_client.get_challenge_by_id(challenge_id)
            meta = meta_resp.get("data")
            if not isinstance(meta, dict):
                current_app.logger.error(
                    f"MR challenge {challenge_id} returned non-dict: "
                    f"{type(meta).__name__} = {meta}"
                )
                return None

            name = meta.get("name", f"MR Challenge {challenge_id}")
            description = meta.get("description", "")

            task_count = 0
            try:
                stats_resp = challenge_client.get_challenge_statistics_by_id(
                    challenge_id
                )
                data = stats_resp.get("data")
                if isinstance(data, list):
                    data = data[0] if data else {}
                task_count = (data or {}).get("actions", {}).get("total", 0)
            except (MapRouletteBaseException, KeyError, TypeError) as e:
                current_app.logger.warning(
                    f"Could not fetch task count for MR challenge {challenge_id}: {e}"
                )

            return {"name": name, "task_count": task_count, "description": description}

        except MapRouletteBaseException as e:
            current_app.logger.error(
                f"MR API error fetching challenge {challenge_id}: {e}"
            )
            return None
