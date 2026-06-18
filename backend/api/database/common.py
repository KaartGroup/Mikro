from flask_sqlalchemy import SQLAlchemy
from flask_sqlalchemy.query import Query
import datetime

db = SQLAlchemy()


class QueryWithSoftDelete(Query):
    """https://github.com/miguelgrinberg/sqlalchemy-soft-delete"""

    _with_deleted = False

    def __new__(cls, *args, **kwargs):
        obj = super(QueryWithSoftDelete, cls).__new__(cls)
        obj._with_deleted = kwargs.pop("_with_deleted", False)
        if len(args) > 0:
            super(QueryWithSoftDelete, obj).__init__(*args, **kwargs)
            return obj.filter_by(deleted_date=None) if not obj._with_deleted else obj
        return obj

    def __init__(self, *args, **kwargs):
        pass

    def with_deleted(self):
        return self.__class__(
            self._only_full_mapper_zero("get"),
            session=db.session(),
            _with_deleted=True,
        )

    def _get(self, *args, **kwargs):
        # this calls the original query.get function from the base class
        return super(QueryWithSoftDelete, self).get(*args, **kwargs)

    def get(self, *args, **kwargs):
        # the query.get method does not like it if there is a filter clause
        # pre-loaded, so we need to implement it using a workaround
        obj = self.with_deleted()._get(*args, **kwargs)
        return (
            obj
            if obj is None or self._with_deleted or obj.deleted_date is None
            else None
        )


class CRUDMixin(object):
    """
    Mixin that adds convenience methods for CRUD
    (create, read, update, delete) operations.
    """

    @classmethod
    def create(cls, **kwargs):
        """Create a new record and save it the database."""
        instance = cls(**kwargs)
        return instance.save()

    def update(self, commit=True, **kwargs):
        """Update specific fields of a record."""
        for attr, value in kwargs.items():
            setattr(self, attr, value)
        return commit and self.save() or self

    def save(self, commit=True):
        """Save the record."""
        db.session.add(self)
        if commit:
            db.session.commit()
        return self

    def delete(self, soft=True, commit=True):
        """
        Remove the record from the database.
        pass soft=False to permanently delete the records;
        the default is a soft delete.
        """
        if soft is True:
            # just soft delete the record to prevent breaking related records
            self.update(deleted_date=datetime.datetime.utcnow())
            return
        else:
            # actually delete the record, optionally committing the session
            db.session.delete(self)
        return commit and db.session.commit()


class ModelWithSoftDeleteAndCRUD(CRUDMixin, db.Model):

    __abstract__ = True

    query_class = QueryWithSoftDelete  # automatically queries out soft deleted data
    deleted_date = db.Column(db.DateTime, index=True)  # for soft deletes


class SurrogatePK(object):
    """
    A mixin that adds an integer primary key column
    named ``id`` to any declarative-mapped class.
    """

    __table_args__ = {"extend_existing": True}
    id = db.Column(db.Integer, primary_key=True)
