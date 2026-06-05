"""
Shared Flask extensions — single source of truth for the SQLAlchemy
instance. Every model and view imports `db` from here (never instantiates
its own), so there is exactly one metadata/session in the process.
"""

from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()
