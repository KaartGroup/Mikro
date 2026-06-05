"""
CRUDMixin — convenience create/update/save/delete helpers shared by all
comms models. Mirrors Mikro's `backend/api/database/common.py` pattern so
the codebases read the same, minus the soft-delete machinery (comms rows
are hard-deleted on cleanup, no audit-trail requirement here).
"""

from ..extensions import db


class CRUDMixin:
    """Adds CRUD convenience methods to a model."""

    @classmethod
    def create(cls, commit=True, **kwargs):
        instance = cls(**kwargs)
        return instance.save(commit=commit)

    def update(self, commit=True, **kwargs):
        for attr, value in kwargs.items():
            setattr(self, attr, value)
        return self.save(commit=commit) if commit else self

    def save(self, commit=True):
        db.session.add(self)
        if commit:
            db.session.commit()
        return self

    def delete(self, commit=True):
        db.session.delete(self)
        if commit:
            db.session.commit()
        return None
