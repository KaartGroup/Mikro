"""
Time-tracking taxonomy constants — single source of truth.

The activity slug set + display map and the long-session threshold used to
live inside ``time_tracking_helpers`` and were re-exported through the
``TimeTracking`` *view* module, so unrelated callers (reports, projects)
imported a view just to read a constant. They live here now; the view and
every reader import them from this module directly.
"""

# Long-session threshold (SSOT). A session running longer than this —
# whether still active or already closed — is flagged as a probable
# forgotten clock-out. Referenced by TimeTracking.admin_long_sessions and
# the effectiveDurationSeconds field in the presenter; never hardcode the
# value elsewhere.
LONG_SESSION_THRESHOLD_SECONDS = 10 * 3600

# Tier-1 activity slugs (the renamed `category` enum). Stored in
# `time_entries.activity`. Mirrors the SSOT on the frontend at
# `lib/timeTracking.ts` — keep these two lists in sync; any new
# activity needs to be added in BOTH places (and seeded with a
# default set of subcategories via the Time Categories admin page
# or a follow-up migration).
# 2026-05-21 Logan taxonomy pass: removed `validating`, `checklist`, and
# `community` from the accepted activity set per his request (Validating
# folded into QC/Validation; Checklist deprecated; Community's subs
# relocated under Other). The slugs are NOT in ACTIVITY_DISPLAY_MAP-less
# territory — historical entries with those values still render via the
# display map below — but new clock-ins with those slugs now 400. Legacy
# alias `validation` is also dropped from accepted slugs for the same
# reason. `mapping` (-> Editing) and `review` (-> QC/Validation) stay
# accepted for back-compat from older clients.
ACTIVITY_SLUGS = {
    "editing",
    "training",
    "qc_review",
    "meeting",
    "documentation",
    "imagery_capture",
    "project_creation",
    "other",
    "community_event",
    # Legacy values still accepted for backward compat (clock-in payloads
    # from older clients). Normalized to canonical slugs on display.
    "mapping",
    "review",
}

# Map stored activity slug -> display label. User-facing UI strings.
# Retired activities (`validating`, `checklist`, `community`) keep their
# display entries so historical time_entries continue to render their
# original label correctly even though new clock-ins can no longer pick
# them. `qc_review` was renamed from "QC / Review" -> "QC / Validation"
# in the same pass (Logan merged Validating into it).
ACTIVITY_DISPLAY_MAP = {
    "editing": "Editing",
    "training": "Training",
    "qc_review": "QC / Validation",
    "meeting": "Meeting",
    "documentation": "Documentation",
    "imagery_capture": "Imagery Capture",
    "project_creation": "Project Creation",
    "other": "Other",
    "community_event": "Community Event",
    # Retired activities — kept for display continuity on historical rows.
    "validating": "Validating",
    "checklist": "Checklist",
    "community": "Community",
    # Legacy mappings -> canonical labels (post-rename for review/validation).
    "mapping": "Editing",
    "validation": "Validating",
    "review": "QC / Validation",
}
