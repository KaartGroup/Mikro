"""
Notification type constants — single source of truth.

Every caller that passes `type=` to create_notification (or to the /emit
endpoint) MUST reference one of these constants instead of a string literal,
so the set is discoverable and typos surface at import time.
"""

from typing import Final


class NotificationType:
    """Namespaced constants for every notification `type` value."""

    ENTRY_ADJUSTED: Final[str] = "entry_adjusted"
    ENTRY_FORCE_CLOSED: Final[str] = "entry_force_closed"
    ADJUSTMENT_REQUESTED: Final[str] = "adjustment_requested"
    ASSIGNED_TO_PROJECT: Final[str] = "assigned_to_project"
    PAYMENT_SENT: Final[str] = "payment_sent"
    BANK_INFO_CHANGED: Final[str] = "bank_info_changed"
    ANNOUNCEMENT: Final[str] = "announcement"
    MESSAGE_RECEIVED: Final[str] = "message_received"

    @classmethod
    def all(cls) -> frozenset[str]:
        return frozenset(
            {
                cls.ENTRY_ADJUSTED,
                cls.ENTRY_FORCE_CLOSED,
                cls.ADJUSTMENT_REQUESTED,
                cls.ASSIGNED_TO_PROJECT,
                cls.PAYMENT_SENT,
                cls.BANK_INFO_CHANGED,
                cls.ANNOUNCEMENT,
                cls.MESSAGE_RECEIVED,
            }
        )
