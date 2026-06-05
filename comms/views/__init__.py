"""Route registration for the comms service.

MethodView + add_url_rule, mirroring Mikro's dispatch-on-<path> pattern so
the two backends read the same.
"""

from .health import HealthAPI
from .notifications import NotificationsAPI
from .messages import MessagesAPI
from .emit import EmitAPI
from .email import EmailAPI


def register_routes(app):
    app.add_url_rule("/health", view_func=HealthAPI.as_view("health"))

    app.add_url_rule(
        "/notifications/<path>",
        view_func=NotificationsAPI.as_view("notifications"),
        methods=["POST"],
    )
    app.add_url_rule(
        "/messages/<path>",
        view_func=MessagesAPI.as_view("messages"),
        methods=["POST"],
    )
    app.add_url_rule(
        "/emit/<path>",
        view_func=EmitAPI.as_view("emit"),
        methods=["POST"],
    )
    app.add_url_rule(
        "/email/<path>",
        view_func=EmailAPI.as_view("email"),
        methods=["POST"],
    )
