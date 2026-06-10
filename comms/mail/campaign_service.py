"""
Campaign service — the single source of truth for persisting, sending, and
enriching email campaigns.

Imported by BOTH the JWT-gated EmailAPI (comms/views/email.py) and the
HMAC-gated EmitAPI (comms/views/emit.py), so persistence + de-duplication +
the notify_announcement preference filter + sender enrichment all live in one
place regardless of which door the request came through.
"""

from datetime import datetime

from ..database import db, EmailCampaign, Identity
from . import mailer


def persist_and_send(
    *, org_id, subject, body_html, audience, is_forced, sent_by, emails
) -> EmailCampaign:
    """Persist an EmailCampaign and fire-and-forget the send.

    `emails` is the resolved recipient list; it is de-duplicated (and empties
    dropped) before counting + sending.
    """
    unique = sorted(set(e for e in emails if e))
    campaign = EmailCampaign(
        org_id=org_id,
        subject=subject,
        body_html=body_html,
        sent_by=sent_by,
        audience=audience,
        is_forced=bool(is_forced),
        sent_at=datetime.utcnow(),
        recipient_count=len(unique),
    )
    db.session.add(campaign)
    db.session.commit()

    if unique:
        mailer.send_campaign_async(unique, subject, body_html)

    return campaign


def emails_for_subs_pref_filtered(recipients, *, org_id, is_forced) -> list[str]:
    """Resolve a pre-authorized recipient list to deliverable addresses,
    honouring the notify_announcement opt-out (unless forced).

    `recipients` is a list of dicts like {"sub": "...", "email": "..."}; both
    keys are optional. Policy:
      - no email                          -> skip
      - is_forced                         -> keep
      - sub present AND Identity exists
        AND notify_announcement is False  -> skip (opted out)
      - otherwise                         -> keep (default-allow: no Identity
                                              row, no sub, or opted-in)
    Order is preserved.
    """
    kept = []
    for r in recipients:
        email = r.get("email")
        if not email:
            continue
        if is_forced:
            kept.append(email)
            continue
        sub = r.get("sub")
        ident = db.session.get(Identity, sub) if sub else None
        if ident is not None and ident.notify_announcement is False:
            continue  # opted out
        kept.append(email)
    return kept


def campaign_dict_with_sender(c) -> dict:
    """Serialize a campaign and resolve the sender's display name."""
    d = c.to_dict()
    ident = db.session.get(Identity, c.sent_by) if c.sent_by else None
    d["sent_by_name"] = ident.display_name if ident else None
    return d
