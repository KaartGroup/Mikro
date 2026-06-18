# flake8: noqa
# Vulture whitelist — names vulture flags as unused that are actually reachable
# via framework dispatch (not direct calls). Pass this file to vulture so these
# known false positives are suppressed:
#
#   vulture api app.py vulture_whitelist.py --min-confidence 60 \
#       --exclude "*/migrations/*"
#
# Anything vulture still reports after this is a genuine dead-code candidate.

# Flask route / error handlers in app.py — registered via @app.route /
# @app.errorhandler decorators and invoked by Flask, never called by name.
health
not_found
server_error
unauthorized
forbidden

# SQLAlchemy TypeDecorator interface — called by SQLAlchemy, and `dialect` is a
# required parameter of the interface signature (api/database/IntegerIntFlag.py).
_.process_bind_param
_.process_result_value
dialect

# signal.signal handler signature requires (signum, frame); frame is unused
# but mandated by the callback contract (api/worker/main.py).
frame
