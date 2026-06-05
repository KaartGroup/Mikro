"""
Outbound email for the comms service. Thin wrapper around smtplib.

Adapted from Mikro's backend/api/email/mailer.py. Branding (from-name,
base URL) is env-driven rather than hardcoded, since this mailer now serves
multiple Kaart apps.

Configuration (env, never hardcoded):
  SMTP_HOST        (default: smtp.gmail.com)
  SMTP_PORT        (default: 587)
  SMTP_USERNAME    (sender mailbox — e.g. mikro@kaart.com)
  SMTP_PASSWORD    (Gmail app password, NOT the account password)
  SMTP_FROM_NAME   (display name, default: "Kaart")
  SMTP_FROM_EMAIL  (optional, defaults to SMTP_USERNAME)
  COMMS_BASE_URL   (used to build absolute links, e.g. preferences page)

In dev without creds set, every send becomes a logged no-op.
"""

import html
import os
import smtplib
import threading
import time
from email.message import EmailMessage
from typing import Optional

from flask import current_app


def _smtp_config() -> dict:
    return {
        "host": os.environ.get("SMTP_HOST", "smtp.gmail.com"),
        "port": int(os.environ.get("SMTP_PORT", "587")),
        "username": os.environ.get("SMTP_USERNAME"),
        "password": os.environ.get("SMTP_PASSWORD"),
        "from_name": os.environ.get("SMTP_FROM_NAME", "Kaart"),
        "from_email": os.environ.get("SMTP_FROM_EMAIL")
        or os.environ.get("SMTP_USERNAME"),
        "base_url": os.environ.get("COMMS_BASE_URL", "https://mikro.kaart.com"),
    }


def _configured() -> bool:
    cfg = _smtp_config()
    return bool(cfg["username"] and cfg["password"] and cfg["from_email"])


def send_email(
    to: str,
    subject: str,
    html_body: str,
    *,
    text_body: Optional[str] = None,
) -> bool:
    """Send one email synchronously. Returns True on success, False on
    failure. Never raises — callers treat email as fire-and-forget."""
    cfg = _smtp_config()
    if not _configured():
        try:
            current_app.logger.info(
                f"[EMAIL] skipped (SMTP not configured) to={to} subject={subject!r}"
            )
        except Exception:
            pass
        return False

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = f"{cfg['from_name']} <{cfg['from_email']}>"
    msg["To"] = to
    msg.set_content(text_body or _html_to_plain(html_body))
    msg.add_alternative(html_body, subtype="html")

    try:
        with smtplib.SMTP(cfg["host"], cfg["port"], timeout=30) as server:
            server.ehlo()
            server.starttls()
            server.login(cfg["username"], cfg["password"])
            server.send_message(msg)
        try:
            current_app.logger.info(f"[EMAIL] sent to={to} subject={subject!r}")
        except Exception:
            pass
        return True
    except Exception as e:
        try:
            current_app.logger.warning(
                f"[EMAIL] send failed to={to} subject={subject!r}: {e}"
            )
        except Exception:
            pass
        return False


def send_email_async(to: str, subject: str, html_body: str) -> None:
    """Fire-and-forget: run send_email on a daemon thread so HTTP responses
    don't block on SMTP latency."""
    app = current_app._get_current_object() if current_app else None

    def _worker():
        if app is not None:
            with app.app_context():
                send_email(to, subject, html_body)
        else:
            send_email(to, subject, html_body)

    threading.Thread(target=_worker, daemon=True).start()


# ─── Templated wrappers ──────────────────────────────────────────


def _preferences_link() -> str:
    cfg = _smtp_config()
    return f"{cfg['base_url'].rstrip('/')}/account#notifications"


def _email_shell(title: str, body_html: str, footer_html: str = "") -> str:
    """Wrap content in the standard Kaart email layout."""
    cfg = _smtp_config()
    brand = html.escape(cfg["from_name"])
    return f"""<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1f2937;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <tr><td style="background:#ff6b35;padding:16px 24px;">
          <div style="color:#ffffff;font-weight:700;font-size:18px;">{brand}</div>
        </td></tr>
        <tr><td style="padding:24px;">
          <h1 style="margin:0 0 16px 0;font-size:20px;color:#1f2937;">{html.escape(title)}</h1>
          <div style="font-size:15px;line-height:1.5;color:#374151;">{body_html}</div>
          {footer_html}
        </td></tr>
        <tr><td style="padding:16px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;">
          You received this because you're a {brand} user.<br>
          <a href="{_preferences_link()}" style="color:#ff6b35;text-decoration:none;">Manage your email preferences</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""


def send_notification_email(
    *,
    to: str,
    user_display_name: str,
    title: str,
    body: str,
    action_url: Optional[str] = None,
) -> None:
    """Generic notification email used by create_notification() when a user
    opts in to email delivery for that notification type."""
    cfg = _smtp_config()
    absolute_action = None
    if action_url:
        if action_url.startswith("http://") or action_url.startswith("https://"):
            absolute_action = action_url
        else:
            absolute_action = cfg["base_url"].rstrip("/") + action_url

    button_html = ""
    if absolute_action:
        button_html = f"""
        <div style="margin-top:24px;">
          <a href="{html.escape(absolute_action)}"
             style="display:inline-block;padding:10px 20px;background:#ff6b35;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">
            View
          </a>
        </div>"""

    body_html = (
        f"<p style='margin:0 0 8px 0;'>Hi {html.escape(user_display_name)},</p>"
        f"<p style='margin:0;'>{html.escape(body)}</p>"
        f"{button_html}"
    )
    html_body = _email_shell(title, body_html)
    send_email_async(to, f"[{cfg['from_name']}] {title}", html_body)


def send_campaign(
    *,
    recipients: list[str],
    subject: str,
    body_html: str,
    inter_send_delay_seconds: float = 0.5,
) -> int:
    """Send a pre-rendered HTML body to a list of addresses, one at a time
    with a small delay to stay inside SMTP rate caps. Returns the count of
    successful sends."""
    html_wrapped = _email_shell(subject, body_html)
    sent_ok = 0
    for to in recipients:
        if send_email(to, subject, html_wrapped):
            sent_ok += 1
        time.sleep(inter_send_delay_seconds)
    return sent_ok


def send_campaign_async(recipients: list[str], subject: str, body_html: str) -> None:
    app = current_app._get_current_object() if current_app else None

    def _worker():
        if app is not None:
            with app.app_context():
                send_campaign(
                    recipients=recipients, subject=subject, body_html=body_html
                )
        else:
            send_campaign(recipients=recipients, subject=subject, body_html=body_html)

    threading.Thread(target=_worker, daemon=True).start()


def render_campaign_html(subject: str, body_html: str) -> str:
    """Public helper so the campaign preview endpoint renders the exact same
    shell the recipients will get."""
    return _email_shell(subject, body_html)


def _html_to_plain(html_str: str) -> str:
    """Crude HTML stripper for the text/plain fallback part."""
    import re

    text = re.sub(r"<br\s*/?>", "\n", html_str, flags=re.IGNORECASE)
    text = re.sub(r"</p>\s*<p[^>]*>", "\n\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    return text.strip()
