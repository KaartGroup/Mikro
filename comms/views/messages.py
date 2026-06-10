"""
Messenger API — DMs, group threads, and org broadcasts.

App-agnostic by design. Comms knows nothing about any client app's teams or
regions: a "group" is addressed by an OPAQUE `group_key` string (e.g.
"team:5", "region:3") that the calling app defines and resolves to members.
Comms never interprets that key, and never resolves group membership — the
app asserts it by passing `group_keys` (which groups the caller belongs to)
on read paths and `recipient_user_ids` (the resolved member subs) on send.
We trust those assertions only within the caller's own org.

Design notes (mirrors the donor, minus the Mikro Team/Region coupling):
  - No conversation/room table. A "conversation" is any set of messages
    matching a scope: DMs share (target_type='user', sender/target pair);
    group messages share (target_type='group', target_group_key); org
    messages share (target_type='org').
  - Unread counts derive from a MessageRead watermark per
    (user_id, scope_type, scope_key). No per-message read rows.
  - Per-org siloing on every query: Message.org_id == g.identity.org_id.
  - Authorization:
      * DM: any authenticated user in the same org; the peer must exist as
        an Identity in the same org (cross-org rejected).
      * group: V1 accepts any group_key within the caller's org —
        membership is APP-ASSERTED (the app only surfaces keys the caller
        belongs to). Fanout targets the app-supplied recipient_user_ids.
      * org broadcast: caller must be admin (g.identity.is_admin).

Self-scoped to g.identity like the rest of the service. Adapted from
feature/comms-platform's backend/api/views/Messages.py.
"""

from datetime import datetime
from typing import Optional

from flask import g, jsonify, request
from flask.views import MethodView
from sqlalchemy import and_, or_

from ..database import Identity, Message, MessageRead, db
from ..auth import requires_auth
from ..notifications import create_notification, NotificationType

VALID_SCOPES = ("user", "group", "org")


class MessagesAPI(MethodView):
    """Self-scoped messenger endpoints for DMs, groups, and org broadcasts."""

    decorators = [requires_auth]

    def post(self, path: str):
        handler = {
            "conversations": self.conversations,
            "thread": self.thread,
            "send": self.send,
            "mark_read": self.mark_read,
            "unread_count": self.unread_count,
            "delete_message": self.delete_message,
            "delete_conversation": self.delete_conversation,
        }.get(path)
        if handler is None:
            return jsonify({"message": "Endpoint not found", "status": 404}), 404
        return handler()

    # ─── helpers ──────────────────────────────────────────────

    @staticmethod
    def _org_id() -> Optional[str]:
        return g.identity.org_id

    @staticmethod
    def _me() -> str:
        return g.identity.sub

    def _scope_filter(self, scope_type: str, scope_key: str):
        """SQLAlchemy filter matching messages in the given scope, scoped to
        the caller's org. Returns False for an unrecognized scope."""
        base = Message.org_id == self._org_id()
        me = self._me()
        if scope_type == "user":
            # DM between me and `scope_key`, in either direction.
            return and_(
                base,
                Message.target_type == "user",
                or_(
                    and_(
                        Message.sender_id == me,
                        Message.target_user_id == scope_key,
                    ),
                    and_(
                        Message.sender_id == scope_key,
                        Message.target_user_id == me,
                    ),
                ),
            )
        if scope_type == "group":
            return and_(
                base,
                Message.target_type == "group",
                Message.target_group_key == scope_key,
            )
        if scope_type == "org":
            return and_(base, Message.target_type == "org")
        return False

    def _last_read(self, scope_type: str, scope_key: str) -> Optional[datetime]:
        row = MessageRead.query.filter_by(
            user_id=self._me(), scope_type=scope_type, scope_key=scope_key
        ).first()
        return row.last_read_at if row else None

    def _unread_for_scope(self, scope_type: str, scope_key: str) -> int:
        """Count messages in the scope newer than the watermark, excluding
        the caller's own messages (implicitly read by the sender)."""
        filter_expr = self._scope_filter(scope_type, scope_key)
        if filter_expr is False:
            return 0
        q = Message.query.filter(filter_expr).filter(Message.sender_id != self._me())
        last_read = self._last_read(scope_type, scope_key)
        if last_read is not None:
            q = q.filter(Message.created_at > last_read)
        return q.count()

    def _last_message(self, scope_type: str, scope_key: str) -> Optional[Message]:
        filter_expr = self._scope_filter(scope_type, scope_key)
        if filter_expr is False:
            return None
        return (
            Message.query.filter(filter_expr)
            # id breaks created_at ties (same-second inserts) so "last" is
            # deterministically the most recently inserted row.
            .order_by(Message.created_at.desc(), Message.id.desc()).first()
        )

    @staticmethod
    def _group_keys_param(data: dict) -> list[str]:
        keys = data.get("group_keys") or []
        if not isinstance(keys, list):
            return []
        return [str(k) for k in keys if k]

    # ─── endpoints ────────────────────────────────────────────

    def conversations(self):
        """List the caller's conversations with last message + unread_count.

        DMs: distinct peers the caller has exchanged messages with.
        Groups: only those the caller passes in `group_keys` (app-asserted
            membership) and that have at least one message in this org.
        Org: the caller's org feed (always present).
        """
        data = request.get_json(silent=True) or {}
        org_id = self._org_id()
        me = self._me()
        out: list[dict] = []

        # DMs — distinct peers from both directions.
        peer_ids: set[str] = set()
        for r in (
            db.session.query(Message.target_user_id)
            .filter(
                Message.org_id == org_id,
                Message.target_type == "user",
                Message.sender_id == me,
            )
            .distinct()
            .all()
        ):
            if r[0] and r[0] != me:
                peer_ids.add(r[0])
        for r in (
            db.session.query(Message.sender_id)
            .filter(
                Message.org_id == org_id,
                Message.target_type == "user",
                Message.target_user_id == me,
            )
            .distinct()
            .all()
        ):
            if r[0] and r[0] != me:
                peer_ids.add(r[0])

        for peer_id in peer_ids:
            peer = db.session.get(Identity, peer_id)
            # Skip peers that are no longer in the caller's org.
            if peer is not None and peer.org_id != org_id:
                continue
            last = self._last_message("user", peer_id)
            # NEVER put the raw Auth0 sub in a human-facing field. If this peer
            # has no Identity projection (or no name/email yet), leave label
            # null and let the calling app resolve the name from its own user
            # directory. scope_key still carries the sub purely as a routing
            # key — the client must never render it.
            label = None
            if peer is not None:
                label = peer.display_name or peer.email
            out.append(
                {
                    "scope_type": "user",
                    "scope_key": peer_id,
                    "label": label,
                    "subtitle": peer.email if peer is not None else None,
                    "last_message": last.to_dict() if last else None,
                    "unread_count": self._unread_for_scope("user", peer_id),
                }
            )

        # Groups — only the app-asserted ones the caller passes.
        for group_key in self._group_keys_param(data):
            last = self._last_message("group", group_key)
            out.append(
                {
                    "scope_type": "group",
                    "scope_key": group_key,
                    "label": group_key,
                    "subtitle": "Group",
                    "last_message": last.to_dict() if last else None,
                    "unread_count": self._unread_for_scope("group", group_key),
                }
            )

        # Org (always one).
        last_org = self._last_message("org", org_id)
        out.append(
            {
                "scope_type": "org",
                "scope_key": org_id,
                "label": "Organization",
                "subtitle": "Everyone in your org",
                "last_message": last_org.to_dict() if last_org else None,
                "unread_count": self._unread_for_scope("org", org_id),
            }
        )

        # Most-recent activity first; conversations with no message sink down.
        def _key(row):
            lm = row.get("last_message") or {}
            return lm.get("created_at") or ""

        out.sort(key=_key, reverse=True)
        return jsonify({"status": 200, "conversations": out}), 200

    def thread(self):
        """Paginated messages for a conversation scope (oldest-first window).

        For scope_type 'group' we accept any group_key within the caller's
        org — membership is APP-ASSERTED (the app only ever shows the caller
        keys it has already confirmed they belong to).
        """
        data = request.get_json(silent=True) or {}
        scope_type = data.get("scope_type")
        scope_key = data.get("scope_key")

        # Clamp limit/offset like notifications.py.
        try:
            limit = max(1, min(int(data.get("limit", 50)), 100))
        except (TypeError, ValueError):
            limit = 50
        try:
            offset = max(0, int(data.get("offset", 0)))
        except (TypeError, ValueError):
            offset = 0

        if scope_type not in VALID_SCOPES or scope_key is None:
            return (
                jsonify(
                    {"message": "scope_type and scope_key required", "status": 400}
                ),
                400,
            )

        filter_expr = self._scope_filter(scope_type, str(scope_key))
        if filter_expr is False:
            return jsonify({"status": 200, "messages": [], "total": 0}), 200

        # id breaks created_at ties so pagination is stable across same-second
        # inserts (sqlite's now() is whole-second; matters under load too).
        q = Message.query.filter(filter_expr).order_by(
            Message.created_at.desc(), Message.id.desc()
        )
        total = q.count()
        rows = q.limit(limit).offset(offset).all()
        # Return oldest-first within the window so the client renders top-down.
        rows.reverse()
        return (
            jsonify(
                {
                    "status": 200,
                    "messages": [m.to_dict() for m in rows],
                    "total": total,
                }
            ),
            200,
        )

    def send(self):
        """Create a message and fan out MESSAGE_RECEIVED notifications.

        body: { target_type, target_user_id?, target_group_key?, content,
                recipient_user_ids? }
          - 'user' : requires target_user_id (same org; cross-org rejected).
          - 'group': requires target_group_key + recipient_user_ids (the
                     app-resolved member subs — comms trusts within org).
          - 'org'  : caller must be admin; recipients resolved from the
                     Identity table for the org (excluding the sender).
        """
        data = request.get_json(silent=True) or {}
        target_type = data.get("target_type")
        content = (data.get("content") or "").strip()
        org_id = self._org_id()
        me = self._me()

        if target_type not in VALID_SCOPES:
            return jsonify({"message": "Invalid target_type", "status": 400}), 400
        if not content:
            return jsonify({"message": "content is required", "status": 400}), 400

        target_user_id: Optional[str] = None
        target_group_key: Optional[str] = None
        recipient_subs: list[str] = []

        if target_type == "user":
            target_user_id = data.get("target_user_id")
            if not target_user_id:
                return (
                    jsonify({"message": "target_user_id required", "status": 400}),
                    400,
                )
            if target_user_id == me:
                return (
                    jsonify({"message": "Cannot DM yourself", "status": 400}),
                    400,
                )
            # Allow DMing any colleague even if they have not signed into comms
            # yet (no Identity row). The message is stamped with the SENDER's
            # org_id and every read query is org-scoped, so a recipient only
            # ever sees it if they are in the same org. Only reject when the
            # recipient is KNOWN (has an Identity) and is in a DIFFERENT org.
            peer = db.session.get(Identity, target_user_id)
            if peer is not None and peer.org_id != org_id:
                return jsonify({"message": "Forbidden", "status": 403}), 403
            scope_key = target_user_id
            recipient_subs = [target_user_id]

        elif target_type == "group":
            target_group_key = data.get("target_group_key")
            recipient_user_ids = data.get("recipient_user_ids")
            if not target_group_key:
                return (
                    jsonify({"message": "target_group_key required", "status": 400}),
                    400,
                )
            scope_key = str(target_group_key)
            target_group_key = scope_key
            if isinstance(recipient_user_ids, list) and recipient_user_ids:
                # App-asserted membership: trust the supplied subs (the initial
                # broadcast resolves the full team), but never notify the sender.
                recipient_subs = [
                    str(s) for s in recipient_user_ids if s and str(s) != me
                ]
            else:
                # No explicit recipient list — this is a REPLY by someone who
                # can't resolve team membership (a plain member, or a team admin
                # who doesn't lead this team). Fall back to the existing
                # participants of this group thread so the reply still reaches
                # everyone already in the conversation. A brand-new thread (no
                # prior messages) still needs an explicit recipient list.
                existing = (
                    db.session.query(Message.sender_id)
                    .filter(
                        Message.org_id == org_id,
                        Message.target_type == "group",
                        Message.target_group_key == scope_key,
                    )
                    .distinct()
                    .all()
                )
                participants = {r[0] for r in existing if r[0]}
                if not participants:
                    return (
                        jsonify(
                            {
                                "message": (
                                    "recipient_user_ids is required to start a "
                                    "new group thread"
                                ),
                                "status": 400,
                            }
                        ),
                        400,
                    )
                recipient_subs = [s for s in participants if s != me]

        else:  # org
            if not g.identity.is_admin:
                return jsonify({"message": "Forbidden", "status": 403}), 403
            scope_key = org_id
            # Resolve org members from the Identity projection, minus sender.
            recipient_subs = [
                row.sub
                for row in Identity.query.filter(
                    Identity.org_id == org_id,
                    Identity.sub != me,
                ).all()
            ]

        msg = Message(
            org_id=org_id,
            sender_id=me,
            target_type=target_type,
            target_user_id=target_user_id,
            target_group_key=target_group_key,
            content=content,
        )
        db.session.add(msg)
        db.session.flush()  # assign id without committing

        sender_name = g.identity.display_name or g.identity.email or "Someone"
        scope_label = {
            "user": "a direct message",
            "group": "a group",
            "org": "your organization",
        }.get(target_type, "you")
        snippet = content[:140] + ("…" if len(content) > 140 else "")
        link = f"/messages?scope={target_type}&key={scope_key}"

        for sub in recipient_subs:
            try:
                create_notification(
                    user_id=sub,
                    org_id=org_id,
                    type=NotificationType.MESSAGE_RECEIVED,
                    message=f"{sender_name} sent {scope_label}: {snippet}",
                    link=link,
                    actor_id=me,
                    entity_type="message",
                    entity_id=msg.id,
                    commit=False,  # batch — commit once below
                )
            except Exception:
                # One bad recipient shouldn't block the send.
                pass

        db.session.commit()
        return jsonify({"status": 200, "message": msg.to_dict()}), 200

    def mark_read(self):
        """Upsert the caller's read watermark for a conversation scope.

        body: { scope_type, scope_key, up_to_timestamp? }. If
        up_to_timestamp (ISO-8601) is given, the watermark is set to it;
        otherwise to now.
        """
        data = request.get_json(silent=True) or {}
        scope_type = data.get("scope_type")
        scope_key = data.get("scope_key")
        if scope_type not in VALID_SCOPES or scope_key is None:
            return (
                jsonify(
                    {"message": "scope_type and scope_key required", "status": 400}
                ),
                400,
            )
        scope_key = str(scope_key)

        up_to = data.get("up_to_timestamp")
        if up_to:
            try:
                watermark = datetime.fromisoformat(str(up_to).replace("Z", ""))
            except ValueError:
                return (
                    jsonify({"message": "Invalid up_to_timestamp", "status": 400}),
                    400,
                )
        else:
            # Default: mark everything currently in the scope as read by
            # setting the watermark to the latest message's created_at. This
            # ties the watermark to the same clock/precision as messages
            # (db now()), so a strictly-later message stays unread — avoiding
            # the clock-skew/precision mismatch a wall-clock utcnow() would
            # introduce against db-side server defaults.
            last = self._last_message(scope_type, scope_key)
            watermark = last.created_at if last is not None else datetime.utcnow()

        row = MessageRead.query.filter_by(
            user_id=self._me(), scope_type=scope_type, scope_key=scope_key
        ).first()
        if row is None:
            row = MessageRead(
                user_id=self._me(),
                scope_type=scope_type,
                scope_key=scope_key,
                last_read_at=watermark,
            )
            db.session.add(row)
        else:
            row.last_read_at = watermark
        db.session.commit()
        return jsonify({"status": 200}), 200

    def unread_count(self):
        """Total unread across the caller's DMs + org (+ passed group_keys).

        body: { group_keys? } — the app-asserted groups to include.
        """
        data = request.get_json(silent=True) or {}
        org_id = self._org_id()
        me = self._me()
        total = 0

        # DMs — distinct peers from both directions.
        peer_ids: set[str] = set()
        for r in (
            db.session.query(Message.target_user_id)
            .filter(
                Message.org_id == org_id,
                Message.target_type == "user",
                Message.sender_id == me,
            )
            .distinct()
            .all()
        ):
            if r[0] and r[0] != me:
                peer_ids.add(r[0])
        for r in (
            db.session.query(Message.sender_id)
            .filter(
                Message.org_id == org_id,
                Message.target_type == "user",
                Message.target_user_id == me,
            )
            .distinct()
            .all()
        ):
            if r[0] and r[0] != me:
                peer_ids.add(r[0])
        for peer_id in peer_ids:
            total += self._unread_for_scope("user", peer_id)

        # Groups — only the app-asserted ones passed in.
        for group_key in self._group_keys_param(data):
            total += self._unread_for_scope("group", group_key)

        # Org.
        total += self._unread_for_scope("org", org_id)

        return jsonify({"status": 200, "unread_count": int(total)}), 200

    def delete_message(self):
        """Delete a single message.

        body: { message_id }
        Authorization: org admins may delete any message in their org; any
        other caller may delete only a message they sent. Org-scoped: a
        message in another org is treated as not found.
        """
        data = request.get_json(silent=True) or {}
        raw_id = data.get("message_id")
        try:
            message_id = int(raw_id)
        except (TypeError, ValueError):
            return jsonify({"message": "message_id required", "status": 400}), 400

        msg = db.session.get(Message, message_id)
        # Don't leak existence across orgs — same response as truly missing.
        if msg is None or msg.org_id != self._org_id():
            return jsonify({"message": "Message not found", "status": 404}), 404

        if not g.identity.is_admin and msg.sender_id != self._me():
            return jsonify({"message": "Forbidden", "status": 403}), 403

        db.session.delete(msg)
        db.session.commit()
        return jsonify({"status": 200}), 200

    def delete_conversation(self):
        """Delete an entire conversation — every message in the scope, plus
        the read watermarks for it.

        body: { scope_type, scope_key }
        Authorization: org admins only. Deleting a conversation removes
        content other users can see, so it's a moderation action. The scope
        is resolved relative to the caller (the same conversations they can
        see), and is always confined to the caller's org.
        """
        if not g.identity.is_admin:
            return jsonify({"message": "Forbidden", "status": 403}), 403

        data = request.get_json(silent=True) or {}
        scope_type = data.get("scope_type")
        scope_key = data.get("scope_key")
        if scope_type not in VALID_SCOPES or scope_key is None:
            return (
                jsonify(
                    {"message": "scope_type and scope_key required", "status": 400}
                ),
                400,
            )
        scope_key = str(scope_key)

        filter_expr = self._scope_filter(scope_type, scope_key)
        if filter_expr is False:
            return jsonify({"status": 200, "deleted": 0}), 200

        deleted = Message.query.filter(filter_expr).delete(synchronize_session=False)

        # Clear the read watermarks tied to this scope so the conversation
        # doesn't linger in unread math for anyone.
        me = self._me()
        if scope_type == "user":
            MessageRead.query.filter(
                MessageRead.scope_type == "user",
                or_(
                    and_(
                        MessageRead.user_id == me,
                        MessageRead.scope_key == scope_key,
                    ),
                    and_(
                        MessageRead.user_id == scope_key,
                        MessageRead.scope_key == me,
                    ),
                ),
            ).delete(synchronize_session=False)
        else:  # group / org — one shared scope_key across all users
            MessageRead.query.filter(
                MessageRead.scope_type == scope_type,
                MessageRead.scope_key == scope_key,
            ).delete(synchronize_session=False)

        db.session.commit()
        return jsonify({"status": 200, "deleted": int(deleted)}), 200
