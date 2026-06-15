#!/usr/bin/env python3
"""
AI helpers — single source of truth for Claude-backed text operations.

Mirrors the pattern established in ``api/views/ChannelMonitor.py``
(``_summarize_posts``): read ``ANTHROPIC_API_KEY`` from the app config,
construct an ``anthropic.Anthropic`` client, and call
``client.messages.create(...)``. Every helper here is best-effort and NEVER
raises into the caller — failures are returned as an error string so callers
can degrade gracefully.
"""

import logging

from flask import current_app

logger = logging.getLogger(__name__)

_TRANSLATE_MODEL = "claude-haiku-4-5-20251001"
_TRANSLATE_SYSTEM = (
    "You are a translator. Translate the user's message into English. "
    "If it is already English, return it unchanged. Output ONLY the "
    "translation — no preamble, no notes."
)


def translate_to_english(text: str) -> tuple["str | None", "str | None"]:
    """Translate ``text`` into English using Claude.

    Returns ``(translated, error)``:
      * ``(translated_text, None)`` on success;
      * ``(None, "no api key")`` if ``ANTHROPIC_API_KEY`` is not configured;
      * ``(None, str(e))`` on any other failure (a warning is logged).

    Never raises.
    """
    api_key = current_app.config.get("ANTHROPIC_API_KEY")
    if not api_key:
        return (None, "no api key")

    try:
        import anthropic

        client = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model=_TRANSLATE_MODEL,
            max_tokens=1024,
            system=_TRANSLATE_SYSTEM,
            messages=[{"role": "user", "content": text}],
        )
        return (message.content[0].text, None)
    except Exception as e:
        logger.warning("translate_to_english failed: %s", e)
        return (None, str(e))
