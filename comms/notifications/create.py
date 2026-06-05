"""
create_notification — single SSOT entry point for emitting a bell
notification (and optionally an email) to a user.

Adapted from Mikro's backend/api/notifications/create.py. The only
behavioural change for the standalone service: email address and per-type
email preferences are read from the comms `Identity` projection (keyed on
Auth0 sub), NOT from any client app's user table. Everything else — the
always-create-the-bell-row rule, the per-(user,type) hourly email rate
limit, fire-and-forget email — is preserved verbatim.

Every emit (HTTP /emit, messenger fanout, future in-process callers) routes
through here so notification policy lives in exactly one place.
"""

from datetime import datetime, timedelta
from typing import Optional

from flask import current_app

from ..database import Notification, Identity, db
from .types import NotificationType

# Notification type → the Identity.notify_* column that controls email
# delivery for it. Types not in this map get no email by default (kept
# quiet). Admin campaigns check notify_announcement via their own path.
NOTIFICATION_EMAIL_PREFS: dict[str, str] = {
    NotificationType.ENTRY_ADJUSTED: "notify_entry_adjusted",
    NotificationType.ENTRY_FORCE_CLOSED: "notify_entry_force_closed",
    NotificationType.ADJUSTMENT_REQUESTED: "notify_adjustment_requested",
    NotificationType.ASSIGNED_TO_PROJECT: "notify_assigned_to_project",
    NotificationType.PAYMENT_SENT: "notify_payment_sent",
    NotificationType.BANK_INFO_CHANGED: "notify_bank_info_changed",
    NotificationType.ANNOUNCEMENT: "notify_announcement",
    NotificationType.MESSAGE_RECEIVED: "notify_message_received",
}


def create_notification(
    *,
    user_id: str,
    org_id: str,
    type: str,
    message: str,
    link: Optional[str] = None,
    actor_id: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[int] = None,
    send_email: Optional[bool] = None,
    commit: bool = True,
) -> Notification:
    """Create a bell notification and (optionally) email the user.

    Args:
        user_id: Recipient's Auth0 sub.
        org_id: The recipient's org_id, stamped on the row for per-org siloing.
        type: Short identifier, ideally a NotificationType constant. Unknown
            types still create the bell row, just no email.
        message: Human-readable text shown in the bell panel (<=500 chars).
        link: Optional frontend route for click-through.
        actor_id: Auth0 sub whose action triggered this (null for system).
        entity_type, entity_id: Optional pointer to the source object.
        send_email: Force the email decision. True = always, False = never,
            None = let the recipient's prefs + rate-limit decide.
        commit: Commit before returning. Pass False when batching a fanout
            (e.g. team broadcast) and committing once at the end.

    Returns:
        The persisted Notification row.
    """
    notification = Notification(
        user_id=user_id,
        org_id=org_id,
        actor_id=actor_id,
        type=type,
        message=message,
        link=link,
        entity_type=entity_type,
        entity_id=entity_id,
    )
    db.session.add(notification)
    db.session.flush()  # assign an id without committing

    # Resolve the recipient's projection once (prefs + email live here).
    identity = db.session.get(Identity, user_id)

    # Decide about email.
    email_wanted = send_email
    if email_wanted is None:
        pref_field = NOTIFICATION_EMAIL_PREFS.get(type)
        if pref_field is None:
            email_wanted = False  # unknown type — silent
        elif identity is None:
            email_wanted = False  # never seen this user — no address/prefs
        else:
            email_wanted = bool(getattr(identity, pref_field, True))

    # Rate limit: at most one email per (user, type) per hour. We just
    # inserted the current row; suppress email if an earlier one exists.
    if email_wanted:
        cutoff = datetime.utcnow() - timedelta(minutes=60)
        has_prior = (
            db.session.query(Notification.id)
            .filter(
                Notification.user_id == user_id,
                Notification.type == type,
                Notification.created_at >= cutoff,
                Notification.id != notification.id,
            )
            .first()
            is not None
        )
        if has_prior:
            email_wanted = False

    if email_wanted and identity is not None and identity.email:
        try:
            from ..email import mailer

            mailer.send_notification_email(
                to=identity.email,
                user_display_name=identity.display_name or identity.email,
                title=type.replace("_", " ").title(),
                body=message,
                action_url=link,
            )
        except Exception as e:
            try:
                current_app.logger.warning(
                    f"[NOTIF-EMAIL] send failed user={user_id} type={type}: {e}"
                )
            except Exception:
                pass

    if commit:
        try:
            db.session.commit()
        except Exception as e:
            db.session.rollback()
            try:
                current_app.logger.warning(
                    f"[NOTIF] commit failed user={user_id} type={type}: {e}"
                )
            except Exception:
                pass

    return notification
