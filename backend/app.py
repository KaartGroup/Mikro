#!/usr/bin/env python3
"""
Mikro API Application

Flask application using the application factory pattern.
This module creates and configures the Flask application.

Deploy marker: 2026-05-12
"""

import os
import logging

from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_migrate import Migrate
from flask_mail import Mail
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables
# First load .env (defaults), then .env.local (local overrides) if it exists
env_path = Path(__file__).parent
load_dotenv(env_path / ".env")
if (env_path / ".env.local").exists():
    load_dotenv(env_path / ".env.local", override=True)


def create_app(config_class=None):
    """
    Application factory function.

    Args:
        config_class: Configuration class to use. If None, loads from environment.

    Returns:
        Flask: Configured Flask application instance
    """
    app = Flask(__name__)

    # Load configuration
    if config_class:
        app.config.from_object(config_class)
    else:
        from api.config import get_config
        app.config.from_object(get_config()())

    # Configure logging
    log_level = app.config.get("LOG_LEVEL", "INFO")
    logging.basicConfig(level=getattr(logging, log_level))
    app.logger.setLevel(getattr(logging, log_level))

    # Initialize CORS
    cors_origins = app.config.get("CORS_ORIGINS", "*")
    CORS(app, origins=cors_origins, supports_credentials=True)

    # Initialize database
    from api.database import db
    db.init_app(app)

    # Initialize migrations
    Migrate(app, db)

    # Initialize mail (optional)
    if app.config.get("MAIL_SERVER"):
        Mail(app)

    # Register views
    _register_views(app)

    # Register before_request hook for authentication
    @app.before_request
    def before_request():
        from api.auth import authenticate_request
        return authenticate_request()

    # Health check endpoint
    @app.route("/health")
    @app.route("/api/health")
    def health():
        return jsonify({"status": "healthy"}), 200

    # Error handlers
    @app.errorhandler(404)
    def not_found(e):
        return jsonify({"error": "Not found"}), 404

    @app.errorhandler(500)
    def server_error(e):
        app.logger.error(f"Server error: {e}")
        return jsonify({"error": "Internal server error"}), 500

    @app.errorhandler(401)
    def unauthorized(e):
        return jsonify({"error": "Unauthorized"}), 401

    @app.errorhandler(403)
    def forbidden(e):
        return jsonify({"error": "Forbidden"}), 403

    return app


def _register_views(app):
    """
    Register all API views with the application.

    All routes use the /api prefix for DO Apps Platform routing.

    Args:
        app: Flask application instance
    """
    from api.views import (
        LoginAPI,
        UserAPI,
        ProjectAPI,
        ProjectTrainingAPI,
        DashboardAPI,
        TransactionAPI,
        TaskAPI,
        TrainingAPI,
        OSMAuthAPI,
        TimeTrackingAPI,
        TeamAPI,
        PaymentsAPI,
        ReimbursementsAPI,
        ReportsAPI,
        RegionAPI,
        WebhookAPI,
        PunkAPI,
        WeeklyReportAPI,
        FriendAPI,
        CommunityDataAPI,
        ChannelMonitorAPI,
        OrganizationAPI,
        HourlyRatesAPI,
        CommsAPI,
    )

    # Authentication
    app.add_url_rule("/api/login", view_func=LoginAPI.as_view("auth"))

    # User management
    app.add_url_rule("/api/user/<path>", view_func=UserAPI.as_view("user"))

    # Project management
    app.add_url_rule("/api/project/<path>", view_func=ProjectAPI.as_view("project"))
    app.add_url_rule("/api/project-training/<path>", view_func=ProjectTrainingAPI.as_view("project_training"))

    # Dashboard stats
    app.add_url_rule("/api/dashboard/<path>", view_func=DashboardAPI.as_view("dashboard"))

    # Transaction/payment management
    app.add_url_rule(
        "/api/transaction/<path>", view_func=TransactionAPI.as_view("transaction")
    )

    # Task management
    app.add_url_rule("/api/task/<path>", view_func=TaskAPI.as_view("task"))

    # Training management
    app.add_url_rule("/api/training/<path>", view_func=TrainingAPI.as_view("training"))

    # OSM OAuth management
    app.add_url_rule("/api/osm/<path>", view_func=OSMAuthAPI.as_view("osm"))

    # Time tracking
    app.add_url_rule(
        "/api/timetracking/<path>",
        view_func=TimeTrackingAPI.as_view("timetracking"),
    )

    # Team management
    app.add_url_rule("/api/team/<path>", view_func=TeamAPI.as_view("team"))

    # Payments v1 (end-of-month payroll workspace, Trello DWAbQFlL)
    app.add_url_rule(
        "/api/payments/<path:path>",
        view_func=PaymentsAPI.as_view("payments"),
    )

    # Reimbursements
    app.add_url_rule(
        "/api/reimbursements/<path:path>",
        view_func=ReimbursementsAPI.as_view("reimbursements"),
    )

    # Reports
    app.add_url_rule("/api/reports/<path>", view_func=ReportsAPI.as_view("reports"))

    # Regions & Countries
    app.add_url_rule("/api/region/<path>", view_func=RegionAPI.as_view("region"))

    # Organization management (super_admin only — external-org provisioning)
    app.add_url_rule(
        "/api/organization/<path>",
        view_func=OrganizationAPI.as_view("organization"),
    )

    # Webhooks (HMAC-authenticated, not JWT)
    app.add_url_rule(
        "/api/webhook/<path>", view_func=WebhookAPI.as_view("webhook")
    )

    # Punks watchlist
    app.add_url_rule("/api/punk/<path>", view_func=PunkAPI.as_view("punk"))

    # Weekly Reports
    app.add_url_rule(
        "/api/weeklyreport/<path>",
        view_func=WeeklyReportAPI.as_view("weeklyreport"),
    )

    # Friends List
    app.add_url_rule("/api/friend/<path>", view_func=FriendAPI.as_view("friend"))

    # Community Data
    app.add_url_rule(
        "/api/community/<path>",
        view_func=CommunityDataAPI.as_view("community"),
    )

    # Channel Monitor
    app.add_url_rule(
        "/api/channel/<path>",
        view_func=ChannelMonitorAPI.as_view("channel"),
    )

    # Hourly rate history
    app.add_url_rule(
        "/api/hourly-rates",
        view_func=HourlyRatesAPI.as_view("hourly_rates"),
        methods=["GET", "POST", "DELETE"],
    )

    # Comms (broadcast email / announcements) — authorization gatekeeper
    app.add_url_rule(
        "/api/comms/<path>",
        view_func=CommsAPI.as_view("comms"),
        methods=["POST"],
    )



# Create application instance for gunicorn
app = create_app()


if __name__ == "__main__":
    # Development server
    app.run(debug=True, host="0.0.0.0", port=5004)
