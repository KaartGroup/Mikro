"""
Time-tracking domain package.

The flat ``api/utils/time_entry_*`` + ``time_tracking_helpers`` modules were
consolidated here in the Phase 5 relocation. The split follows
command/query separation plus shared collaborators:

  - :mod:`.constants`  — activity taxonomy + thresholds (SSOT)
  - :mod:`.scope`      — ``TimeEntryScope`` (visibility / member resolution)
  - :mod:`.queries`    — ``TimeEntryQuery`` + workflow subclasses (reads)
  - :mod:`.service`    — ``TimeEntryService`` (writes)
  - :mod:`.presenter`  — ``TimeTrackingHelpers`` (serialization)

Import the public names from this package root rather than the submodules.
"""

from .constants import (
    ACTIVITY_SLUGS,
    ACTIVITY_DISPLAY_MAP,
    LONG_SESSION_THRESHOLD_SECONDS,
)
from .scope import TimeEntryScope
from .presenter import TimeTrackingHelpers
from .service import TimeEntryService, DiscardWindowError
from .queries import (
    TimeEntryQuery,
    UserHistoryQuery,
    AggregateQuery,
    PayrollHoursQuery,
)

__all__ = [
    "ACTIVITY_SLUGS",
    "ACTIVITY_DISPLAY_MAP",
    "LONG_SESSION_THRESHOLD_SECONDS",
    "TimeEntryScope",
    "TimeTrackingHelpers",
    "TimeEntryService",
    "DiscardWindowError",
    "TimeEntryQuery",
    "UserHistoryQuery",
    "AggregateQuery",
    "PayrollHoursQuery",
]
