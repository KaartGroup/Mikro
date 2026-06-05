"""Notifications package — SSOT emit helper + type constants."""

from .create import create_notification, NOTIFICATION_EMAIL_PREFS
from .types import NotificationType

__all__ = ["create_notification", "NOTIFICATION_EMAIL_PREFS", "NotificationType"]
