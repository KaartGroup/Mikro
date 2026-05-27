#!/usr/bin/env python3
"""
MapRoulette sync module for Mikro.

Supplemental integration that syncs MapRoulette challenge tasks alongside
the primary TM4 (Tasking Manager 4) integration. Uses the MapRoulette API v2
to fetch challenge tasks, their completion history, and review status.

Key differences from TM4:
- MR uses OSM usernames (no separate MR username needed)
- No split task logic (parent_task_id stays null)
- Tasks are fetched by paginating challenge tasks, not contributions
- Review status comes from task history, not a separate endpoint

MR Task Status codes:
    0 = Created
    1 = Fixed
    2 = FalsePositive
    3 = Skipped
    5 = AlreadyFixed
    6 = CantComplete

MR Review Status codes:
    0 = Requested
    1 = Approved
    2 = Rejected
    3 = Assisted
    4 = Disputed
"""

import time
import requests
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed

from flask import current_app
from sqlalchemy import func

from ..database import Project, Task, User, UserTasks, db


# MR task status constants
MR_STATUS_CREATED = 0
MR_STATUS_FIXED = 1
MR_STATUS_FALSE_POSITIVE = 2
MR_STATUS_SKIPPED = 3
MR_STATUS_ALREADY_FIXED = 5
MR_STATUS_CANT_COMPLETE = 6

# MR review status constants
MR_REVIEW_REQUESTED = 0
MR_REVIEW_APPROVED = 1
MR_REVIEW_REJECTED = 2
MR_REVIEW_ASSISTED = 3
MR_REVIEW_DISPUTED = 4

# MR history action type constants
MR_ACTION_STATUS_CHANGE = 1
MR_ACTION_REVIEW = 2

# All MR statuses that represent real user work (excludes Created=0)
MR_TRACKABLE_STATUSES = {
    MR_STATUS_FIXED,           # 1
    MR_STATUS_FALSE_POSITIVE,  # 2
    MR_STATUS_SKIPPED,         # 3
    MR_STATUS_ALREADY_FIXED,   # 5
    MR_STATUS_CANT_COMPLETE,   # 6
}


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
        return current_app.config.get(
            "MR_API_URL", "https://maproulette.org/api/v2"
        )

    def _parse_date(self, date_str):
        if not date_str:
            return None
        try:
            return datetime.fromisoformat(date_str.replace("Z", "+00:00"))
        except (ValueError, TypeError, AttributeError):
            try:
                return datetime.strptime(date_str, "%Y-%m-%dT%H:%M:%S.%f%z")
            except (ValueError, TypeError):
                current_app.logger.warning(f"Could not parse date string: {date_str}")
                return None

    def _resolve_user(self, osm_username):
        if not osm_username:
            return None
        return User.query.filter_by(osm_username=osm_username).first()

    def _ensure_user_tasks_link(self, user, task_record):
        """Create a UserTasks link if one doesn't already exist."""
        # TODO: Pre-load all existing UserTasks for the project into a set
        #       upfront to replace these per-task existence-check queries.
        existing = UserTasks.query.filter_by(
            user_id=user.id, task_id=task_record.id
        ).first()
        if not existing:
            UserTasks.create(user_id=user.id, task_id=task_record.id)
            return True
        return False

    # ------------------------------------------------------------------
    # API fetch helpers
    # ------------------------------------------------------------------

    def _fetch_actionable_tasks(self, challenge_id, base_url, headers):
        """
        Paginate the challenge tasks endpoint and return only trackable tasks.

        TODO: The page size here (50) and in _refresh_total_tasks (200) both
              scan the same endpoint. Switching to 200 here would cut the
              request count ~4x and let _refresh_total_tasks reuse the data
              instead of making a second full pass.
        """
        actionable = []
        page = 0
        limit = 50

        while True:
            url = f"{base_url}/challenge/{challenge_id}/tasks?limit={limit}&page={page}"
            try:
                response = requests.get(url, headers=headers, timeout=60)
                if not response.ok:
                    current_app.logger.error(
                        f"MR task list fetch failed for challenge {challenge_id} "
                        f"page {page}: HTTP {response.status_code}"
                    )
                    break

                tasks_page = response.json()
                if not isinstance(tasks_page, list) or not tasks_page:
                    break

                for t in tasks_page:
                    try:
                        if t.get("status") in MR_TRACKABLE_STATUSES:
                            actionable.append(t)
                    except (TypeError, AttributeError):
                        continue

                if len(tasks_page) < limit:
                    break
                page += 1

            except requests.RequestException as e:
                current_app.logger.error(
                    f"MR API error listing tasks for challenge {challenge_id} page {page}: {e}"
                )
                break
            except (ValueError, KeyError) as e:
                current_app.logger.error(
                    f"MR JSON parse error for challenge {challenge_id} page {page}: {e}"
                )
                break

        return actionable

    def _fetch_task_history(self, task_id, base_url=None, headers=None, app=None):
        """
        Fetch the action history for a single MapRoulette task.

        When called from a thread, pass base_url, headers, and app
        to avoid Flask application context issues.
        """
        if app:
            ctx = app.app_context()
            ctx.push()
        try:
            _base_url = base_url or self._get_mr_base_url()
            _headers = headers or self._get_mr_headers()
            url = f"{_base_url}/task/{task_id}/history"

            response = requests.get(url, headers=_headers, timeout=30)
            if response.ok:
                data = response.json()
                if isinstance(data, list):
                    return data
                if app:
                    app.logger.warning(
                        f"MR task history for {task_id} returned non-list: {type(data)}"
                    )
                return []
            else:
                if app:
                    app.logger.warning(
                        f"MR task history fetch failed for task {task_id}: "
                        f"HTTP {response.status_code}"
                    )
                return []
        except requests.RequestException as e:
            if app:
                app.logger.error(f"MR API error fetching history for task {task_id}: {e}")
            return []
        except (ValueError, KeyError) as e:
            if app:
                app.logger.error(f"MR JSON parse error for task {task_id} history: {e}")
            return []
        finally:
            if app:
                ctx.pop()

    def _fetch_all_histories(self, task_ids, base_url, headers):
        """
        Fetch history for all tasks in parallel, returning {task_id: history}.

        TODO: batch_size=3 with 50ms sleeps is very conservative. MR's API
              rate limits are not published; 10-20 workers with a shorter
              sleep would likely be safe and cut history-fetch time significantly.
        """
        task_histories = {}
        app = current_app._get_current_object()
        batch_size = 3

        for batch_start in range(0, len(task_ids), batch_size):
            batch = task_ids[batch_start: batch_start + batch_size]

            with ThreadPoolExecutor(max_workers=batch_size) as executor:
                future_to_task = {
                    executor.submit(
                        self._fetch_task_history, tid,
                        base_url=base_url, headers=headers, app=app,
                    ): tid
                    for tid in batch
                }
                for future in as_completed(future_to_task):
                    tid = future_to_task[future]
                    try:
                        task_histories[tid] = future.result()
                    except Exception as e:
                        current_app.logger.error(
                            f"MR history fetch exception for task {tid}: {e}"
                        )
                        task_histories[tid] = []

            time.sleep(0.05)

        return task_histories

    def _refresh_total_tasks(self, project, base_url, headers):
        """
        Paginate the challenge to count all tasks (including non-trackable)
        and update project.total_tasks.

        TODO: If _fetch_actionable_tasks is changed to page at size 200 and
              return the total page count, this second scan can be eliminated.
        """
        challenge_id = project.id
        try:
            total = 0
            page = 0
            limit = 200
            while True:
                url = f"{base_url}/challenge/{challenge_id}/tasks?limit={limit}&page={page}"
                resp = requests.get(url, headers=headers, timeout=30)
                if not resp.ok:
                    break
                page_tasks = resp.json()
                if not isinstance(page_tasks, list) or not page_tasks:
                    break
                total += len(page_tasks)
                if len(page_tasks) < limit:
                    break
                page += 1

            if total > 0:
                project.total_tasks = total
                current_app.logger.info(
                    f"MR challenge {challenge_id}: updated total_tasks to {total}"
                )
        except Exception as e:
            current_app.logger.warning(
                f"Could not refresh total_tasks for MR challenge {challenge_id}: {e}"
            )

    # ------------------------------------------------------------------
    # Task upsert
    # ------------------------------------------------------------------

    def _upsert_task(self, mr_task, project, mapper_username, stats):
        """
        Create or update a single Task record and its UserTasks link.

        Returns the Task record (new or existing).

        TODO: Pre-load all existing Task records for the project into a
              {task_id: Task} dict before the loop to replace these
              per-task queries with O(1) dict lookups.
        TODO: Cache _resolve_user results across the sync call to avoid
              a DB round-trip for every task that shares a mapper username.
        """
        mr_task_id = mr_task.get("id")
        task_status = mr_task.get("status", MR_STATUS_FIXED)

        task_record = Task.query.filter_by(
            task_id=mr_task_id, project_id=project.id
        ).first()

        if task_record is None:
            is_skipped = task_status == MR_STATUS_SKIPPED
            task_record = Task.create(
                task_id=mr_task_id,
                project_id=project.id,
                org_id=project.org_id,
                source="mr",
                mr_status=task_status,
                mapping_rate=0 if is_skipped else project.mapping_rate_per_task,
                validation_rate=0 if is_skipped else project.validation_rate_per_task,
                paid_out=False,
                mapped=True,
                mapped_by=mapper_username or "unknown",
                validated_by="",
                validated=False,
                date_mapped=func.now(),
            )
            stats["tasks_created"] += 1

            mapper = self._resolve_user(mapper_username)
            if mapper:
                created = self._ensure_user_tasks_link(mapper, task_record)
                if created:
                    current_app.logger.info(
                        f"[LINK] Created UserTasks link: user={mapper.id} "
                        f"({mapper.osm_username}) -> task={task_record.id}"
                    )
            else:
                current_app.logger.warning(
                    f"[LINK] NO UserTasks link for task {mr_task_id} — "
                    f"mapper '{mapper_username}' not found in Mikro"
                )

            current_app.logger.info(
                f"Created MR task {mr_task_id} (status={task_status}) "
                f"for challenge {project.id}, mapper={mapper_username}"
            )

        else:
            if mapper_username and task_record.mapped_by in (None, "", "unknown"):
                task_record.mapped_by = mapper_username
                task_record.update()
                mapper = self._resolve_user(mapper_username)
                if mapper:
                    self._ensure_user_tasks_link(mapper, task_record)
                else:
                    current_app.logger.warning(
                        f"[LINK] Update path: mapper '{mapper_username}' NOT FOUND — "
                        f"no UserTasks link for task {mr_task_id}"
                    )
                current_app.logger.info(
                    f"Updated MR task {mr_task_id} mapper: unknown -> {mapper_username}"
                )

            elif mapper_username and task_record.mapped_by == mapper_username:
                mapper = self._resolve_user(mapper_username)
                if mapper:
                    created = self._ensure_user_tasks_link(mapper, task_record)
                    if created:
                        current_app.logger.info(
                            f"[LINK] REPAIR: task {mr_task_id} had mapped_by='{mapper_username}' "
                            f"but no UserTasks link — created one for user={mapper.id}"
                        )
                        stats.setdefault("links_repaired", 0)
                        stats["links_repaired"] += 1

        return task_record

    # ------------------------------------------------------------------
    # Public sync entry point
    # ------------------------------------------------------------------

    def sync_challenge_tasks(self, project):
        """
        Sync all actionable tasks from a MapRoulette challenge into Mikro.

        Fetches tasks, retrieves their history in parallel, then creates or
        updates Task records and UserTasks links. Review history drives
        validation/invalidation logic identical to TM4.
        """
        challenge_id = project.id
        base_url = self._get_mr_base_url()
        headers = self._get_mr_headers()

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

        actionable_tasks = self._fetch_actionable_tasks(challenge_id, base_url, headers)
        current_app.logger.info(
            f"MR challenge {challenge_id}: found {len(actionable_tasks)} actionable tasks"
        )

        if not actionable_tasks:
            project.update(last_sync_cursor=datetime.now(timezone.utc))
            return {"message": "No actionable tasks found", **stats}

        task_ids = [t["id"] for t in actionable_tasks if t.get("id")]
        histories = self._fetch_all_histories(task_ids, base_url, headers)

        for mr_task in actionable_tasks:
            mr_task_id = mr_task.get("id")
            if not mr_task_id:
                continue
            try:
                history = histories.get(mr_task_id, [])
                stats["tasks_processed"] += 1

                task_status = mr_task.get("status", MR_STATUS_FIXED)
                mapper_username = self._extract_mapper_from_history(
                    history, mr_task_id, target_status=task_status
                )
                reviewer_username, review_status = self._extract_review_from_history(history)

                task_record = self._upsert_task(mr_task, project, mapper_username, stats)

                if review_status is not None:
                    self._process_review(
                        task_record=task_record,
                        mapper_username=mapper_username,
                        reviewer_username=reviewer_username,
                        review_status=review_status,
                        stats=stats,
                    )

            except Exception as e:
                current_app.logger.error(
                    f"Error processing MR task {mr_task_id} in challenge {challenge_id}: {e}"
                )
                db.session.rollback()
                stats["errors"] += 1

        self._refresh_total_tasks(project, base_url, headers)

        try:
            project.update(last_sync_cursor=datetime.now(timezone.utc))
        except Exception as e:
            current_app.logger.error(
                f"Failed to update last_sync_cursor for project {project.id}: {e}"
            )

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
    # History parsing
    # ------------------------------------------------------------------

    def _extract_mapper_from_history(self, history, mr_task_id, target_status=MR_STATUS_FIXED):
        """
        Return the OSM username of whoever set the task to target_status.

        Looks for actionType=1 (status change) entries where status matches.
        """
        if not history:
            return None

        for action in history:
            try:
                if (action.get("actionType") == MR_ACTION_STATUS_CHANGE
                        and action.get("status") == target_status):
                    user_obj = action.get("user", {})
                    if isinstance(user_obj, dict):
                        osm_profile = user_obj.get("osmProfile", {})
                        if isinstance(osm_profile, dict):
                            display_name = osm_profile.get("displayName")
                            if display_name:
                                return display_name
                        username = user_obj.get("username")
                        if username:
                            return username
                    username = action.get("username")
                    if username:
                        return username
            except (TypeError, AttributeError, KeyError):
                continue

        action_summary = [
            f"type={a.get('actionType')},status={a.get('status')}"
            for a in history[:5]
        ]
        current_app.logger.warning(
            f"[EXTRACT] Could not determine mapper for MR task {mr_task_id} "
            f"(target_status={target_status}). Actions: [{'; '.join(action_summary)}]"
        )
        return None

    def _extract_review_from_history(self, history):
        """
        Return (reviewer_username, review_status) from the most recent review action.

        Returns (None, None) if no review action exists.
        """
        if not history:
            return None, None

        latest_review = None
        latest_review_time = None

        for action in history:
            try:
                if action.get("actionType") != MR_ACTION_REVIEW:
                    continue
                action_time = self._parse_date(action.get("created"))
                if latest_review is None or (
                    action_time and latest_review_time and action_time > latest_review_time
                ):
                    latest_review = action
                    latest_review_time = action_time
            except (TypeError, AttributeError, KeyError):
                continue

        if latest_review is None:
            return None, None

        reviewer_username = None
        try:
            user_obj = latest_review.get("user", {})
            if isinstance(user_obj, dict):
                osm_profile = user_obj.get("osmProfile", {})
                if isinstance(osm_profile, dict):
                    reviewer_username = osm_profile.get("displayName")
                if not reviewer_username:
                    reviewer_username = user_obj.get("username")
            if not reviewer_username:
                reviewer_username = latest_review.get("username")
            if not reviewer_username:
                rrb = latest_review.get("reviewRequestedBy", {})
                if isinstance(rrb, dict):
                    reviewer_username = rrb.get("username")
        except (TypeError, AttributeError, KeyError):
            pass

        review_status = latest_review.get("reviewStatus")
        if review_status is None:
            review_status = latest_review.get("status")

        return reviewer_username, review_status

    # ------------------------------------------------------------------
    # Review processing
    # ------------------------------------------------------------------

    def _process_review(
        self, task_record, mapper_username, reviewer_username,
        review_status, stats
    ):
        """
        Apply validation or invalidation to a task based on MR review status.

        Approved/Assisted => validated; Rejected => invalidated.
        Self-validated tasks are marked but not paid.
        """
        if review_status in (MR_REVIEW_APPROVED, MR_REVIEW_ASSISTED):
            if task_record.validated:
                return

            is_self_validated = bool(
                mapper_username and reviewer_username
                and mapper_username == reviewer_username
            )

            task_record.update(
                validated_by=reviewer_username or "",
                unknown_validator=False,
                validated=True,
                invalidated=False,
                self_validated=is_self_validated,
                date_validated=func.now(),
            )

            validator = self._resolve_user(reviewer_username)
            if validator:
                self._ensure_user_tasks_link(validator, task_record)

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

        elif review_status == MR_REVIEW_REJECTED:
            if task_record.invalidated:
                return

            task_record.update(
                validated_by=reviewer_username or "",
                invalidated=True,
                validated=False,
                date_validated=func.now(),
            )

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
        base_url = self._get_mr_base_url()
        headers = self._get_mr_headers()
        url = f"{base_url}/challenge/{challenge_id}"

        try:
            response = requests.get(url, headers=headers, timeout=30)
            if not response.ok:
                current_app.logger.error(
                    f"MR challenge metadata fetch failed for {challenge_id}: "
                    f"HTTP {response.status_code}"
                )
                return None

            data = response.json()
            if not isinstance(data, dict):
                current_app.logger.error(
                    f"MR challenge {challenge_id} returned non-dict: "
                    f"{type(data).__name__} = {data}"
                )
                return None

            name = data.get("name", f"MR Challenge {challenge_id}")
            description = data.get("description", "")

            # MR API does not return a reliable totalTasks field — count by paging.
            task_count = 0
            page = 0
            while True:
                count_url = f"{base_url}/challenge/{challenge_id}/tasks?limit=200&page={page}"
                count_resp = requests.get(count_url, headers=headers, timeout=30)
                if not count_resp.ok:
                    break
                page_tasks = count_resp.json()
                if not isinstance(page_tasks, list) or not page_tasks:
                    break
                task_count += len(page_tasks)
                if len(page_tasks) < 200:
                    break
                page += 1

            return {"name": name, "task_count": task_count, "description": description}

        except requests.RequestException as e:
            current_app.logger.error(
                f"MR API error fetching challenge {challenge_id}: {e}"
            )
            return None
        except (ValueError, KeyError, AttributeError) as e:
            current_app.logger.error(
                f"MR JSON parse error for challenge {challenge_id}: {e}"
            )
            return None
