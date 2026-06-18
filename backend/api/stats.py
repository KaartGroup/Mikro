"""
Shared stat computation helpers — Single Source of Truth (SSOT).

All task/user/project stats AND payment balances are derived from the
Task table (plus PayRequests/Payments for claimed task tracking).
No incremental counter columns are used.

Used by: Projects.py, Users.py, Teams.py, Reports.py, Transactions.py
"""

from .database import Task, UserTasks, db
from sqlalchemy import func, case, and_


def count_tasks_split_aware(tasks, condition_fn=None):
    """
    Count tasks with split-awareness.

    Split task groups (siblings with same parent_task_id) only count as 1
    when ALL siblings are present AND ALL meet the condition.

    Args:
        tasks: List of Task objects to count
        condition_fn: Optional function that takes a task and returns True
                     if it should be counted. If None, counts all tasks.

    Returns:
        Effective count where split groups count as 1 only when ALL siblings
        are present and meet condition
    """
    if condition_fn is None:
        condition_fn = lambda t: True

    normal_tasks = [t for t in tasks if not t.parent_task_id]
    split_tasks = [t for t in tasks if t.parent_task_id]

    normal_count = len([t for t in normal_tasks if condition_fn(t)])

    split_groups = {}
    for task in split_tasks:
        split_groups.setdefault(task.parent_task_id, []).append(task)

    split_count = 0
    for parent_id, siblings in split_groups.items():
        expected_count = siblings[0].sibling_count if siblings[0].sibling_count else 4
        if len(siblings) == expected_count and all(condition_fn(t) for t in siblings):
            split_count += 1

    return normal_count + split_count


def get_project_stats_from_tasks(tasks):
    """
    Compute task stats from a pre-loaded list of tasks.

    Use this when you already have the tasks loaded to avoid a second query.
    """
    return _compute_task_stats(tasks)


def get_batch_project_stats(project_ids):
    """
    Live-count task stats for multiple projects in one query.

    Returns dict of {project_id: {tasks_mapped, tasks_validated, tasks_invalidated}}.
    """
    if not project_ids:
        return {}

    all_tasks = Task.query.filter(Task.project_id.in_(project_ids)).all()

    tasks_by_project = {}
    for t in all_tasks:
        tasks_by_project.setdefault(t.project_id, []).append(t)

    result = {}
    for pid in project_ids:
        result[pid] = _compute_task_stats(tasks_by_project.get(pid, []))
    return result


def get_user_task_stats(user, all_org_tasks=None):
    """
    Live-count task stats for a user from the Task table.

    Args:
        user: User model instance
        all_org_tasks: Optional pre-loaded list of all org tasks (for batch use).
                       If None, queries the DB.

    Returns dict with:
        total_tasks_mapped, total_tasks_validated, total_tasks_invalidated,
        validator_tasks_validated, validator_tasks_invalidated

    NOTE: Payment balances are NOT included here — use PaymentBalanceService.user_balances().
    """
    user_task_ids = set(
        ut.task_id for ut in UserTasks.query.filter_by(user_id=user.id).all()
    )

    if all_org_tasks is None:
        all_org_tasks = Task.query.filter_by(org_id=user.org_id).all()

    user_tasks = [t for t in all_org_tasks if t.id in user_task_ids]

    mapped_cond = lambda t: t.mapped and not t.validated and not t.invalidated
    validated_cond = lambda t: t.mapped and t.validated
    invalidated_cond = lambda t: t.mapped and t.invalidated

    total_mapped = count_tasks_split_aware(user_tasks, mapped_cond)
    total_validated = count_tasks_split_aware(user_tasks, validated_cond)
    total_invalidated = count_tasks_split_aware(user_tasks, invalidated_cond)

    osm_un = user.osm_username

    validator_validated = count_tasks_split_aware(
        all_org_tasks,
        lambda t: t.validated and t.validated_by == osm_un and not t.self_validated,
    )
    validator_invalidated = count_tasks_split_aware(
        all_org_tasks,
        lambda t: t.invalidated and t.validated_by == osm_un,
    )

    return {
        "total_tasks_mapped": total_mapped,
        "total_tasks_validated": total_validated,
        "total_tasks_invalidated": total_invalidated,
        "validator_tasks_validated": validator_validated,
        "validator_tasks_invalidated": validator_invalidated,
    }


def get_batch_user_task_stats(users, org_id):
    """
    Live-count task stats for multiple users in one query batch.

    Loads all org tasks and UserTasks once, then computes per-user.

    Returns dict of {user_id: stats_dict}.
    """
    all_org_tasks = Task.query.filter_by(org_id=org_id).all()

    # Batch-load all UserTasks for these users
    user_ids = [u.id for u in users]
    all_user_tasks = (
        UserTasks.query.filter(UserTasks.user_id.in_(user_ids)).all()
        if user_ids
        else []
    )

    user_task_map = {}
    for ut in all_user_tasks:
        user_task_map.setdefault(ut.user_id, set()).add(ut.task_id)

    result = {}
    for user in users:
        task_ids = user_task_map.get(user.id, set())
        user_tasks = [t for t in all_org_tasks if t.id in task_ids]
        osm_un = user.osm_username

        mapped_cond = lambda t: t.mapped and not t.validated and not t.invalidated
        validated_cond = lambda t: t.mapped and t.validated
        invalidated_cond = lambda t: t.mapped and t.invalidated

        total_mapped = count_tasks_split_aware(user_tasks, mapped_cond)
        total_validated = count_tasks_split_aware(user_tasks, validated_cond)
        total_invalidated = count_tasks_split_aware(user_tasks, invalidated_cond)

        # Capture osm_un in closure properly
        def _make_val_cond(un):
            return (
                lambda t: t.validated and t.validated_by == un and not t.self_validated
            )

        def _make_inv_cond(un):
            return lambda t: t.invalidated and t.validated_by == un

        validator_validated = count_tasks_split_aware(
            all_org_tasks, _make_val_cond(osm_un)
        )
        validator_invalidated = count_tasks_split_aware(
            all_org_tasks, _make_inv_cond(osm_un)
        )

        result[user.id] = {
            "total_tasks_mapped": total_mapped,
            "total_tasks_validated": total_validated,
            "total_tasks_invalidated": total_invalidated,
            "validator_tasks_validated": validator_validated,
            "validator_tasks_invalidated": validator_invalidated,
        }

    return result


def _compute_task_stats(tasks):
    """Internal helper: compute split-aware mapped/validated/invalidated from a task list."""
    mapped_cond = lambda t: t.mapped and not t.validated and not t.invalidated
    validated_cond = lambda t: t.mapped and t.validated
    invalidated_cond = lambda t: t.invalidated

    return {
        "tasks_mapped": count_tasks_split_aware(tasks, mapped_cond),
        "tasks_validated": count_tasks_split_aware(tasks, validated_cond),
        "tasks_invalidated": count_tasks_split_aware(tasks, invalidated_cond),
    }


def get_batch_user_task_stats_fast(users, org_id):
    """
    Fast SQL-aggregated task stats for multiple users.

    Uses GROUP BY instead of loading all tasks into Python.
    Does NOT use split-aware counting (acceptable for list views).

    Returns dict of {user_id: stats_dict}.
    """
    user_ids = [u.id for u in users]
    if not user_ids:
        return {}

    # Mapper stats: count tasks assigned to each user by status
    mapper_rows = (
        db.session.query(
            UserTasks.user_id,
            func.count(
                case(
                    (
                        and_(
                            Task.mapped == True,
                            Task.validated == False,
                            Task.invalidated == False,
                        ),
                        1,
                    ),
                )
            ).label("mapped"),
            func.count(
                case(
                    (and_(Task.mapped == True, Task.validated == True), 1),
                )
            ).label("validated"),
            func.count(
                case(
                    (Task.invalidated == True, 1),
                )
            ).label("invalidated"),
        )
        .join(Task, Task.id == UserTasks.task_id)
        .filter(UserTasks.user_id.in_(user_ids))
        .group_by(UserTasks.user_id)
        .all()
    )

    mapper_map = {}
    for row in mapper_rows:
        mapper_map[row.user_id] = {
            "total_tasks_mapped": row.mapped or 0,
            "total_tasks_validated": row.validated or 0,
            "total_tasks_invalidated": row.invalidated or 0,
        }

    # Validator stats: count tasks validated BY each user (by osm_username)
    osm_usernames = [u.osm_username for u in users if u.osm_username]
    validator_map = {}

    if osm_usernames:
        validator_rows = (
            db.session.query(
                Task.validated_by,
                func.count(
                    case(
                        (and_(Task.validated == True, Task.self_validated == False), 1),
                    )
                ).label("val_validated"),
                func.count(
                    case(
                        (Task.invalidated == True, 1),
                    )
                ).label("val_invalidated"),
            )
            .filter(
                Task.org_id == org_id,
                Task.validated_by.in_(osm_usernames),
            )
            .group_by(Task.validated_by)
            .all()
        )

        for row in validator_rows:
            validator_map[row.validated_by] = {
                "validator_tasks_validated": row.val_validated or 0,
                "validator_tasks_invalidated": row.val_invalidated or 0,
            }

    # Merge mapper + validator stats
    result = {}
    for user in users:
        m = mapper_map.get(user.id, {})
        v = validator_map.get(user.osm_username, {})
        result[user.id] = {
            "total_tasks_mapped": m.get("total_tasks_mapped", 0),
            "total_tasks_validated": m.get("total_tasks_validated", 0),
            "total_tasks_invalidated": m.get("total_tasks_invalidated", 0),
            "validator_tasks_validated": v.get("validator_tasks_validated", 0),
            "validator_tasks_invalidated": v.get("validator_tasks_invalidated", 0),
        }

    return result


def get_batch_project_stats_fast(project_ids, org_id=None):
    """
    Fast SQL-aggregated task stats for multiple projects.

    Single query with GROUP BY project_id instead of N queries.
    Returns dict of {project_id: {mapped, validated, invalidated, mr_status_breakdown}}.
    """
    if not project_ids:
        return {}

    # Task counts per project — single query
    rows = (
        db.session.query(
            Task.project_id,
            func.count(
                case(
                    (
                        and_(
                            Task.mapped == True,
                            Task.validated == False,
                            Task.invalidated == False,
                        ),
                        1,
                    ),
                )
            ).label("mapped"),
            func.count(
                case(
                    (and_(Task.mapped == True, Task.validated == True), 1),
                )
            ).label("validated"),
            func.count(
                case(
                    (Task.invalidated == True, 1),
                )
            ).label("invalidated"),
        )
        .filter(Task.project_id.in_(project_ids))
        .group_by(Task.project_id)
        .all()
    )

    result = {}
    for row in rows:
        result[row.project_id] = {
            "effective_mapped": row.mapped or 0,
            "effective_validated": row.validated or 0,
            "effective_invalidated": row.invalidated or 0,
            "raw_mapped": row.mapped or 0,
            "raw_validated": row.validated or 0,
            "raw_invalidated": row.invalidated or 0,
            "split_task_groups": 0,
            "split_task_count": 0,
        }

    # MR status breakdown per project — separate query for MR projects only
    mr_rows = (
        db.session.query(
            Task.project_id,
            Task.mr_status,
            func.count().label("cnt"),
        )
        .filter(
            Task.project_id.in_(project_ids),
            Task.mr_status != None,
        )
        .group_by(Task.project_id, Task.mr_status)
        .all()
    )

    mr_map = {}
    for row in mr_rows:
        mr_map.setdefault(row.project_id, {})[row.mr_status] = row.cnt

    for pid in result:
        result[pid]["mr_status_breakdown"] = mr_map.get(pid, {})

    return result
