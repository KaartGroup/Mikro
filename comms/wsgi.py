"""WSGI entrypoint for the comms service (gunicorn: `comms.wsgi:application`)."""

from . import create_app

application = create_app()
app = application  # convenience alias for `flask run`

if __name__ == "__main__":
    application.run(port=5005, debug=True)
