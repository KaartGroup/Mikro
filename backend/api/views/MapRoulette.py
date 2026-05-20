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
        """
        Build request headers for MapRoulette API calls.

        Returns:
            dict: Headers dict containing the MR API key.
        """
        api_key = current_app.config.get("MR_API_KEY")
        return {"apiKey": api_key}

    def _get_mr_base_url(self):
        """
        Get the MapRoulette API v2 base URL from app config.

        Falls back to the public MapRoulette instance if not configured.

        Returns:
            str: Base URL for MR API v2 (no trailing slash).
        """
        return current_app.config.get(
            "MR_API_URL", "https://maproulette.org/api/v2"
        )

    def _parse_date(self, date_str):
        """
        Parse an ISO 8601 date string into a timezone-aware datetime.

        Handles multiple ISO formats defensively. Returns None on any
        parsing failure rather than raising.

        Args:
            date_str: ISO 8601 date string (e.g. "2024-01-15T12:30:00.000Z").

        Returns:
            datetime or None: Parsed datetime, or None on failure.
        """
        if not date_str:
            return None
        try:
            # Handle trailing Z (common in MR responses)
            cleaned = date_str.replace("Z", "+00:00")
            return datetime.fromisoformat(cleaned)
        except (ValueError, TypeError, AttributeError):
            try:
                # Fallback: try strptime for other common formats
                return datetime.strptime(date_str, "%Y-%m-%dT%H:%M:%S.%f%z")
            except (ValueError, TypeError):
                current_app.logger.warning(
                    f"Could not parse date string: {date_str}"
                )
                return None

    def _resolve_user(self, osm_username):
        """
        Look up a Mikro user by their OSM username.

        Args:
            osm_username: The OpenStreetMap username to search for.

        Returns:
            User or None: The matching Mikro user, or None if not found.
        """
        if not osm_username:
            current_app.logger.debug("[RESOLVE] Called with empty username, returning None")
            return None

        # Exact match first
        user = User.query.filter_by(osm_username=osm_username).first()
        return user

    def _fetch_task_history(self, task_id, base_url=None, headers=None, app=None):
        """
        Fetch the action history for a single MapRoulette task.

        Calls GET /task/{task_id}/history with error handling.
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
                        f"MR task history for {task_id} returned non-list: "
                        f"{type(data)}"
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
                app.logger.error(
                    f"MR API error fetching history for task {task_id}: {e}"
                )
            return []
        except (ValueError, KeyError) as e:
            if app:
                app.logger.error(
                    f"MR JSON parse error for task {task_id} history: {e}"
                )
            return []
        finally:
            if app:
                ctx.pop()

    def fetch_challenge_metadata(self, challenge_id):
        """
        Fetch metadata for a MapRoulette challenge.

        Retrieves the challenge name, description, and task count from the
        MR API. Used when adding a new MR project to Mikro.

        Args:
            challenge_id: The MR challenge ID.

        Returns:
            dict or None: Dict with keys 'name', 'task_count', 'description',
                or None if the API call fails.
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

            # MR API does NOT return a reliable totalTasks field.
            # Count all tasks by paginating the challenge tasks endpoint.
            base_url = self._get_mr_base_url()
            headers = self._get_mr_headers()
            task_count = 0
            count_page = 0
            while True:
                count_url = f"{base_url}/challenge/{challenge_id}/tasks?limit=200&page={count_page}"
                count_resp = requests.get(count_url, headers=headers, timeout=30)
                if not count_resp.ok:
                    break
                page_tasks = count_resp.json()
                if not isinstance(page_tasks, list) or len(page_tasks) == 0:
                    break
                task_count += len(page_tasks)
                if len(page_tasks) < 200:
                    break
                count_page += 1

            return {
                "name": name,
                "task_count": task_count,
                "description": description,
            }
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

    def sync_challenge_tasks(self, project, user=None):
        """
        Core sync: fetch all Fixed tasks from a MapRoulette challenge and
        reconcile them with Mikro's task/payment records.

        Algorithm:
        1. Paginate all tasks from the challenge endpoint.
        2. Filter to Fixed tasks (status=1).
        3. For each Fixed task, fetch history in parallel (ThreadPoolExecutor).
        4. Parse history to find mapper (who set status to Fixed).
        5. Create/update Task records in Mikro.
        6. Check review status from history for validation/invalidation.
        7. Apply payment logic identical to TM4.
        8. Update project.last_sync_cursor on completion.

        Note: Stat counter columns on User/Project (e.g. total_tasks_mapped)
        are NOT written here -- stats are live-queried from the Task table.
        Payment balances are also derived from the Task table + PayRequests/Payments.

        Args:
            project: The Mikro Project record (source="mr", id=challenge_id).
            user: Optional User to filter sync to. If None, syncs all users.

        Returns:
            dict: Summary with keys 'message', 'tasks_processed',
                'tasks_created', 'tasks_validated', 'tasks_invalidated',
                'errors'.
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
            f"Starting MR sync for challenge {challenge_id} "
            f"(project: {project.name})"
        )

        # -----------------------------------------------------------
        # Step 1: Paginate all tasks from the challenge
        # -----------------------------------------------------------
        all_actionable_tasks = []
        page = 0
        limit = 50

        while True:
            url = (
                f"{base_url}/challenge/{challenge_id}/tasks"
                f"?limit={limit}&page={page}"
            )
            try:
                response = requests.get(url, headers=headers, timeout=60)
                if not response.ok:
                    current_app.logger.error(
                        f"MR task list fetch failed for challenge "
                        f"{challenge_id} page {page}: "
                        f"HTTP {response.status_code}"
                    )
                    break

                tasks_page = response.json()
                if not isinstance(tasks_page, list) or len(tasks_page) == 0:
                    break

                # Filter to all trackable statuses (Fixed, FalsePositive, Skipped, AlreadyFixed, CantComplete)
                for t in tasks_page:
                    try:
                        if t.get("status") in MR_TRACKABLE_STATUSES:
                            all_actionable_tasks.append(t)
                    except (TypeError, AttributeError):
                        continue

                # If we got fewer than limit, we've reached the last page
                if len(tasks_page) < limit:
                    break

                page += 1

            except requests.RequestException as e:
                current_app.logger.error(
                    f"MR API error listing tasks for challenge "
                    f"{challenge_id} page {page}: {e}"
                )
                break
            except (ValueError, KeyError) as e:
                current_app.logger.error(
                    f"MR JSON parse error for challenge "
                    f"{challenge_id} page {page}: {e}"
                )
                break

        current_app.logger.info(
            f"MR challenge {challenge_id}: found {len(all_actionable_tasks)} "
            f"actionable tasks"
        )

        if not all_actionable_tasks:
            project.update(last_sync_cursor=datetime.now(timezone.utc))
            return {"message": "No actionable tasks found", **stats}

        # -----------------------------------------------------------
        # Step 2: Fetch history for each actionable task in parallel
        # -----------------------------------------------------------
        task_histories = {}

        # Process in batches to respect rate limiting
        batch_size = 3  # Matches ThreadPoolExecutor max_workers
        task_ids = [t.get("id") for t in all_actionable_tasks if t.get("id")]

        # Resolve these BEFORE spawning threads (they need current_app)
        mr_base_url = self._get_mr_base_url()
        mr_headers = self._get_mr_headers()
        app = current_app._get_current_object()

        for batch_start in range(0, len(task_ids), batch_size):
            batch = task_ids[batch_start : batch_start + batch_size]

            with ThreadPoolExecutor(max_workers=3) as executor:
                future_to_task = {
                    executor.submit(
                        self._fetch_task_history, tid,
                        base_url=mr_base_url, headers=mr_headers, app=app,
                    ): tid
                    for tid in batch
                }

                for future in as_completed(future_to_task):
                    tid = future_to_task[future]
                    try:
                        history = future.result()
                        task_histories[tid] = history
                    except Exception as e:
                        current_app.logger.error(
                            f"MR history fetch exception for task {tid}: {e}"
                        )
                        task_histories[tid] = []
                        stats["errors"] += 1

            # Rate limiting: 50ms sleep between batches
            time.sleep(0.05)

        # -----------------------------------------------------------
        # Step 3: Process each actionable task
        # -----------------------------------------------------------
        # Verbose logging for user-scoped sync
        user_filter_name = f"{user.osm_username} (id={user.id})" if user else "ALL"
        current_app.logger.info(
            f"[SYNC-DEBUG] Processing {len(all_actionable_tasks)} tasks "
            f"for challenge {challenge_id}, user filter: {user_filter_name}"
        )
        skipped_wrong_user = 0
        skipped_no_mapper = 0

        for mr_task in all_actionable_tasks:
            try:
                mr_task_id = mr_task.get("id")
                if not mr_task_id:
                    continue

                history = task_histories.get(mr_task_id, [])
                stats["tasks_processed"] += 1

                # Parse history to find mapper and reviewer
                task_status = mr_task.get("status", MR_STATUS_FIXED)
                mapper_username = self._extract_mapper_from_history(
                    history, mr_task_id, target_status=task_status
                )
                reviewer_username, review_status = (
                    self._extract_review_from_history(history, mr_task_id)
                )

                # If user filter is set, skip tasks not involving that user
                if user:
                    if not mapper_username and not history:
                        skipped_no_mapper += 1
                        current_app.logger.debug(
                            f"[SYNC-DEBUG] Task {mr_task_id}: no history returned, "
                            f"mapper=None"
                        )
                    elif not mapper_username:
                        skipped_no_mapper += 1
                        current_app.logger.debug(
                            f"[SYNC-DEBUG] Task {mr_task_id}: history has "
                            f"{len(history)} entries but no mapper extracted"
                        )

                    mapper_obj = self._resolve_user(mapper_username)
                    if mapper_obj and mapper_obj.id != user.id:
                        # Also check if user is the reviewer
                        reviewer_obj = self._resolve_user(reviewer_username)
                        if not reviewer_obj or reviewer_obj.id != user.id:
                            skipped_wrong_user += 1
                            continue

                    # Log what we're seeing for this user
                    if mapper_username:
                        resolved = "MATCHED" if (mapper_obj and mapper_obj.id == user.id) else (
                            f"RESOLVED to {mapper_obj.osm_username} (id={mapper_obj.id})" if mapper_obj else
                            f"NOT FOUND in Mikro"
                        )
                        current_app.logger.info(
                            f"[SYNC-DEBUG] Task {mr_task_id}: MR mapper='{mapper_username}', "
                            f"user filter='{user.osm_username}', resolve={resolved}"
                        )

                # -------------------------------------------------
                # Step 4: Create or update Task record
                # -------------------------------------------------
                task_record = Task.query.filter_by(
                    task_id=mr_task_id, project_id=project.id
                ).first()

                if task_record is None:
                    # Skipped tasks: tracked but not paid (rate=0)
                    # All other statuses: paid at project rate
                    is_skipped = task_status == MR_STATUS_SKIPPED
                    effective_mapping_rate = 0 if is_skipped else project.mapping_rate_per_task
                    effective_validation_rate = 0 if is_skipped else project.validation_rate_per_task

                    # Create new task -- no parent_task_id for MR
                    task_record = Task.create(
                        task_id=mr_task_id,
                        project_id=project.id,
                        org_id=project.org_id,
                        source="mr",
                        mr_status=task_status,
                        mapping_rate=effective_mapping_rate,
                        validation_rate=effective_validation_rate,
                        paid_out=False,
                        mapped=True,
                        mapped_by=mapper_username or "unknown",
                        validated_by="",
                        validated=False,
                        date_mapped=func.now(),
                    )
                    stats["tasks_created"] += 1

                    # Link mapper to task via UserTasks
                    mapper = self._resolve_user(mapper_username)
                    if mapper:
                        existing_link = UserTasks.query.filter_by(
                            user_id=mapper.id, task_id=task_record.id
                        ).first()
                        if not existing_link:
                            UserTasks.create(
                                user_id=mapper.id, task_id=task_record.id
                            )
                            current_app.logger.info(
                                f"[LINK] Created UserTasks link: user={mapper.id} "
                                f"({mapper.osm_username}) -> task={task_record.id}"
                            )
                        else:
                            current_app.logger.debug(
                                f"[LINK] UserTasks link already exists: user={mapper.id} -> task={task_record.id}"
                            )
                    else:
                        current_app.logger.warning(
                            f"[LINK] NO UserTasks link created for task {mr_task_id} — "
                            f"mapper '{mapper_username}' could not be resolved to a Mikro user"
                        )

                    current_app.logger.info(
                        f"Created MR task {mr_task_id} (status={task_status}) "
                        f"for challenge {challenge_id}, mapper={mapper_username}"
                    )

                else:
                    # Task exists — update mapper if we now have a valid one
                    current_app.logger.debug(
                        f"[SYNC-DEBUG] Task {mr_task_id} EXISTS: "
                        f"mapped_by='{task_record.mapped_by}', "
                        f"new mapper='{mapper_username}'"
                    )
                    if mapper_username and task_record.mapped_by in (None, "", "unknown"):
                        task_record.mapped_by = mapper_username
                        task_record.update()
                        # Also create UserTasks link if missing
                        mapper = self._resolve_user(mapper_username)
                        if mapper:
                            existing_link = UserTasks.query.filter_by(
                                user_id=mapper.id, task_id=task_record.id
                            ).first()
                            if not existing_link:
                                UserTasks.create(
                                    user_id=mapper.id, task_id=task_record.id
                                )
                                current_app.logger.info(
                                    f"[LINK] Created UserTasks link (update path): "
                                    f"user={mapper.id} ({mapper.osm_username}) -> task={task_record.id}"
                                )
                        else:
                            current_app.logger.warning(
                                f"[LINK] Update path: mapper '{mapper_username}' NOT FOUND — "
                                f"no UserTasks link for task {mr_task_id}"
                            )
                        current_app.logger.info(
                            f"Updated MR task {mr_task_id} mapper: "
                            f"unknown -> {mapper_username}"
                        )
                    elif mapper_username and task_record.mapped_by == mapper_username:
                        # Task already attributed correctly — but check if UserTasks link exists
                        mapper = self._resolve_user(mapper_username)
                        if mapper:
                            existing_link = UserTasks.query.filter_by(
                                user_id=mapper.id, task_id=task_record.id
                            ).first()
                            if not existing_link:
                                UserTasks.create(
                                    user_id=mapper.id, task_id=task_record.id
                                )
                                current_app.logger.info(
                                    f"[LINK] REPAIR: task {mr_task_id} had mapped_by='{mapper_username}' "
                                    f"but NO UserTasks link — created one for user={mapper.id}"
                                )
                                stats.setdefault("links_repaired", 0)
                                stats["links_repaired"] += 1

                # -------------------------------------------------
                # Step 5: Process review status (validation/invalidation)
                # -------------------------------------------------
                if review_status is not None:
                    self._process_review(
                        task_record=task_record,
                        project=project,
                        mapper_username=mapper_username,
                        reviewer_username=reviewer_username,
                        review_status=review_status,
                        stats=stats,
                    )

            except Exception as e:
                current_app.logger.error(
                    f"Error processing MR task {mr_task.get('id')} in "
                    f"challenge {challenge_id}: {e}"
                )
                db.session.rollback()
                stats["errors"] += 1

        # -----------------------------------------------------------
        # Step 6: Count ALL tasks in challenge + update sync cursor
        # -----------------------------------------------------------
        # The MR API does not return a reliable total task count field.
        # We must paginate the challenge tasks endpoint and count everything
        # (including Created/non-trackable tasks) to get the true total.
        try:
            total_count = 0
            count_page = 0
            count_limit = 200
            while True:
                count_url = (
                    f"{base_url}/challenge/{challenge_id}/tasks"
                    f"?limit={count_limit}&page={count_page}"
                )
                count_resp = requests.get(count_url, headers=headers, timeout=30)
                if not count_resp.ok:
                    break
                page_tasks = count_resp.json()
                if not isinstance(page_tasks, list) or len(page_tasks) == 0:
                    break
                total_count += len(page_tasks)
                if len(page_tasks) < count_limit:
                    break
                count_page += 1

            if total_count > 0:
                project.total_tasks = total_count
                current_app.logger.info(
                    f"MR challenge {challenge_id}: updated total_tasks to {total_count}"
                )
        except Exception as e:
            current_app.logger.warning(
                f"Could not refresh total_tasks for MR challenge "
                f"{challenge_id}: {e}"
            )

        try:
            project.update(last_sync_cursor=datetime.now(timezone.utc))
        except Exception as e:
            current_app.logger.error(
                f"Failed to update last_sync_cursor for project "
                f"{project.id}: {e}"
            )

        current_app.logger.info(
            f"MR sync complete for challenge {challenge_id}: "
            f"processed={stats['tasks_processed']}, "
            f"created={stats['tasks_created']}, "
            f"validated={stats['tasks_validated']}, "
            f"invalidated={stats['tasks_invalidated']}, "
            f"errors={stats['errors']}"
        )
        if user:
            current_app.logger.info(
                f"[SYNC-DEBUG] User filter summary for '{user.osm_username}': "
                f"total_actionable={len(all_actionable_tasks)}, "
                f"skipped_wrong_user={skipped_wrong_user}, "
                f"skipped_no_mapper={skipped_no_mapper}, "
                f"processed={stats['tasks_processed']}"
            )

        return {"message": "sync complete", **stats}

    def _extract_mapper_from_history(self, history, mr_task_id, target_status=MR_STATUS_FIXED):
        """
        Parse task history to find who set the task to the given status.

        Looks for status change actions (actionType=1) where the resulting
        status matches target_status. Returns the OSM display name of the
        user who performed that action.

        Args:
            history: List of history action dicts from the MR API.
            mr_task_id: The MR task ID (for logging).
            target_status: The MR status code to look for (default: Fixed=1).

        Returns:
            str or None: OSM username of the mapper, or None if not found.
        """
        if not history:
            return None

        # Dump first task's full history for debugging
        if not hasattr(self, '_dumped_sample') or not self._dumped_sample:
            import json
            current_app.logger.info(
                f"[SYNC-DEBUG] SAMPLE HISTORY for task {mr_task_id} "
                f"(target_status={target_status}): "
                f"{json.dumps(history[:3], default=str)[:2000]}"
            )
            self._dumped_sample = True

        for action in history:
            try:
                action_type = action.get("actionType")
                status = action.get("status")

                # Look for status change to the target status
                if action_type == MR_ACTION_STATUS_CHANGE and status == target_status:
                    user_obj = action.get("user", {})
                    if isinstance(user_obj, dict):
                        # Try osmProfile.displayName first (some MR API versions)
                        osm_profile = user_obj.get("osmProfile", {})
                        if isinstance(osm_profile, dict):
                            display_name = osm_profile.get("displayName")
                            if display_name:
                                return display_name

                        # Try user.username directly (current MR API format)
                        user_username = user_obj.get("username")
                        if user_username:
                            return user_username

                    # Fallback: check for username directly on action
                    username = action.get("username")
                    if username:
                        return username

            except (TypeError, AttributeError, KeyError):
                continue

        # Log all action types found in history for debugging
        action_summary = [
            f"type={a.get('actionType')},status={a.get('status')},user={a.get('user',{}).get('osmProfile',{}).get('displayName','?') if isinstance(a.get('user'),dict) else a.get('username','?')}"
            for a in (history or [])[:5]
        ]
        current_app.logger.warning(
            f"[EXTRACT] Could not determine mapper from history for MR task "
            f"{mr_task_id} (target_status={target_status}). "
            f"History actions: [{'; '.join(action_summary)}]"
        )
        return None

    def _extract_review_from_history(self, history, mr_task_id):
        """
        Parse task history to find the latest review action and reviewer.

        Looks for review actions (actionType=2) and returns the reviewer's
        OSM username along with the review status code.

        Args:
            history: List of history action dicts from the MR API.
            mr_task_id: The MR task ID (for logging).

        Returns:
            tuple: (reviewer_username, review_status) where review_status is
                an int (MR_REVIEW_*) or None if no review found. Both values
                may be None if no review action exists.
        """
        if not history:
            return None, None

        # Find the most recent review action
        latest_review = None
        latest_review_time = None

        for action in history:
            try:
                action_type = action.get("actionType")
                if action_type != MR_ACTION_REVIEW:
                    continue

                created = action.get("created")
                action_time = self._parse_date(created) if created else None

                # Keep the most recent review
                if latest_review is None or (
                    action_time
                    and latest_review_time
                    and action_time > latest_review_time
                ):
                    latest_review = action
                    latest_review_time = action_time

            except (TypeError, AttributeError, KeyError):
                continue

        if latest_review is None:
            return None, None

        # Extract reviewer username
        reviewer_username = None
        try:
            user_obj = latest_review.get("user", {})
            if isinstance(user_obj, dict):
                # Try osmProfile.displayName first (some MR API versions)
                osm_profile = user_obj.get("osmProfile", {})
                if isinstance(osm_profile, dict):
                    reviewer_username = osm_profile.get("displayName")

                # Try user.username directly (current MR API format)
                if not reviewer_username:
                    reviewer_username = user_obj.get("username")

            # Fallback: check for username directly on action
            if not reviewer_username:
                reviewer_username = latest_review.get("username")

            # Also check reviewRequestedBy for the mapper username
            if not reviewer_username:
                rrb = latest_review.get("reviewRequestedBy", {})
                if isinstance(rrb, dict):
                    reviewer_username = rrb.get("username")
        except (TypeError, AttributeError, KeyError):
            pass

        # Extract review status
        review_status = latest_review.get("reviewStatus")
        if review_status is None:
            review_status = latest_review.get("status")

        return reviewer_username, review_status

    def _process_review(
        self, task_record, project, mapper_username, reviewer_username,
        review_status, stats
    ):
        """
        Apply validation or invalidation logic based on MR review status.

        Updates Task records and creates UserTasks links.

        - Approved/Assisted: task is marked validated, UserTasks link created
          for validator.
        - Rejected: task is marked invalidated.

        Args:
            task_record: The Mikro Task record.
            project: The Mikro Project record.
            mapper_username: OSM username of the mapper.
            reviewer_username: OSM username of the reviewer.
            review_status: MR review status code (int).
            stats: Mutable stats dict to update counters.
        """
        # -----------------------------------------------------------
        # Approved (1) or Assisted (3) => validated
        # -----------------------------------------------------------
        if review_status in (MR_REVIEW_APPROVED, MR_REVIEW_ASSISTED):
            if task_record.validated:
                return  # Already processed

            # Detect self-validation
            is_self_validated = (
                mapper_username
                and reviewer_username
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

            # Create UserTasks link for validator
            validator = self._resolve_user(reviewer_username)
            if validator:
                existing_link = UserTasks.query.filter_by(
                    user_id=validator.id, task_id=task_record.id
                ).first()
                if not existing_link:
                    UserTasks.create(
                        user_id=validator.id, task_id=task_record.id
                    )

            # Skip payment for self-validated tasks
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

        # -----------------------------------------------------------
        # Rejected (2) => invalidated
        # -----------------------------------------------------------
        elif review_status == MR_REVIEW_REJECTED:
            if task_record.invalidated:
                return  # Already processed

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
