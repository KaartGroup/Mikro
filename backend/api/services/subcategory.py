#!/usr/bin/env python3
"""
SubcategoryService — ActivitySubcategory CRUD.

Extracted from ``api/views/TimeTracking.py``. The Flask view retains
input validation, scope resolution, and permission checks; this service
owns the DB writes.

Usage::

    svc = SubcategoryService()
    sub = svc.create(activity, name, slug, org_id, team_id, ...)
    sub = svc.update(sub_id, {"name": "New Name", "sort_order": 2})
"""

from ..database import ActivitySubcategory


class SubcategoryService:
    """ActivitySubcategory CRUD — no org-scoping needed (passed per call)."""

    def create(
        self,
        activity: str,
        name: str,
        slug: str,
        org_id: str | None,
        team_id: int | None,
        sort_order: int,
        requires_project: bool,
        allow_event_fields: bool,
        created_by: str,
    ) -> ActivitySubcategory:
        """Insert and return a new ActivitySubcategory row.

        The view is responsible for uniqueness checks, slug generation,
        scope validation, and permission checks before calling this.
        """
        sub = ActivitySubcategory()
        sub.activity = activity
        sub.name = name
        sub.slug = slug
        sub.org_id = org_id
        sub.team_id = team_id
        sub.is_active = True
        sub.sort_order = sort_order
        sub.requires_project = requires_project
        sub.allow_event_fields = allow_event_fields
        sub.created_by = created_by
        sub.save()
        return sub

    def update(self, sub_id: int, fields: dict) -> ActivitySubcategory | None:
        """Apply mutable-field updates to an existing subcategory.

        Supported keys: ``name``, ``is_active``, ``sort_order``,
        ``requires_project``, ``allow_event_fields``.

        Returns the updated row, or None if not found. The view is responsible
        for permission checks and input validation before calling this.
        """
        sub = ActivitySubcategory.query.get(sub_id)
        if sub is None:
            return None
        for key in (
            "name",
            "is_active",
            "sort_order",
            "requires_project",
            "allow_event_fields",
        ):
            if key in fields:
                setattr(sub, key, fields[key])
        sub.save()
        return sub
