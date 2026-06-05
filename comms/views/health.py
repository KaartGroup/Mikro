"""Health check — unauthenticated liveness probe for App Platform."""

from flask import jsonify
from flask.views import MethodView


class HealthAPI(MethodView):
    def get(self):
        return jsonify({"status": "ok", "service": "comms"}), 200
