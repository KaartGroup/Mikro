#!/usr/bin/env python3
"""
Channel Monitor API endpoints for Mikro.

Handles monitoring OSM communication channels (RSS/Atom feeds),
fetching posts, and generating AI summaries.
"""

import json
import logging
import xml.etree.ElementTree as ET
from datetime import datetime
from email.utils import parsedate_to_datetime

import requests as http_requests
from flask import current_app, g, request
from flask.views import MethodView

from ..database import db, MonitoredChannel, ChannelPost
from ..utils import requires_admin, requires_team_admin_or_above
from ..auth import is_org_admin_or_above, team_admin_visible_user_ids

logger = logging.getLogger(__name__)

OSM_HEADERS = {"User-Agent": "Mikro/1.0 (https://mikro.kaart.com)"}


def _parse_rss_date(date_str):
    """Parse an RFC 822 date string from an RSS feed."""
    try:
        return parsedate_to_datetime(date_str)
    except Exception:
        return datetime.min


def _fetch_rss_posts(url):
    """Fetch and parse posts from an RSS or Atom feed.

    Returns a list of dicts with title, link, description, author, pubDate.
    """
    posts = []
    try:
        resp = http_requests.get(url, headers=OSM_HEADERS, timeout=30)
        resp.raise_for_status()
        root = ET.fromstring(resp.content)

        # Try RSS format first
        channel = root.find("channel")
        if channel is not None:
            for item in channel.findall("item"):
                author = item.findtext("author", "")
                if not author:
                    # Check dc:creator namespace
                    author = item.findtext(
                        "{http://purl.org/dc/elements/1.1/}creator", ""
                    )
                posts.append({
                    "title": item.findtext("title", ""),
                    "link": item.findtext("link", ""),
                    "description": item.findtext("description", ""),
                    "author": author,
                    "pubDate": item.findtext("pubDate", ""),
                })
        else:
            # Try Atom format
            atom_ns = "{http://www.w3.org/2005/Atom}"
            for entry in root.findall(f"{atom_ns}entry"):
                link_el = entry.find(f"{atom_ns}link")
                link = link_el.get("href", "") if link_el is not None else ""
                author_el = entry.find(f"{atom_ns}author")
                author = ""
                if author_el is not None:
                    author = author_el.findtext(f"{atom_ns}name", "")
                posts.append({
                    "title": entry.findtext(f"{atom_ns}title", ""),
                    "link": link,
                    "description": entry.findtext(f"{atom_ns}summary", "")
                    or entry.findtext(f"{atom_ns}content", ""),
                    "author": author,
                    "pubDate": entry.findtext(f"{atom_ns}updated", "")
                    or entry.findtext(f"{atom_ns}published", ""),
                })
    except Exception as e:
        logger.error(f"Failed to fetch RSS feed from {url}: {e}")

    return posts


def _summarize_posts(posts, channel_name):
    """Generate an AI summary of channel posts using Claude.

    Returns (summary_text, error_string). On success error is None.
    """
    api_key = current_app.config.get("ANTHROPIC_API_KEY")
    if not api_key:
        return (None, "Anthropic API key not configured")

    try:
        import anthropic

        capped = posts[:20]
        content_parts = []
        for p in capped:
            content_parts.append(
                f"- [{p.get('title', 'Untitled')}] by {p.get('author', 'Unknown')} "
                f"({p.get('pubDate', 'no date')}): {p.get('description', '')}"
            )
        content_str = "\n".join(content_parts)

        client = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1024,
            system="You summarize OSM communication channel activity for a professional weekly report sent to a client.",
            messages=[
                {
                    "role": "user",
                    "content": (
                        f"Summarize the recent activity on the '{channel_name}' channel. "
                        f"Focus on key topics, decisions, and notable discussions. "
                        f"Be concise and professional.\n\n{content_str}"
                    ),
                }
            ],
        )
        return (message.content[0].text, None)
    except Exception as e:
        logger.error(f"Failed to summarize posts for {channel_name}: {e}")
        return (None, str(e))


class ChannelMonitorAPI(MethodView):
    """Channel Monitor API endpoints."""

    def post(self, path: str):
        if path == "fetch_channels":
            return self.fetch_channels()
        elif path == "add_channel":
            return self.add_channel()
        elif path == "update_channel":
            return self.update_channel()
        elif path == "remove_channel":
            return self.remove_channel()
        elif path == "fetch_channel_content":
            return self.fetch_channel_content()
        elif path == "summarize_channel":
            return self.summarize_channel()
        elif path == "fetch_all_summaries":
            return self.fetch_all_summaries()
        return {"message": "Unknown path", "status": 404}

    @requires_team_admin_or_above
    def fetch_channels(self):
        """Fetch all monitored channels for the org."""
        if not g.user:
            return {"message": "Unauthorized", "status": 401}

        try:
            channels = MonitoredChannel.query.filter_by(
                org_id=g.user.org_id
            ).all()

            if not is_org_admin_or_above(g.user):
                scope = team_admin_visible_user_ids(g.user)
                channels = [c for c in channels if c.created_by in scope]

            result = []
            for ch in channels:
                result.append({
                    "id": ch.id,
                    "name": ch.name,
                    "url": ch.url,
                    "channel_type": ch.channel_type,
                    "active": ch.active,
                    "post_count": ch.post_count,
                    "last_fetched_at": ch.last_fetched_at.isoformat()
                    if ch.last_fetched_at
                    else None,
                    "last_summary": ch.last_summary,
                    "last_summary_at": ch.last_summary_at.isoformat()
                    if ch.last_summary_at
                    else None,
                    "created_at": ch.created_at.isoformat()
                    if ch.created_at
                    else None,
                })

            return {"channels": result, "status": 200}
        except Exception as e:
            logger.error(f"Error fetching channels: {e}")
            return {"message": "Failed to fetch channels", "status": 500}

    @requires_team_admin_or_above
    def add_channel(self):
        """Add a new monitored channel."""
        if not g.user:
            return {"message": "Unauthorized", "status": 401}

        try:
            data = request.get_json()
            name = data.get("name")
            url = data.get("url")
            channel_type = data.get("channel_type", "rss")

            if not name or not url:
                return {"message": "name and url are required", "status": 400}

            channel = MonitoredChannel(
                name=name,
                url=url,
                channel_type=channel_type,
                org_id=g.user.org_id,
                active=True,
                post_count=0,
            )
            db.session.add(channel)
            db.session.commit()

            return {
                "message": "Channel added",
                "channel_id": channel.id,
                "status": 200,
            }
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error adding channel: {e}")
            return {"message": "Failed to add channel", "status": 500}

    @requires_team_admin_or_above
    def update_channel(self):
        """Update an existing monitored channel."""
        if not g.user:
            return {"message": "Unauthorized", "status": 401}

        try:
            data = request.get_json()
            channel_id = data.get("channel_id")

            if not channel_id:
                return {"message": "channel_id is required", "status": 400}

            channel = MonitoredChannel.query.filter_by(
                id=channel_id, org_id=g.user.org_id
            ).first()

            if not channel:
                return {"message": "Channel not found", "status": 404}

            if not is_org_admin_or_above(g.user):
                scope = team_admin_visible_user_ids(g.user)
                if channel.created_by not in scope:
                    return {"message": "Channel not in your scope", "status": 403}

            if "name" in data:
                channel.name = data["name"]
            if "url" in data:
                channel.url = data["url"]
            if "channel_type" in data:
                channel.channel_type = data["channel_type"]
            if "active" in data:
                channel.active = data["active"]

            db.session.commit()

            return {"message": "Channel updated", "status": 200}
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error updating channel: {e}")
            return {"message": "Failed to update channel", "status": 500}

    @requires_team_admin_or_above
    def remove_channel(self):
        """Remove a monitored channel and its posts."""
        if not g.user:
            return {"message": "Unauthorized", "status": 401}

        try:
            data = request.get_json()
            channel_id = data.get("channel_id")

            if not channel_id:
                return {"message": "channel_id is required", "status": 400}

            channel = MonitoredChannel.query.filter_by(
                id=channel_id, org_id=g.user.org_id
            ).first()

            if not channel:
                return {"message": "Channel not found", "status": 404}

            if not is_org_admin_or_above(g.user):
                scope = team_admin_visible_user_ids(g.user)
                if channel.created_by not in scope:
                    return {"message": "Channel not in your scope", "status": 403}

            # Delete associated posts first
            ChannelPost.query.filter_by(channel_id=channel.id).delete()
            db.session.delete(channel)
            db.session.commit()

            return {"message": "Channel removed", "status": 200}
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error removing channel: {e}")
            return {"message": "Failed to remove channel", "status": 500}

    @requires_team_admin_or_above
    def fetch_channel_content(self):
        """Fetch new posts from a channel's RSS/Atom feed."""
        if not g.user:
            return {"message": "Unauthorized", "status": 401}

        try:
            data = request.get_json()
            channel_id = data.get("channel_id")

            if not channel_id:
                return {"message": "channel_id is required", "status": 400}

            channel = MonitoredChannel.query.filter_by(
                id=channel_id, org_id=g.user.org_id
            ).first()

            if not channel:
                return {"message": "Channel not found", "status": 404}

            if not is_org_admin_or_above(g.user):
                scope = team_admin_visible_user_ids(g.user)
                if channel.created_by not in scope:
                    return {"message": "Channel not in your scope", "status": 403}

            posts = _fetch_rss_posts(channel.url)
            fetched = len(posts)
            new_count = 0

            for post in posts:
                external_id = post.get("link", "")
                if not external_id:
                    continue

                existing = ChannelPost.query.filter_by(
                    channel_id=channel.id, external_id=external_id
                ).first()

                if existing:
                    continue

                pub_date = _parse_rss_date(post.get("pubDate", ""))
                if pub_date == datetime.min:
                    pub_date = None

                channel_post = ChannelPost(
                    channel_id=channel.id,
                    external_id=external_id,
                    title=post.get("title", ""),
                    content=post.get("description", ""),
                    author=post.get("author", ""),
                    published_at=pub_date,
                )
                db.session.add(channel_post)
                new_count += 1

            channel.last_fetched_at = datetime.utcnow()
            channel.post_count = ChannelPost.query.filter_by(
                channel_id=channel.id
            ).count() + new_count

            db.session.commit()

            return {
                "message": "Feed fetched",
                "fetched": fetched,
                "new": new_count,
                "status": 200,
            }
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error fetching channel content: {e}")
            return {"message": "Failed to fetch channel content", "status": 500}

    @requires_team_admin_or_above
    def summarize_channel(self):
        """Generate an AI summary of recent channel posts."""
        if not g.user:
            return {"message": "Unauthorized", "status": 401}

        try:
            data = request.get_json()
            channel_id = data.get("channel_id")

            if not channel_id:
                return {"message": "channel_id is required", "status": 400}

            channel = MonitoredChannel.query.filter_by(
                id=channel_id, org_id=g.user.org_id
            ).first()

            if not channel:
                return {"message": "Channel not found", "status": 404}

            if not is_org_admin_or_above(g.user):
                scope = team_admin_visible_user_ids(g.user)
                if channel.created_by not in scope:
                    return {"message": "Channel not in your scope", "status": 403}

            recent_posts = (
                ChannelPost.query.filter_by(channel_id=channel.id)
                .order_by(ChannelPost.published_at.desc())
                .limit(20)
                .all()
            )

            if not recent_posts:
                return {"message": "No posts to summarize", "status": 400}

            post_dicts = [
                {
                    "title": p.title,
                    "link": p.external_id or "",
                    "description": p.content or "",
                    "author": p.author,
                    "pubDate": p.published_at.isoformat()
                    if p.published_at
                    else "",
                }
                for p in recent_posts
            ]

            summary, error = _summarize_posts(post_dicts, channel.name)

            if error:
                return {
                    "message": f"Summarization failed: {error}",
                    "status": 500,
                }

            channel.last_summary = summary
            channel.last_summary_at = datetime.utcnow()
            db.session.commit()

            return {
                "message": "Summary generated",
                "summary": summary,
                "status": 200,
            }
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error summarizing channel: {e}")
            return {"message": "Failed to summarize channel", "status": 500}

    @requires_team_admin_or_above
    def fetch_all_summaries(self):
        """Fetch cached summaries for all active channels."""
        if not g.user:
            return {"message": "Unauthorized", "status": 401}

        try:
            channels = MonitoredChannel.query.filter_by(
                org_id=g.user.org_id, active=True
            ).all()

            if not is_org_admin_or_above(g.user):
                scope = team_admin_visible_user_ids(g.user)
                channels = [c for c in channels if c.created_by in scope]

            summaries = []
            for ch in channels:
                summaries.append({
                    "id": ch.id,
                    "name": ch.name,
                    "summary": ch.last_summary,
                    "summary_date": ch.last_summary_at.isoformat()
                    if ch.last_summary_at
                    else None,
                    "post_count": ch.post_count,
                    "last_fetched": ch.last_fetched_at.isoformat()
                    if ch.last_fetched_at
                    else None,
                })

            return {"summaries": summaries, "status": 200}
        except Exception as e:
            logger.error(f"Error fetching summaries: {e}")
            return {"message": "Failed to fetch summaries", "status": 500}
