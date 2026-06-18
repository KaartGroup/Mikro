"""
Configuration module for Mikro API.

This module provides configuration classes for different environments.
All sensitive values are loaded from environment variables.
"""

import os


class BaseConfig:
    """Base configuration with settings common to all environments."""

    # Flask
    SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret-key-change-in-prod")

    # Auth0 Configuration
    ALGORITHMS = ["RS256"]
    AUTH0_DOMAIN = os.environ.get("AUTH0_DOMAIN")
    API_AUDIENCE = os.environ.get("API_AUDIENCE", "https://mikro/api/authorize")
    AUTH0_NAMESPACE = "mikro"  # For custom claims like mikro/roles

    # Auth0 Management API (for user invitations)
    AUTH0_M2M_CLIENT_ID = os.environ.get("AUTH0_M2M_CLIENT_ID")
    AUTH0_M2M_CLIENT_SECRET = os.environ.get("AUTH0_M2M_CLIENT_SECRET")

    # Auth0 Regular Web App client ID (for email template application context)
    AUTH0_APP_CLIENT_ID = os.environ.get("AUTH0_APP_CLIENT_ID")

    # Auth0 Organization ID (Kaart org — the real org_id for multi-tenancy)
    AUTH0_ORG_ID = os.environ.get("AUTH0_ORG_ID")

    # Auth0 default user role ID (for org invitations)
    AUTH0_USER_ROLE_ID = os.environ.get("AUTH0_USER_ROLE_ID")

    # Auth0 admin role ID — assigned to the first admin of a newly provisioned
    # external org. If unset, the first admin is added without an org role
    # (they default to a regular user) — set this so provisioning seats them
    # as an admin.
    AUTH0_ADMIN_ROLE_ID = os.environ.get("AUTH0_ADMIN_ROLE_ID")

    # Auth0 role IDs for the remaining Mikro roles — used by role-based invites
    # to assign the chosen role on the invitation. super_admin has no role id
    # (not invitable via the form).
    AUTH0_TEAM_ADMIN_ROLE_ID = os.environ.get("AUTH0_TEAM_ADMIN_ROLE_ID")
    AUTH0_VALIDATOR_ROLE_ID = os.environ.get("AUTH0_VALIDATOR_ROLE_ID")

    # Max number of Auth0 Organizations the tenant's plan allows. Kaart is on a
    # B2C plan (hard cap of 10 orgs incl. Kaart itself). Single source of truth
    # for the provisioning capacity guard — bump the env var (or remove the cap)
    # if/when the Auth0 plan is upgraded to B2B (unlimited).
    AUTH0_ORG_LIMIT = int(os.environ.get("AUTH0_ORG_LIMIT", "10"))

    # Database Configuration
    # Supports both DATABASE_URL (DigitalOcean) and individual vars
    DB_USERNAME = os.environ.get("POSTGRES_USER")
    DB_PASSWORD = os.environ.get("POSTGRES_PASSWORD")
    DB_HOST = os.environ.get("POSTGRES_ENDPOINT", "localhost")
    DB_NAME = os.environ.get("POSTGRES_DB")
    DB_PORT = os.environ.get("POSTGRES_PORT", "5432")

    @property
    def SQLALCHEMY_DATABASE_URI(self):
        """Build the database URI from environment variables."""
        # First check for DATABASE_URL (DigitalOcean Apps Platform format)
        database_url = os.environ.get("DATABASE_URL")
        if database_url:
            # DigitalOcean uses postgresql:// which SQLAlchemy supports
            return database_url
        # Fall back to individual vars
        if self.DB_USERNAME and self.DB_NAME:
            return (
                f"postgresql://{self.DB_USERNAME}:{self.DB_PASSWORD}"
                f"@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"
            )
        return None

    MAX_CONTENT_LENGTH = 500 * 1024 * 1024

    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {
        "pool_pre_ping": True,
        "pool_recycle": 300,
    }

    # TM4 Integration
    TM4_API_URL = os.environ.get("TM4_API_URL", "https://tasks.kaart.com/api/v2")
    TM4_API_TOKEN = os.environ.get("TM4_API_TOKEN")

    # MapRoulette Integration
    MR_API_URL = os.environ.get("MR_API_URL", "https://maproulette.org/api/v2")
    MR_API_KEY = os.environ.get("MR_API_KEY")

    # OSM OAuth Configuration
    OSM_OAUTH_CLIENT_ID = os.environ.get("OSM_OAUTH_CLIENT_ID")
    OSM_OAUTH_CLIENT_SECRET = os.environ.get("OSM_OAUTH_CLIENT_SECRET")
    OSM_OAUTH_REDIRECT_URI = os.environ.get(
        "OSM_OAUTH_REDIRECT_URI", "http://localhost:5004/api/osm/callback"
    )
    OSM_API_URL = os.environ.get("OSM_API_URL", "https://www.openstreetmap.org")

    # Mapillary API v4
    MAPILLARY_ACCESS_TOKEN = os.environ.get("MAPILLARY_ACCESS_TOKEN")

    # Anthropic API (AI summaries)
    ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")

    # Where in-app "Report a problem" bug reports are emailed. Defaults to the
    # dev team's group address; override with the FEEDBACK_EMAIL env var.
    FEEDBACK_EMAIL = os.environ.get("FEEDBACK_EMAIL", "dev@kaart.com")

    # Webhook Integration
    MIKRO_WEBHOOK_SECRET = os.environ.get("MIKRO_WEBHOOK_SECRET")

    # Comms service (standalone notification service)
    COMMS_URL = os.environ.get("COMMS_URL")
    COMMS_WEBHOOK_SECRET = os.environ.get("COMMS_WEBHOOK_SECRET")

    # Frontend URL for OAuth redirect after completion
    FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000")

    # Logging
    LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO")

    # CORS
    CORS_ORIGINS = os.environ.get("CORS_ORIGINS", "*")

    # DigitalOcean Spaces (S3-compatible file storage)
    DO_SPACES_KEY = os.environ.get("DO_SPACES_KEY")
    DO_SPACES_SECRET = os.environ.get("DO_SPACES_SECRET")
    DO_SPACES_ENDPOINT = os.environ.get("DO_SPACES_ENDPOINT")
    DO_SPACES_BUCKET = os.environ.get("DO_SPACES_BUCKET")
    DO_SPACES_REGION = os.environ.get("DO_SPACES_REGION")


class DevelopmentConfig(BaseConfig):
    """Development configuration."""

    DEBUG = True
    TESTING = False


class ProductionConfig(BaseConfig):
    """Production configuration."""

    DEBUG = False
    TESTING = False

    # In production, SECRET_KEY must be set
    @property
    def SECRET_KEY(self):
        key = os.environ.get("SECRET_KEY")
        if not key:
            raise ValueError(
                "SECRET_KEY environment variable must be set in production"
            )
        return key


class TestingConfig(BaseConfig):
    """Testing configuration."""

    DEBUG = True
    TESTING = True
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"


# Configuration mapping
config = {
    "development": DevelopmentConfig,
    "production": ProductionConfig,
    "testing": TestingConfig,
    "default": DevelopmentConfig,
}


def get_config():
    """Get the configuration class based on environment."""
    env = os.environ.get("FLASK_ENV", "development")
    return config.get(env, config["default"])
