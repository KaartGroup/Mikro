"""Email package — SMTP mailer + audience format helpers."""

from . import mailer
from . import audience
from . import campaign_service

__all__ = ["mailer", "audience", "campaign_service"]
