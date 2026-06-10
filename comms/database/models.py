"""
Comms data model — keyed entirely on the Auth0 `sub` (a universal Kaart
user id under the shared tenant). Deliberately has NO foreign keys into any
client app's tables (Mikro `users`, etc.): this service owns its own
database and stays app-agnostic, so it can serve Mikro, Viewer, and TM4
without coupling to any one app's schema.

Identity is the local projection of a user, synced from the JWT on every
authenticated request (upsert-on-auth). It carries the email + per-type
email preferences, which is everything create_notification needs — so the
emit path never reaches into a client app's user table.

Messenger models (Message / MessageRead) land in Phase 3.
"""

from datetime import datetime

from ..extensions import db
from .common import CRUDMixin

# Email-preference columns, all default TRUE (users start opted-in).
# Keep in lockstep with notifications.create.NOTIFICATION_EMAIL_PREFS.
NOTIFY_PREF_COLUMNS = (
    "notify_entry_adjusted",
    "notify_entry_force_closed",
    "notify_adjustment_requested",
    "notify_assigned_to_project",
    "notify_payment_sent",
    "notify_bank_info_changed",
    "notify_announcement",
    "notify_message_received",
)

# Role hierarchy, mirrored from Mikro so cross-app gating reads the same.
#
# IMPORTANT: the JWT's mikro/roles claim actually carries the Auth0
# *Organizations* role (owner / member), NOT Mikro's DB role — verified live:
# an org owner's token is {"mikro/roles": ["owner"]}. So the tiers comms
# actually sees are:
#   "owner"  -> org-admin tier (delete convos, org broadcast, campaigns)
#   "member" -> plain user (the default)
# We ALSO keep Mikro's DB role strings mapped ("admin" == org-admin tier, etc.)
# so gating works whether the IdP emits the org role or an app role.
ROLE_PRIORITY = {
    "user": 0,
    "member": 0,
    "validator": 1,
    "team_admin": 2,
    "admin": 3,
    "org_admin": 3,
    "owner": 3,
    "super_admin": 4,
}


def _pref_column():
    return db.Column(db.Boolean, nullable=False, default=True, server_default="true")


# BigInteger PK that still autoincrements on SQLite (used by the test suite),
# where only INTEGER PRIMARY KEY auto-increments. On Postgres this is BIGINT.
_BIG_PK = db.BigInteger().with_variant(db.Integer, "sqlite")


class Identity(CRUDMixin, db.Model):
    """A user as comms knows them — projected from the Auth0 token."""

    __tablename__ = "identities"

    sub = db.Column(db.String(255), primary_key=True)  # Auth0 sub
    email = db.Column(db.String(255), nullable=True, index=True)
    display_name = db.Column(db.String(255), nullable=True)
    org_id = db.Column(db.String(255), nullable=True, index=True)
    role = db.Column(
        db.String(50), nullable=False, default="user", server_default="user"
    )
    last_seen_app = db.Column(db.String(50), nullable=True)

    notify_entry_adjusted = _pref_column()
    notify_entry_force_closed = _pref_column()
    notify_adjustment_requested = _pref_column()
    notify_assigned_to_project = _pref_column()
    notify_payment_sent = _pref_column()
    notify_bank_info_changed = _pref_column()
    notify_announcement = _pref_column()
    notify_message_received = _pref_column()

    created_at = db.Column(db.DateTime, nullable=False, server_default=db.func.now())
    updated_at = db.Column(
        db.DateTime,
        nullable=False,
        server_default=db.func.now(),
        onupdate=datetime.utcnow,
    )

    def role_rank(self) -> int:
        return ROLE_PRIORITY.get(self.role or "user", 0)

    def has_role_at_least(self, role: str) -> bool:
        return self.role_rank() >= ROLE_PRIORITY.get(role, 99)

    @property
    def is_admin(self) -> bool:
        """org_admin or above — gates email campaigns / broadcasts."""
        return self.has_role_at_least("org_admin")

    def __repr__(self):
        return f"<Identity {self.sub} org={self.org_id} role={self.role}>"


class Notification(CRUDMixin, db.Model):
    """In-app notification targeted at a single user — drives the bell."""

    __tablename__ = "notifications"

    id = db.Column(_BIG_PK, primary_key=True, autoincrement=True)
    # user_id / actor_id are Auth0 subs. No FK on purpose: an event may be
    # emitted for a user who has not yet hit a comms-aware frontend (no
    # Identity row), and the bell row should still be created.
    user_id = db.Column(db.String(255), nullable=False, index=True)
    org_id = db.Column(db.String(255), nullable=False, index=True)
    actor_id = db.Column(db.String(255), nullable=True)
    type = db.Column(db.String(50), nullable=False, index=True)
    message = db.Column(db.String(500), nullable=False)
    link = db.Column(db.String(255), nullable=True)
    entity_type = db.Column(db.String(50), nullable=True)
    entity_id = db.Column(db.Integer, nullable=True)
    is_read = db.Column(
        db.Boolean, nullable=False, default=False, server_default="false"
    )
    created_at = db.Column(
        db.DateTime, nullable=False, server_default=db.func.now(), index=True
    )

    __table_args__ = (
        db.Index("ix_notifications_user_unread", "user_id", "is_read"),
        db.Index("ix_notifications_user_created", "user_id", "created_at"),
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "type": self.type,
            "message": self.message,
            "link": self.link,
            "actor_id": self.actor_id,
            "entity_type": self.entity_type,
            "entity_id": self.entity_id,
            "is_read": bool(self.is_read),
            "created_at": (
                self.created_at.isoformat() + "Z" if self.created_at else None
            ),
        }

    def __repr__(self):
        return f"<Notification {self.id} user={self.user_id} type={self.type} read={self.is_read}>"


class EmailCampaign(CRUDMixin, db.Model):
    """Admin-composed mass email. Draft if sent_at is null, sent otherwise."""

    __tablename__ = "email_campaigns"

    id = db.Column(_BIG_PK, primary_key=True, autoincrement=True)
    org_id = db.Column(db.String(255), nullable=False, index=True)
    subject = db.Column(db.String(255), nullable=False)
    body_html = db.Column(db.Text, nullable=False)
    sent_by = db.Column(db.String(255), nullable=False)  # Auth0 sub of sender
    audience = db.Column(
        db.String(50), nullable=False
    )  # "all_org" | "team:<id>" | "region:<id>" | "custom"
    is_forced = db.Column(
        db.Boolean, nullable=False, default=False, server_default="false"
    )
    sent_at = db.Column(db.DateTime, nullable=True)
    recipient_count = db.Column(db.Integer, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, server_default=db.func.now())

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "subject": self.subject,
            "audience": self.audience,
            "is_forced": bool(self.is_forced),
            "sent_by": self.sent_by,
            "sent_at": self.sent_at.isoformat() + "Z" if self.sent_at else None,
            "recipient_count": self.recipient_count,
            "created_at": (
                self.created_at.isoformat() + "Z" if self.created_at else None
            ),
        }

    def __repr__(self):
        return f"<EmailCampaign {self.id} subject={self.subject!r} audience={self.audience}>"


class Message(CRUDMixin, db.Model):
    """A single chat message — DM, group, or org broadcast.

    App-agnostic: comms never interprets the targeting. `target_group_key`
    is an OPAQUE label the calling app defines (e.g. "team:5", "region:3").
    comms only stores and matches it; it never resolves it to members.
    Group membership / fanout is asserted by the calling app (it passes the
    member subs on send). NO foreign keys — keyed solely on the Auth0 sub.
    """

    __tablename__ = "messages"

    id = db.Column(_BIG_PK, primary_key=True, autoincrement=True)
    org_id = db.Column(db.String(255), nullable=False, index=True)
    sender_id = db.Column(db.String(255), nullable=False, index=True)  # Auth0 sub
    # 'user' (DM) | 'group' (opaque app-defined cohort) | 'org' (whole org)
    target_type = db.Column(db.String(10), nullable=False)
    # Set for DMs — the peer's Auth0 sub.
    target_user_id = db.Column(db.String(255), nullable=True, index=True)
    # Set for group messages — opaque app-defined label, never interpreted.
    target_group_key = db.Column(db.String(100), nullable=True, index=True)
    content = db.Column(db.Text, nullable=False)
    created_at = db.Column(
        db.DateTime, nullable=False, server_default=db.func.now(), index=True
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "sender_id": self.sender_id,
            "target_type": self.target_type,
            "target_user_id": self.target_user_id,
            "target_group_key": self.target_group_key,
            "content": self.content,
            "created_at": (
                self.created_at.isoformat() + "Z" if self.created_at else None
            ),
        }

    def __repr__(self):
        return (
            f"<Message {self.id} from={self.sender_id} "
            f"type={self.target_type} org={self.org_id}>"
        )


class MessageRead(CRUDMixin, db.Model):
    """Per-(user, scope) read watermark — drives unread counts.

    A "scope" is a conversation: ('user', peer_sub), ('group', group_key),
    or ('org', org_id). We store one last_read_at per scope rather than a
    per-message read row, so unread = count of messages in the scope newer
    than this watermark (and not sent by the user themselves).
    """

    __tablename__ = "message_reads"

    user_id = db.Column(db.String(255), primary_key=True)  # Auth0 sub
    scope_type = db.Column(db.String(10), primary_key=True)  # 'user'|'group'|'org'
    scope_key = db.Column(db.String(100), primary_key=True)  # peer sub / key / org_id
    last_read_at = db.Column(db.DateTime, nullable=False, server_default=db.func.now())

    def to_dict(self) -> dict:
        return {
            "user_id": self.user_id,
            "scope_type": self.scope_type,
            "scope_key": self.scope_key,
            "last_read_at": (
                self.last_read_at.isoformat() + "Z" if self.last_read_at else None
            ),
        }

    def __repr__(self):
        return (
            f"<MessageRead {self.user_id} {self.scope_type}:{self.scope_key} "
            f"@ {self.last_read_at}>"
        )
