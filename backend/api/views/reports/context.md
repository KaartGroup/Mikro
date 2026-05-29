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

The pipeline for a single request:

```
fetch_element_analysis()                    ← reads g, request
  └─ get_element_analysis(org_id, ...)      ← queries ChangesetAdiff rows
       ├─ parse_adiff_transitions(xml, ...) ← per-changeset XML → {key: {(old,new): count}}
       ├─ merge_transitions(...)            ← accumulates into day_key_stats
       ├─ build_category_data(day_key_stats)← pure: day stats → standard category list
       └─ build_hpr_category_data(...)      ← pure: highway stats → HPR category
```

**`build_category_data`** and **`build_hpr_category_data`** are pure functions (no DB, no Flask) and are the right entry points for unit tests.

**`_ORDERED_CATEGORIES`** defines the fixed display order for the nine output categories (eight standard + "High Priority Roads" injected after "Highways").

---

### Charts — Standard (metrics: added / modified / deleted)

Each standard chart counts tag-level transitions. A single OSM element change produces one count per tracked key that changed on it.

**Counting rules:**
- Tag appeared on an element (`old = None`) → **added**
- Tag was removed from an element (`new = None`) → **deleted**
- Tag value changed → **modified**

---

#### Oneways
**OSM key:** `oneway`

Counts any change to the `oneway` tag on any element type. No value filter — `yes`, `no`, `-1`, and any other value all count equally.

| What happened | Counted as |
|---|---|
| `oneway=yes` added to a way | added |
| `oneway=yes` removed | deleted |
| `oneway=yes → oneway=-1` | modified |

---

#### Access & Barriers
**OSM keys:** `access`, `barrier`

Counts changes to either key. Both keys are summed together, so a day total reflects total access-or-barrier changes, not a split between the two. No value filter.

`access` typically appears on ways and relations (road access restrictions). `barrier` typically appears on nodes (gates, bollards, bollards). They rarely change on the same element, so double-counting is uncommon in practice.

| What happened | Counted as |
|---|---|
| `access=private` added | added |
| `barrier=gate → barrier=lift_gate` | modified |
| `access=yes` removed | deleted |

---

#### Highways
**OSM key:** `highway`

Counts all `highway` tag changes regardless of road class. No value filter is currently applied — every road type from `motorway` to `footway` to `track` counts.

> Note: The high-priority-only filter (`_HIGH_PRIORITY_HIGHWAY`) exists in `adiff_analyzer.py` but is currently commented out. If re-enabled, this chart would only count changes where at least one side of the transition is motorway/trunk/primary/secondary/tertiary or a `_link` variant.

---

#### High Priority Roads
**OSM key:** `highway` (subset)

A breakdown of changes specifically involving the HPR network. Uses the same raw `highway` transitions as the Highways chart but classifies them into four buckets instead of add/modify/delete.

HPR core types and their rank (1 = highest priority):

| Value | Rank |
|---|---|
| motorway | 1 |
| trunk | 2 |
| primary | 3 |
| secondary | 4 |
| tertiary | 5 |

HPR link types (tracked separately): `motorway_link`, `trunk_link`, `primary_link`, `secondary_link`, `tertiary_link`

**Buckets:**

| Bucket | What counts |
|---|---|
| **Upgraded** | `highway` value moves to a higher-rank type — e.g. `tertiary → primary` or `residential → trunk`. Non-HPR types are treated as rank 999, so any road reclassified *into* the HPR network counts as an upgrade. |
| **Downgraded** | `highway` value moves to a lower-rank type — e.g. `primary → secondary` or `motorway → residential`. Any HPR road reclassified out of the network counts as a downgrade. |
| **Links** | Either the old or new `highway` value is a `*_link` type. Covers creating, deleting, or reclassifying link roads. |
| **Construction** | One side of the transition is an HPR core type and the other is `highway=construction` — e.g. `primary → construction` (road closed for works) or `construction → trunk` (road opens). New or deleted `construction` roads with no known HPR target/source are excluded since the road class cannot be determined from the `highway` key alone. |

Creates (old = None) and deletes (new = None) are excluded from Upgraded/Downgraded — there is no reclassification when a road is first added or fully removed. They are included for Links and Construction where the direction is clear.

---

#### Refs
**OSM key:** `ref`

Counts any change to the `ref` tag. No value filter. Covers road reference numbers, route numbers, and any other element that carries a `ref`.

---

#### Turn Restrictions
**OSM key:** `restriction`

Counts changes to the `restriction` tag. This key only appears on OSM restriction relations (e.g. `restriction=no_right_turn`), so no filter is needed — every transition is a turn restriction change.

One count per restriction changed. Previously both `type` and `restriction` were tracked, which caused each change to count twice. Now only `restriction` is used.

Creates and deletes of restriction relations are included (tag appearing/disappearing = added/deleted).

---

#### Names
**OSM key:** `name`

Counts any change to the `name` tag on any element type. No value filter.

---

#### Construction
**OSM key:** `construction`

Counts changes to the `construction` tag. In OSM, this tag holds the *intended* road class when a road is under construction (e.g. `construction=primary` on an element with `highway=construction`). No value filter.

Note: this is distinct from HPR construction transitions, which are detected via the `highway` key changing to/from `construction`.

---

#### Classifications
**OSM key:** `type`

Counts changes to the `type` tag on any element. No value filter. The `type` key is used across many relation types — routes, multipolygons, restrictions, boundaries, etc. — so this chart reflects broad relation-type changes across the whole dataset.

---

### adiff XML pipeline (`api/utils/adiff_analyzer.py`)

**`TRACKED_KEYS`** — the nine OSM tag keys the system watches: `oneway`, `highway`, `access`, `barrier`, `ref`, `name`, `construction`, `type`, `restriction`.

**`KEY_FILTERS`** — per-key callables that gate which value transitions are recorded at parse time. Currently empty (no filters active). The `highway` high-priority filter is present but commented out.

**osmcha adiff XML format** — `create` actions have the OSM element directly under `<action>` with no `<new>` wrapper. `modify` and `delete` actions use `<old>` / `<new>` containers as expected. The parser handles this: for creates it calls `_element_tag_values(action)` directly.

```xml
<!-- create — element is a direct child of <action> -->
<action type="create">
  <way><tag k="oneway" v="yes"/></way>
</action>

<!-- modify — wrapped in <old>/<new> -->
<action type="modify">
  <old><way><tag k="highway" v="secondary"/></way></old>
  <new><way><tag k="highway" v="residential"/></way></new>
</action>
```

---

### Tests and fixtures (`tests/test_element_analysis.py`, `tests/fixtures/`)

Tests are structured in three layers matching the pipeline:

| Layer | What it tests | Mocking |
|---|---|---|
| `TestParseAdiffTransitions` | Raw XML → transition dicts | None — loads real fixture XML |
| `TestBuildCategoryData` | Transition dicts → category response | None — pure function |
| `TestGetElementAnalysis` | DB query wiring | ChangesetAdiff mocked |

**Fixture files** in `tests/fixtures/` are real changesets from the DB, one per tracked-key scenario:

| File | Key(s) exercised | Notable transitions |
|---|---|---|
| `182054401.xml` | access | add (`access=private`) via modify |
| `182054462.xml` | name | add via create action (no `<new>` wrapper) |
| `182135772.xml` | highway | modify `secondary→residential` (secondary passes filter) |
| `182434007_barrier.xml` | barrier | modify `gate→lift_gate` + add |
| `182433203_ref.xml` | ref | add |
| `182164518_construction.xml` | construction, oneway | add for both |
| `182436200_restriction.xml` | restriction, type | modify + add restriction; add `type=restriction` |
| `182432384_type_multipolygon.xml` | type (negative) | `type=multipolygon` — confirms it does NOT count in Turn Restrictions |

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
