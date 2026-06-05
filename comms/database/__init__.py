"""Database package — re-exports the shared db handle and all models."""

from ..extensions import db
from .common import CRUDMixin
from .models import (
    Identity,
    Notification,
    EmailCampaign,
    Message,
    MessageRead,
    NOTIFY_PREF_COLUMNS,
    ROLE_PRIORITY,
)

__all__ = [
    "db",
    "CRUDMixin",
    "Identity",
    "Notification",
    "EmailCampaign",
    "Message",
    "MessageRead",
    "NOTIFY_PREF_COLUMNS",
    "ROLE_PRIORITY",
]
