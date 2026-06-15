#!/usr/bin/env python3
"""
Plain User lookups for non-viewer contexts.

Background jobs, webhooks, and sync routines resolve users with no
``g.user`` in scope, so they can't go through ``UserScope`` (which is
viewer-aware). This module is the single home for those lookups, so the
raw ``User.query`` calls don't get re-scattered across the worker and
webhook code.

Viewer-aware reads (anything gated by the requesting user's role / team
scope) belong in ``api.auth.UserScope`` instead — not here.
"""

from .database import User


def by_id(user_id):
    """A single user by primary key (Auth0 sub). None if missing."""
    if not user_id:
        return None
    return User.query.get(user_id)


def by_ids(ids):
    """Users for an id collection. Empty list for an empty/None input."""
    ids = list(ids or [])
    if not ids:
        return []
    return User.query.filter(User.id.in_(ids)).all()


def by_osm_username(name, org_id=None):
    """Resolve an OSM contributor to a user.

    Pass ``org_id`` whenever it's known (e.g. ``project.org_id`` in a
    webhook) so the match can't cross org boundaries. ``osm_username`` is
    globally unique today, so the org filter is a safety rail rather than
    a disambiguator.
    """
    if not name:
        return None
    q = User.query.filter(User.osm_username == name)
    if org_id is not None:
        q = q.filter(User.org_id == org_id)
    return q.first()


def by_org(org_id, *, active_only=False):
    """Every user in an org. ``active_only`` drops deactivated users."""
    if org_id is None:
        return []
    q = User.query.filter(User.org_id == org_id)
    if active_only:
        q = q.filter(User.is_active.is_(True))
    return q.all()
