"""
Comms client — the single place any Mikro code emits notifications.

Mikro POSTs notification events to the standalone "Kaart Comms" service at
``{COMMS_URL}/emit/notify`` (single recipient) and ``/emit/notify_batch``
(fan one message out to many recipients). Each request is authenticated by an
HMAC-SHA256 hex signature of the RAW request body in the ``X-Comms-Signature``
header, using the shared ``COMMS_WEBHOOK_SECRET``. This matches the contract in
``comms/views/emit.py`` and ``comms/auth/hmac_auth.py``.

Design rules (mirror ``comms/email/mailer.py``):
  * FIRE-AND-FORGET — the POST runs on a daemon thread so request handlers
    never block on comms latency.
  * FAIL-SAFE — emit/emit_batch NEVER raise into the caller. A notification
    failure must never break business logic.
  * DEGRADES CLEANLY — if COMMS_URL / COMMS_WEBHOOK_SECRET are unset, we log
    and no-op rather than erroring.

Callers should reference :class:`NotificationType` constants for ``type=``
instead of hardcoding strings, so typos surface at import time and the set of
notification types stays discoverable.
"""

import hashlib
import hmac
import json
import threading
from typing import Final, Optional

import requests
from flask import current_app

# Short timeout — comms is best-effort; we never want it to hold a request
# thread (or its own daemon thread) open for long.
_TIMEOUT_SECONDS: Final[float] = 3.0


class NotificationType:
    """Mirror of ``comms/notifications/types.py`` — keep in sync.

    Callers pass these constants to :func:`emit` / :func:`emit_batch` instead
    of string literals so typos surface at import time.
    """

    ENTRY_ADJUSTED: Final[str] = "entry_adjusted"
    ENTRY_FORCE_CLOSED: Final[str] = "entry_force_closed"
    ADJUSTMENT_REQUESTED: Final[str] = "adjustment_requested"
    ASSIGNED_TO_PROJECT: Final[str] = "assigned_to_project"
    PAYMENT_SENT: Final[str] = "payment_sent"
    BANK_INFO_CHANGED: Final[str] = "bank_info_changed"
    ANNOUNCEMENT: Final[str] = "announcement"
    MESSAGE_RECEIVED: Final[str] = "message_received"


def _comms_config() -> tuple[Optional[str], Optional[str]]:
    """(base_url, secret) from current_app.config, falling back to env."""
    try:
        url = current_app.config.get("COMMS_URL")
        secret = current_app.config.get("COMMS_WEBHOOK_SECRET")
    except Exception:
        # No app context (e.g. called from a bare worker) — read env directly.
        import os

        url = os.environ.get("COMMS_URL")
        secret = os.environ.get("COMMS_WEBHOOK_SECRET")
    return url, secret


def _sign(secret: str, raw_body: bytes) -> str:
    """hex( HMAC-SHA256(secret, raw_body) ) — matches comms/auth/hmac_auth.py."""
    return hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()


def _log(level: str, msg: str) -> None:
    try:
        getattr(current_app.logger, level)(msg)
    except Exception:
        pass


def _post(endpoint: str, body: dict) -> None:
    """Sign and POST one comms event. Runs on a daemon thread; never raises.

    ``endpoint`` is the path after ``/emit/`` — e.g. ``"notify"`` or
    ``"notify_batch"``.
    """
    url, secret = _comms_config()
    if not url or not secret:
        _log(
            "info",
            f"[COMMS] skipped (COMMS_URL/secret not configured) endpoint={endpoint}",
        )
        return

    raw_body = json.dumps(body).encode("utf-8")
    signature = _sign(secret, raw_body)
    target = f"{url.rstrip('/')}/emit/{endpoint}"

    def _worker(app):
        ctx = app.app_context() if app is not None else None
        if ctx is not None:
            ctx.push()
        try:
            resp = requests.post(
                target,
                data=raw_body,
                headers={
                    "Content-Type": "application/json",
                    "X-Comms-Signature": signature,
                },
                timeout=_TIMEOUT_SECONDS,
            )
            if resp.status_code >= 300:
                _log(
                    "warning",
                    f"[COMMS] emit {endpoint} -> HTTP {resp.status_code}: "
                    f"{resp.text[:200]}",
                )
            else:
                _log("info", f"[COMMS] emit {endpoint} -> {resp.status_code}")
        except Exception as e:
            _log("warning", f"[COMMS] emit {endpoint} failed: {e}")
        finally:
            if ctx is not None:
                try:
                    ctx.pop()
                except Exception:
                    pass

    try:
        app = current_app._get_current_object()
    except Exception:
        app = None

    threading.Thread(target=_worker, args=(app,), daemon=True).start()


def _clean_optional(
    link: Optional[str],
    actor_id: Optional[str],
    entity_type: Optional[str],
    entity_id,
    send_email: Optional[bool],
) -> dict:
    """Only include optional keys that were supplied (the comms service treats
    missing/None uniformly, but keeping the body tight makes logs cleaner)."""
    out = {}
    if link is not None:
        out["link"] = link
    if actor_id is not None:
        out["actor_id"] = actor_id
    if entity_type is not None:
        out["entity_type"] = entity_type
    if entity_id is not None:
        out["entity_id"] = entity_id
    if send_email is not None:
        out["send_email"] = send_email
    return out


def emit(
    *,
    user_id: str,
    org_id: str,
    type: str,
    message: str,
    link: Optional[str] = None,
    actor_id: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id=None,
    send_email: Optional[bool] = None,
) -> None:
    """Emit a single notification to one recipient. Fire-and-forget; never
    raises. No-ops (with a log line) if comms isn't configured."""
    try:
        if not user_id or not org_id or not type or not message:
            _log(
                "info",
                "[COMMS] emit skipped — missing required field "
                f"(user_id={bool(user_id)} org_id={bool(org_id)} "
                f"type={bool(type)} message={bool(message)})",
            )
            return
        body = {
            "user_id": user_id,
            "org_id": org_id,
            "type": type,
            "message": message,
            **_clean_optional(link, actor_id, entity_type, entity_id, send_email),
        }
        _post("notify", body)
    except Exception as e:
        _log("warning", f"[COMMS] emit error (swallowed): {e}")


def emit_batch(
    *,
    user_ids: list,
    org_id: str,
    type: str,
    message: str,
    link: Optional[str] = None,
    actor_id: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id=None,
    send_email: Optional[bool] = None,
) -> None:
    """Fan a single message out to many recipients. Fire-and-forget; never
    raises. No-ops (with a log line) if comms isn't configured or the
    recipient list is empty."""
    try:
        recipients = [u for u in (user_ids or []) if u]
        if not recipients or not org_id or not type or not message:
            _log(
                "info",
                "[COMMS] emit_batch skipped — empty recipients or missing field "
                f"(n={len(recipients)} org_id={bool(org_id)} type={bool(type)})",
            )
            return
        body = {
            "user_ids": recipients,
            "org_id": org_id,
            "type": type,
            "message": message,
            **_clean_optional(link, actor_id, entity_type, entity_id, send_email),
        }
        _post("notify_batch", body)
    except Exception as e:
        _log("warning", f"[COMMS] emit_batch error (swallowed): {e}")
