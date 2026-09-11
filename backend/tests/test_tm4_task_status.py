"""
Tests for _apply_tm4_task_status — the invalidation logic lifted out of the
per-task fetch loop so those requests could run concurrently.

Moving logic is where regressions hide, so these pin the behaviour down. They
use a stand-in task object rather than a Task row, so no database is needed:
a non-split task short-circuits should_count_invalidation before it queries
siblings, and only the logger needs an app context.
"""

import pytest

from app import app as flask_app
from api.views.Tasks import TaskAPI


class _FakeTask:
    """Records .update() kwargs instead of writing to the database."""

    def __init__(self, task_id=4242, parent_task_id=None):
        self.task_id = task_id
        self.parent_task_id = parent_task_id
        self.sibling_count = None
        self.invalidated = None
        self.validated = None
        self.validated_by = None
        self.date_validated = None

    def update(self, **kwargs):
        for key, value in kwargs.items():
            setattr(self, key, value)
        return self


def _apply(task, payload):
    with flask_app.app_context():
        return TaskAPI()._apply_tm4_task_status(task, payload)


def _state_change(action_by, action_date, action_text="INVALIDATED"):
    return {
        "action": "STATE_CHANGE",
        "actionText": action_text,
        "actionBy": action_by,
        "actionDate": action_date,
    }


def test_current_status_invalidated_marks_the_task():
    task = _FakeTask()
    counted = _apply(
        task,
        {
            "taskStatus": "INVALIDATED",
            "taskHistory": [_state_change("val_a", "2026-09-01T10:00:00Z")],
        },
    )
    assert counted is True
    assert task.invalidated is True
    assert task.validated is False
    assert task.validated_by == "val_a"
    assert task.date_validated is not None


def test_validator_is_the_most_recent_invalidation_regardless_of_order():
    """History arrives unordered; the newest invalidation is the validator."""
    task = _FakeTask()
    _apply(
        task,
        {
            "taskStatus": "INVALIDATED",
            "taskHistory": [
                _state_change("older", "2026-08-01T10:00:00Z"),
                _state_change("newest", "2026-09-05T10:00:00Z"),
                _state_change("middle", "2026-08-20T10:00:00Z"),
            ],
        },
    )
    assert task.validated_by == "newest"


def test_validator_falls_back_to_the_first_history_entry():
    """Invalidated with no STATE_CHANGE/INVALIDATED action recorded."""
    task = _FakeTask()
    _apply(
        task,
        {
            "taskStatus": "INVALIDATED",
            "taskHistory": [
                {"action": "COMMENT", "actionBy": "commenter", "actionDate": "x"}
            ],
        },
    )
    assert task.validated_by == "commenter"
    assert task.invalidated is True


@pytest.mark.parametrize("status", ["MAPPED", "VALIDATED", "READY", "SPLIT", None])
def test_a_status_other_than_invalidated_leaves_the_task_alone(status):
    task = _FakeTask()
    counted = _apply(task, {"taskStatus": status, "taskHistory": []})
    assert counted is False
    assert task.invalidated is None
    assert task.validated_by is None


def test_a_re_validated_task_is_not_invalidated_by_its_history():
    """
    A task invalidated, then re-mapped and re-validated, is currently valid.
    Only the CURRENT status may invalidate it -- history must not.
    """
    task = _FakeTask()
    counted = _apply(
        task,
        {
            "taskStatus": "VALIDATED",
            "taskHistory": [_state_change("val_a", "2026-08-01T10:00:00Z")],
        },
    )
    assert counted is False
    assert task.invalidated is None


def test_parent_task_id_is_recorded_with_four_siblings():
    """TM4 always splits into exactly four children."""
    task = _FakeTask()
    _apply(task, {"taskStatus": "MAPPED", "parentTaskId": 99, "taskHistory": []})
    assert task.parent_task_id == 99
    assert task.sibling_count == 4


def test_an_unchanged_parent_task_id_is_not_rewritten():
    task = _FakeTask(parent_task_id=99)
    _apply(task, {"taskStatus": "MAPPED", "parentTaskId": 99, "taskHistory": []})
    assert task.sibling_count is None


def test_missing_history_key_is_tolerated():
    """The payload is external; absent keys must not raise."""
    task = _FakeTask()
    assert _apply(task, {"taskStatus": "INVALIDATED"}) is True
    assert task.invalidated is True
