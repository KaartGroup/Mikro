#!/usr/bin/env python3
"""
Shared split-task helper functions.

Used by both TaskAPI (bulk sync) and WebhookAPI (real-time events)
to ensure consistent behavior for split-task stat counting.
"""

from ..database import Task


def is_split_task(task):
    """Check if a task is a split task segment."""
    return task.parent_task_id is not None


def get_split_siblings(task):
    """
    Get all sibling tasks for a split task.

    Returns list of sibling tasks (including the task itself),
    or empty list if not a split task.
    """
    if not is_split_task(task):
        return []
    return Task.query.filter_by(
        project_id=task.project_id,
        parent_task_id=task.parent_task_id,
    ).all()


def all_siblings_invalidated(task):
    """
    Check if ALL siblings of a split task are invalidated.

    For non-split tasks, always returns True.
    For split tasks, returns True only when ALL siblings are invalidated.
    """
    if not is_split_task(task):
        return True

    siblings = get_split_siblings(task)
    expected_count = task.sibling_count or 4

    if len(siblings) != expected_count:
        return False

    return all(s.invalidated for s in siblings)


def should_count_invalidation(task):
    """
    Determine if this invalidation should be counted toward stats.

    For normal tasks: always count.
    For split tasks: only count when ALL siblings are invalidated.
    """
    if not is_split_task(task):
        return True
    return all_siblings_invalidated(task)
