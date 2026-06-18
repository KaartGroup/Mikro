#!/usr/bin/env python3
"""
Static variables for Mikro API.

NOTE: Most configuration has been moved to api/config.py.
This file is kept for backward compatibility with existing code.
"""

import os
import logging
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env"))

# Log missing required environment variables
for variable in [
    "POSTGRES_DB",
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
]:
    if not os.getenv(variable):  # pragma: no cover
        logging.warning(f"Missing environment variable {variable}")

# Database configuration (legacy - use config.py instead)
POSTGRES_DB = os.getenv("POSTGRES_DB", None)
POSTGRES_ENDPOINT = os.getenv("POSTGRES_ENDPOINT", "localhost")
POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD", None)
POSTGRES_PORT = os.getenv("POSTGRES_PORT", "5432")
POSTGRES_USER = os.getenv("POSTGRES_USER", None)

# App configuration
APP_BASE_URL = os.getenv("APP_BASE_URL", "https://mikro.kaart.com")

# Testing database (legacy)
TESTING_DB = os.getenv("TESTING_DB", None)
TESTING_ENDPOINT = os.getenv("TESTING_ENDPOINT", "localhost")
TESTING_PASSWORD = os.getenv("TESTING_PASSWORD", None)
TESTING_PORT = os.getenv("TESTING_PORT", "5432")
TESTING_USER = os.getenv("TESTING_USER", None)

# Protocol separators
ASCII_RECORD_SEPARATOR = b"\x1e"
ASCII_LINE_FEED = b"\x0a"
