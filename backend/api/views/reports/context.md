# Reports Module

Admin-facing analytics endpoints for editing activity, timekeeping, changeset heatmaps, element analysis, and Mapillary imagery.

Registered in `app.py` as a single URL rule:
```
/api/reports/<path>  →  ReportsAPI
```

---

## File Layout

```
reports/
├── __init__.py          # ReportsAPI MethodView — thin dispatcher + auth decorators
├── helpers.py           # Shared filter-resolution utilities
├── editing_stats.py     # TM4 and MapRoulette editing statistics
├── timekeeping_stats.py # Time entry analytics
├── changeset_heatmap.py # OSM changeset centroid map
├── element_analysis.py  # Per-category OSM element change analysis
├── mapillary_stats.py   # Mapillary imagery upload statistics
└── context.md           # This file
```

---

## Architectural Pattern

Every file follows the same three-layer structure, which keeps Flask context out of testable code:

### Layer 1 — Controller (`fetch_*`)
Reads from `g` and `request`. Parses and validates inputs. Calls the orchestrator with plain Python values. **Not unit-testable** (requires a live Flask request context).

### Layer 2 — Orchestrator (`get_*`)
Takes explicit parameters (org_id, dates, filter lists, etc.). Calls single-purpose helpers and assembles the response dict. **Fully testable** — call directly with plain arguments.

### Layer 3 — Query helpers (`_get_*`, `_fetch_*`, `_process_*`)
Each does one thing: one query, one external API call, one data transformation. **Fully testable** — small inputs, focused outputs.

```
fetch_editing_stats(source)          ← reads g, request
  └─ get_editing_stats(org_id, ...)  ← testable orchestrator
       ├─ _get_summary(...)
       ├─ _get_tasks_over_time(...)
       ├─ _get_projects_list(...)
       ├─ _get_top_contributors(...)
       └─ _get_comparison(...)
```

---

## Shared Helpers (`helpers.py`)

### `resolve_osm_username_filter(org_id, viewer, filters, user_id, team_id)`
Returns the OSM-username allow-list for Task queries (which filter on `mapped_by` / `validated_by`). Used by editing stats and changeset heatmap.

Return values:
- `None` — no filter, include all org members
- `["__team_admin_no_match__"]` — team_admin with no managed members; sentinel that matches nothing
- `list[str]` — specific OSM usernames to allow

### `resolve_member_id_filter(org_id, viewer, filters, user_id, team_id)`
Returns the user-ID allow-list for TimeEntry queries. Used by timekeeping stats.

Return values:
- `None` — no filter, include all org members
- `[]` — empty (caller should treat as no results)
- `list` — specific user IDs to allow

### `_team_admin_osm_usernames(viewer)` / `_intersect_or_assign(existing, new)`
Internal helpers used by `resolve_osm_username_filter` to scope team_admin viewers to their managed teams.

---

## Per-File Notes

### `editing_stats.py`
Serves both TM4 (`source="tm4"`) and MapRoulette (`source="mr"`) via the same code path. The `source` parameter gates MR-specific fields like `mr_status_summary` and `mr_status_over_time`.

`_get_summary` consolidates mapped/validated/invalidated counts into a single helper using a local `_count()` closure to avoid repetition across the three flag columns.

`_get_tasks_over_time` uses a `_weekly()` closure for the same reason — three nearly identical weekly-bucket queries over different flag/date column pairs.

`_get_time_per_project` is separated from `_get_projects_list` so it can be independently tested and cached if needed in future.

### `timekeeping_stats.py`
All query helpers share `_build_filter(org_id, start_date, end_date, member_ids)` which produces a consistent SQLAlchemy filter list. This means each helper function's signature is just `(org_id, start_date, end_date, member_ids)` — easy to test with a real or mock DB session.

`member_ids=None` means "all org members" (no user filter). `member_ids=[]` means "no results" and triggers a sentinel condition (`user_id == "__no_match__"`).

`_get_weekly_category_hours` returns a tuple `(list, set)` — the weekly pivot table and the set of all category names — because both are derived from the same query and the caller needs both.

### `changeset_heatmap.py`
Hits the OSM API concurrently via `ThreadPoolExecutor`. The inner function `_fetch_user_changeset_points` runs in threads and **cannot access Flask's app context** — it uses the module-level `logger` rather than `current_app.logger`.

`_get_active_mapper_usernames` returns `[]` (not `None`) when a team_admin has no managed users, which causes `get_changeset_heatmap` to return the empty response immediately without hitting the OSM API.

### `element_analysis.py`
`ElementAnalysisCache.week` is a stored `date` (week start Monday), so date bounds are passed as `.date()` objects, not datetimes. The controller converts before calling `get_element_analysis`.

`_ORDERED_CATEGORIES` defines the fixed display order for the eight element categories. Any category not in this list from the DB is silently dropped — this is intentional, not a bug.

`_queue_analysis_job` is the internal function for `queue_element_analysis`; the controller is thin enough that it just guards `g.user` and delegates.

### `mapillary_stats.py`
`_fetch_user_images` handles Mapillary's cursor-based pagination via the `paging.next` URL. It runs in threads — same app-context caveat as changeset heatmap.

`_process_mapillary_results` is pure Python (no DB, no HTTP) — it takes the list of per-user image dicts and aggregates them into trips and weekly upload buckets. Easiest function in the module to unit test.

`get_mapillary_stats(users, token, start_dt, end_dt)` is the testable entry point — pass a list of user objects, a token string, and datetime bounds.

---

## Auth

Decorators live on `ReportsAPI` in `__init__.py`, not on the module-level functions. This keeps the pure functions free of Flask dependencies.

- `@requires_team_admin_or_above` — editing stats, timekeeping, changeset heatmap, Mapillary
- `@requires_admin` — element analysis (queue, fetch, status)

---

## Adding a New Report Endpoint

1. Add a new file `reports/my_report.py` with:
   - `fetch_my_report()` — controller, reads `g`/`request`
   - `get_my_report(org_id, ...)` — testable orchestrator
   - `_get_*()` helpers as needed

2. Add the path dispatch in `__init__.py`:
   ```python
   elif path == "fetch_my_report":
       return self.fetch_my_report()
   ```

3. Add the decorated method in `ReportsAPI`:
   ```python
   @requires_team_admin_or_above
   def fetch_my_report(self):
       return fetch_my_report()
   ```

4. Import `fetch_my_report` at the top of `__init__.py`.
