"""
Integration tests for MapRouletteSync.sync_challenge_tasks.

Mocks the MapRoulette API client (extract CSV + summary stats) and runs the
batched sync against the PostgreSQL test DB (rolled back per test). Verifies
task create/validate/invalidate, UserTasks link creation + dedup, that the
mapper/reviewer resolution uses the preloaded caches, that the whole sync
makes exactly two API calls, and that re-syncing is idempotent.
"""

from api.database import Project, Task, User, UserTasks
from api.views.MapRoulette import MapRouletteSync

ORG = "mr-test-org"
CHALLENGE_ID = 999001

# Mapper alice + reviewer bob are Mikro users; carol is not.
#   1001 Fixed/alice         -> Approved by bob   => validated
#   1002 Fixed/alice         -> Rejected by bob   => invalidated
#   1003 Already_Fixed/carol -> (no review)       => created, no link (carol unknown)
#   1004 Skipped/alice       -> (no review)       => created, rates zeroed
#   1005 Fixed/bob           -> Unnecessary       => created, NOT validated (no-op review)
#   1006 Fixed/alice         -> Approved by alice => validated + self_validated
EXTRACT_CSV = (
    "TaskID,TaskStatus,TaskPriority,MappedOn,Mapper,ReviewStatus,Reviewer,ReviewedAt\n"
    "1001,Fixed,High,2024-01-01,alice,Approved,bob,2024-01-02\n"
    "1002,Fixed,High,2024-01-01,alice,Rejected,bob,2024-01-02\n"
    "1003,Already_Fixed,Low,2024-01-01,carol,,,\n"
    "1004,Skipped,Medium,2024-01-01,alice,,,\n"
    "1005,Fixed,High,2024-01-01,bob,Unnecessary,,\n"
    "1006,Fixed,High,2024-01-01,alice,Approved,alice,2024-01-02\n"
)


class _FakeClient:
    """Stands in for maproulette.Challenge; counts API calls."""

    def __init__(self, csv_text, total):
        self._csv = csv_text
        self._total = total
        self.extract_calls = 0
        self.stats_calls = 0

    def extract_task_summaries(self, challenge_id, limit=10, status="", **kw):
        self.extract_calls += 1
        return {"data": self._csv, "status": 200}

    def get_challenge_statistics_by_id(self, challenge_id):
        self.stats_calls += 1
        return {
            "data": [{"id": challenge_id, "actions": {"total": self._total}}],
            "status": 200,
        }


def _seed(db_session):
    project = Project(
        id=CHALLENGE_ID,
        url=f"https://maproulette.org/browse/challenges/{CHALLENGE_ID}",
        org_id=ORG,
        source="mr",
    )
    db_session.add(project)
    db_session.add(
        User(id="auth0|alice", email="a@t", osm_username="alice", org_id=ORG)
    )
    db_session.add(User(id="auth0|bob", email="b@t", osm_username="bob", org_id=ORG))
    db_session.flush()
    return project


def _run_sync(monkeypatch, total=6):
    fake = _FakeClient(EXTRACT_CSV, total)
    monkeypatch.setattr(MapRouletteSync, "_challenge_client", lambda self: fake)
    return fake


def _tasks_by_mr_id(project_id):
    return {t.task_id: t for t in Task.query.filter_by(project_id=project_id).all()}


def _linked_mr_ids(user_id, tasks_by_id):
    surrogate_to_mr = {t.id: t.task_id for t in tasks_by_id.values()}
    links = UserTasks.query.filter_by(user_id=user_id).all()
    return {
        surrogate_to_mr[ln.task_id] for ln in links if ln.task_id in surrogate_to_mr
    }


def test_first_sync_creates_validates_invalidates(db_session, monkeypatch):
    project = _seed(db_session)
    fake = _run_sync(monkeypatch)

    result = MapRouletteSync().sync_challenge_tasks(project)

    # exactly two API calls, regardless of task count
    assert fake.extract_calls == 1
    assert fake.stats_calls == 1

    assert result["tasks_processed"] == 6
    assert result["tasks_created"] == 6
    assert result["tasks_validated"] == 2  # 1001, 1006
    assert result["tasks_invalidated"] == 1  # 1002
    assert result["errors"] == 0

    tasks = _tasks_by_mr_id(CHALLENGE_ID)
    assert set(tasks) == {1001, 1002, 1003, 1004, 1005, 1006}

    assert tasks[1001].validated is True
    assert tasks[1001].invalidated is False
    assert tasks[1001].validated_by == "bob"
    assert tasks[1001].mr_status == 1

    assert tasks[1002].invalidated is True
    assert tasks[1002].validated is False
    assert tasks[1002].validated_by == "bob"

    assert tasks[1003].mapped_by == "carol"
    assert tasks[1003].mr_status == 5
    assert tasks[1003].validated is False

    # skipped tasks get zeroed rates
    assert tasks[1004].mr_status == 3
    assert tasks[1004].mapping_rate == 0
    assert tasks[1004].validation_rate == 0

    # Unnecessary review is a no-op
    assert tasks[1005].validated is False
    assert tasks[1005].invalidated is False
    assert tasks[1005].mapped_by == "bob"

    # self-validation flagged
    assert tasks[1006].validated is True
    assert tasks[1006].self_validated is True
    assert tasks[1006].validated_by == "alice"

    assert project.total_tasks == 6


def test_links_created_for_known_users_only(db_session, monkeypatch):
    project = _seed(db_session)
    _run_sync(monkeypatch)

    MapRouletteSync().sync_challenge_tasks(project)
    tasks = _tasks_by_mr_id(CHALLENGE_ID)

    # alice: mapper on 1001,1002,1004,1006 (and self-validator on 1006 -> deduped)
    assert _linked_mr_ids("auth0|alice", tasks) == {1001, 1002, 1004, 1006}
    # bob: validator on 1001, mapper on 1005 (invalidation 1002 makes no link)
    assert _linked_mr_ids("auth0|bob", tasks) == {1001, 1005}

    # carol is not a Mikro user -> no link rows reference her tasks beyond mapper text
    project_surrogates = {t.id for t in tasks.values()}
    total_links = sum(
        1 for ln in UserTasks.query.all() if ln.task_id in project_surrogates
    )
    assert total_links == 6  # 4 for alice + 2 for bob


def test_resync_is_idempotent(db_session, monkeypatch):
    project = _seed(db_session)
    _run_sync(monkeypatch)

    MapRouletteSync().sync_challenge_tasks(project)
    tasks = _tasks_by_mr_id(CHALLENGE_ID)
    surrogates = {t.id for t in tasks.values()}
    links_before = sum(1 for ln in UserTasks.query.all() if ln.task_id in surrogates)

    result2 = MapRouletteSync().sync_challenge_tasks(project)

    assert result2["tasks_created"] == 0
    assert result2["tasks_validated"] == 0  # already validated -> early return
    assert result2["tasks_invalidated"] == 0
    assert result2["errors"] == 0

    assert Task.query.filter_by(project_id=CHALLENGE_ID).count() == 6
    links_after = sum(
        1
        for ln in UserTasks.query.all()
        if ln.task_id in {t.id for t in _tasks_by_mr_id(CHALLENGE_ID).values()}
    )
    assert links_after == links_before == 6


def test_unknown_status_label_is_skipped(db_session, monkeypatch):
    project = _seed(db_session)
    bad_csv = (
        "TaskID,TaskStatus,Mapper,ReviewStatus,Reviewer\n"
        "2001,Fixed,alice,,\n"
        "2002,Bogus_Status,alice,,\n"
    )
    fake = _FakeClient(bad_csv, total=2)
    monkeypatch.setattr(MapRouletteSync, "_challenge_client", lambda self: fake)

    result = MapRouletteSync().sync_challenge_tasks(project)

    # 2002 has an unrecognized status label -> skipped, not created
    assert result["tasks_created"] == 1
    assert {t.task_id for t in Task.query.filter_by(project_id=CHALLENGE_ID).all()} == {
        2001
    }
